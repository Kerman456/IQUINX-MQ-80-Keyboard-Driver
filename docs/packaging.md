# 打包成 exe —— 可行性与方案

## 结论

**完全可行，而且这个项目现在就已经是 Electron 结构**，配好了一键出包：

```bash
npm install
npm run dist:installer   # NSIS 安装包
npm run dist:portable    # 免安装单文件
npm run dist:dir         # 只解包，方便调试
```

---

## 决定方案选型的 4 个约束

1. **WebHID 只在 Chromium 内核里存在。**
   所以最终 exe 要么自带 Chromium（Electron），要么用 WebView2，要么把传输层换成 `node-hid`
   彻底不走 WebHID。
2. **Electron 里 WebHID 默认不通**，必须处理三件事（本项目 `electron/main.js` 已实现）：
   - `session.setPermissionCheckHandler` 放行 `hid` 权限
   - `session.setDevicePermissionHandler` 允许 HID 设备
   - `session.on('select-hid-device')` 返回用户选中的 `deviceId`
   少了任何一条，`navigator.hid.requestDevice()` 都会静默失败。
3. **代码签名**：未签名的 exe 首次运行会弹 SmartScreen「Windows 已保护你的电脑」。
   消除它需要 Authenticode 证书（OV 约千元/年，EV 更贵）。
4. **体积**：Electron ≈ 80–150 MB，Tauri ≈ 5–10 MB，Node SEA + node-hid ≈ 20–40 MB。

---

## 方案对比

| 方案 | 体积 | 复用现有代码 | WebHID | 开发量 | 评价 |
| --- | --- | --- | --- | --- | --- |
| **A. Electron + electron-builder** | 80–150 MB | **100%** | ✅ 原生 | 极低 | **首选** |
| B. Electron + electron-forge | 同上 | 100% | ✅ | 低 | 等价替代 |
| C. Tauri 2 + WebView2 | 5–10 MB | ~100% | ⚠️ 支持不完整 | 中 | 想极致小体积，需先验证 |
| D. C# WinForms/WebView2 壳 | 10–20 MB | UI 100% | ⚠️ 同 C | 中高 | 想要原生观感 |
| E. Node SEA + node-hid | 20–40 MB | 驱动层改写 | 不依赖 | 高 | 无 Chromium 依赖 |
| F. pkg / nexe + node-hid | 25–45 MB | 驱动层改写 | 不依赖 | 高 | 工具链已废弃，不推荐 |

---

## 推荐路线 A：Electron + electron-builder

选它的理由：**代码零改动**（授权逻辑已经在 `electron/main.js` 里），跨平台，
一条命令同时产出安装包与便携版。

### 已配置好的内容（`package.json` → `build`）

| 配置 | 值 | 说明 |
| --- | --- | --- |
| `appId` | `com.iqunix.mq80.via` | 应用标识 |
| `productName` | `IQUNIX MQ80 VIA` | 显示名 |
| `win.target` | `nsis` + `portable` | 安装包 + 免安装 |
| `nsis.oneClick` | `false` | 走向导式安装，可选目录 |
| `nsis.perMachine` | `false` | 按用户安装，**不需要管理员权限** |
| `nsis.deleteAppDataOnUninstall` | `false` | 卸载保留 localStorage 里的键位映射/最近使用 |
| `requestedExecutionLevel` | `asInvoker` | 不请求提权 |

### 构建注意

- **图标**：把 256×256 多尺寸的 `build/icon.ico` 放进去；不放就用 Electron 默认图标。
- **网络**：首次构建会下载 Electron 运行时 + NSIS 工具链（几百 MB）。
- **产物**：`dist/IQUNIX MQ80 VIA-1.2.0-x64.exe`、`dist/IQUNIX MQ80 VIA-1.2.0-portable.exe`。

### 签名（可选，但对外分发强烈建议）

```bash
# Windows CMD / PowerShell
set CSC_LINK=path\to\cert.pfx
set CSC_KEY_PASSWORD=你的密码
npm run dist
```

没有证书时可以 `"win": { "signAndEditExecutable": false }` 跳过，
但用户第一次运行会看到 SmartScreen 警告，需要点「更多信息 → 仍要运行」。

---

## 如果一定要"小体积"

### C. Tauri 2 + WebView2（约 5–10 MB）

Windows 上 WebView2 基于 Edge，`navigator.hid` 是存在的，但：
- 设备权限要走 `CoreWebView2.PermissionRequested`
- `select-hid-device` 的可控性历史上不如 Electron
- 需要 Rust 工具链

**建议先花 30 分钟做可行性验证**：起一个最小 Tauri 壳，调
`navigator.hid.requestDevice(...)`，看能否弹出设备选择框并能收发报告。
不行就直接放弃这条路，别先投入重写。

### E. Node SEA + node-hid（约 20–40 MB）

思路：把 `app/driver/via-device.js` 里的传输层换掉即可，**接口完全一致**——
只需另实现一个 `NodeHidViaDevice`，覆盖三个方法：

```js
class NodeHidViaDevice extends ViaDevice {
  async transportOpen() { /* new HID.HID(path) */ }
  async transportClose() { /* device.close() */ }
  async transportSend(payload) { /* device.write(...) + 等 input 事件 */ }
}
```

上层（协议、键码、UI、宏、逐键调色）一行都不用改。
然后用 **Node SEA（Single Executable Application）** 打包成单 exe，
启动时拉起本地静态服务并打开默认浏览器。

注意点：
- `node-hid` 是**原生模块**，SEA 对 `.node` 的嵌入要额外处理
  （常见做法：把 `.node` 作为 asset 打进去，运行时解压到临时目录再 `require`）。
- 依然是"本地服务 + 浏览器 UI"两段式，观感不如 Electron。
- 如果目标机器可能没有 Chrome/Edge，这条路就没意义了。

---

## 实际构建结果（已跑通）

```bash
npm install                                    # 310 个包，约 2 分钟
npm run dist                                   # NSIS + portable，约 50 秒
```

用国内镜像会快很多（Electron 111 MB 只用了 9 秒）：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist
```

产物：

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `dist/IQUNIX MQ80 VIA-1.2.0-x64.exe` | 74.8 MB | NSIS 安装包（向导式、可选目录、免管理员权限） |
| `dist/IQUNIX MQ80 VIA-1.2.0-portable.exe` | 74.5 MB | 免安装单文件，双击即用 |
| `dist/IQUNIX MQ80 VIA-1.2.0-x64.exe.blockmap` | 81 KB | 增量更新用，可忽略 |
| `dist/win-unpacked/` | 259 MB | 未压缩目录，调试用；`resources/app.asar` 只有 200 KB |

校验结果：

- 三个 exe 都是合法的 PE GUI 可执行文件，自定义图标（6 种尺寸）已正确嵌入 `.rsrc`；
- `app.asar` 只包含 `app/` + `electron/` + `package.json`，
  已确认**不含** `docs/`、`tools/`、任何已移除功能的代码；
- 用了 `tools/make-icon.mjs` 生成图标（纯 Node、零依赖，可随时改了颜色重新生成）。

### 未做的验证

**没有在本机实际双击运行 exe**（当前环境的沙箱会拦截 GUI 进程启动）。
建议你自己跑一遍：

1. 先试 `portable.exe`（免安装），确认能打开、能连上键盘、WebHID 弹窗正常；
2. 再试安装包，确认快捷方式与卸载正常。

### 签名

当前构建**未签名**，首次运行 Windows 会弹 SmartScreen：「Windows 已保护你的电脑」→
点「更多信息 → 仍要运行」即可。要消除它需要 Authenticode 证书（见上一节）。

---

## 落地建议

1. 先 `npm run dist:installer` 出一个包自己装一遍，确认 WebHID 授权与全部功能正常；
2. 功能没问题后再考虑买证书签名；
3. 对外分发时把 `dist/*.exe` 挂到 GitHub Release 即可；
4. 如果只是自己/小团队用，**便携版最省事**——免安装、免管理员权限。

---

## 附：三条容易踩的坑

1. **`select-hid-device` 必须 `event.preventDefault()`**，否则默认行为会弹出 Chromium 自带的
   设备选择器，拿到的是没权限的 `deviceId`。
2. **别用 `nodeIntegration: true`**。本项目走 `contextIsolation: true` + preload 桥，
   渲染进程只用标准 WebHID API，安全且够用。
3. **多设备时要做筛选**。`select-hid-device` 的 `deviceList` 里可能同时有键盘的
   普通 HID 接口与 raw HID 接口（usage page `0xFF60`）。本项目按 VID/PID 优先匹配，
   兜底找 `usagePage === 0xff60`，再兜底弹框让用户选。
