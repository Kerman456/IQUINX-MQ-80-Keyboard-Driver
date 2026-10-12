# IQUNIX MQ80 · VIA 驱动（APP 版）

一个为 **IQUNIX MQ80**（VID `0x320F` / PID `0x5055`）从头编写的精简版 VIA 驱动，
参考并移植了 [the-via/app](https://github.com/the-via/app) 的 VIA 协议实现，
以及 [cebby2420/via-desktop](https://github.com/cebby2420/via-desktop) 的 Electron 桌面封装思路。

不依赖任何构建工具：核心驱动是原生 ES Module，浏览器直开即可；桌面版用 Electron 包成独立 APP。

---

## 功能

| 模块 | 说明 |
| --- | --- |
| 设备连接 | 通过 WebHID 直连键盘 raw HID 接口（usage page `0xFF60` / usage `0x61`），无需额外驱动 |
| 键位映射 | 读取 / 写入动态键位映射，多图层（图层数从键盘读取），改键即时写入并自动保存 |
| 键位编辑 | 常驻右侧面板，不再遮挡键盘；显示当前键位的位置 / 名称 / 十六进制值；支持 **多选批量改键**、**复制粘贴**、最近使用、竖向分类栏、搜索 |
| 键码库 | 基础键、修饰键、导航、功能键、小键盘、媒体、鼠标、**MQ80 自定义功能键**、灯光、系统，共 11 组 |
| 高级键码 | 层操作（MO / TG / TO / DF / OSL / TT）、Mod-Tap、Layer-Tap、原始键码输入 |
| 灯光 | 直接按键盘定义的 `menus` 渲染：亮度、灯效（19 种 MQ80 灯效）、灯效速度、颜色；支持 `showIf` 条件显示 |
| 宏编辑 | 16 个宏的序列编辑：单击 / 按下 / 抬起 / 延迟 / 文本，支持**直接按键录制**，含缓冲区占用提示 |
| 设备维护 | 恢复出厂设置（EEPROM 复位）、进入 Bootloader、重新读取 |
| 打包 | Electron + electron-builder，一条命令出 NSIS 安装包与免安装单文件 |
| 演示模式 | 内置内存模拟设备，没插键盘也能走通全部界面与流程 |

---

## 目录结构

```
iqunix MQ 80 VIA/
├── IQUNIX MQ80 KB-USB.json      # 原始键盘定义（VIA v2 格式）
├── package.json                 # Electron 桌面版入口
├── server.js                    # 浏览器版的静态服务器（WebHID 需要 localhost）
├── app/
│   ├── index.html               # 界面骨架
│   ├── styles.css               # 样式（浅色主题）
│   ├── main.js                  # 应用编排：连接、图层、选择、改键、日志
│   ├── definitions/
│   │   └── iqunix-mq80.js       # 键盘定义（内嵌，避免 file:// 读取问题）
│   ├── driver/                  # ★ 驱动核心
│   │   ├── via-protocol.js      # VIA 命令 / 键盘值 / 灯光通道等常量
│   │   ├── via-device.js        # 命令队列 + WebHID 传输 + 高层 API
│   │   ├── mock-device.js       # 内存模拟设备（演示模式）
│   │   ├── macro.js             # 宏字节编解码（Tap/Down/Up/Delay/文本）
│   │   ├── keycodes.js          # 键码表选择、分组、显示名、解析
│   │   └── keycodes-data.js     # 由 the-via/app 生成的键码字节表（v9~v13）
│   └── ui/
│       ├── keyboard-view.js     # KLE 布局解析 + 键帽渲染 + 自适应缩放 + 上色
│       ├── keycode-browser.js   # 可复用键码浏览器（分类栏 / 搜索 / 高级）
│       ├── key-editor.js        # 键位编辑面板 + 键码选择弹窗
│       ├── lighting-panel.js    # 灯光菜单渲染 + showIf 求值器
│       └── macro-panel.js       # 宏编辑
├── build/
│   └── icon.ico                 # 应用图标（由 tools/make-icon.mjs 生成）
├── electron/
│   ├── main.js                  # 主进程 + WebHID 授权
│   └── preload.js               # 安全桥
├── docs/
│   ├── firmware-analysis.md     # 固件安装包逆向分析（逐键调色 / 电量为什么不支持）
│   └── packaging.md             # 打包成 exe 的可行性与方案对比
└── tools/
    ├── test-driver.mjs          # 驱动协议测试（用模拟设备，无需硬件）
    ├── ui-test.mjs              # 界面交互测试（CDP 驱动真实浏览器）
    ├── extract-firmware.mjs     # 从厂商刷机 exe 里提取固件镜像
    └── make-icon.mjs            # 生成 build/icon.ico（纯 Node，无依赖）
```

---

## 运行方式

### 1. 浏览器版（最快，无需安装依赖）

```bash
node server.js            # 默认 http://localhost:5173
```

用 **Chrome / Edge** 打开 `http://localhost:5173`，点击「连接键盘」，在弹出的设备列表中选择
`IQUNIX MQ80` 的接口（usage page `0xFF60`）。

> WebHID 只在安全上下文可用；`http://localhost` 属于安全上下文，因此本地服务即可，
> 直接双击 `index.html` 用 `file://` 打开是不行的。

### 2. 桌面版（Electron）

```bash
npm install        # 安装 electron（首次约需几分钟）
npm start          # 启动桌面 App
```

桌面版里 WebHID 的授权由 `electron/main.js` 中的 `select-hid-device` 事件自动处理，
会优先匹配 `0x320F:0x5055`，多设备时弹出选择框。

### 3. 演示模式与深链

不插键盘也能用。点击右上角「演示模式」，或使用 URL 参数：

```
?demo=1                     进入演示模式
&tab=macro                  直接打开某个页签（keymap|lighting|macro|device|about）
&layer=1                    预选图层
&select=1,0                 预选 1,0 位置的键位并打开编辑面板
```

### 4. 测试

```bash
npm test          # 协议层测试：握手、键位读写、灯效、宏往返、复位
npm run test:ui   # 界面交互测试：需要先起 server.js，再起一个带调试端口的 Chrome
```

界面测试依赖 Chrome DevTools Protocol，启动方式见 `tools/ui-test.mjs` 顶部注释。

### 5. 打包成 exe

```bash
npm install
npm run dist:installer   # NSIS 安装包
npm run dist:portable    # 免安装单文件
```

打包方案对比、WebHID 在 Electron 里的授权要点、代码签名与体积权衡，
见 **[docs/packaging.md](docs/packaging.md)**。

### 6. 从厂商刷机 exe 里提取固件

```bash
npm run extract-firmware -- "MQ80-CS9041-V0106-20260206.exe/MQ80-CS9041-V0106-20260206.exe" firmware
```

会把 `code_2M`（2 MB 代码区）和 `param_128K`（128 KB 参数区）导出到 `firmware/`。
纯 Node 实现，无第三方依赖。

---

## 使用要点

### 键位映射

点击键盘上的任意键位 → 右侧面板打开 → 在键码库中点选即可替换，改动立即写入键盘。

- **多选批量改键**：先点工具栏「多选」，再依次点击多个键位，然后选一个键码应用到全部。
  `Esc` 或「取消选择」可退出。
- **复制 / 粘贴**：选中单个键位后点「复制」，再选中其它键位点「粘贴」。
- **高级键码**：键码库左下角「高级」里有层操作、Mod-Tap、Layer-Tap 和原始十六进制输入。
  Mod-Tap 需要至少勾选一个修饰键。

### 固件不支持的功能

以下两项经逆向厂商固件与分析 VIA 源码后确认**本键盘实现不了**，已从驱动中移除，
避免出现点了没反应的功能：

| 功能 | 为什么做不了 |
| --- | --- |
| **逐键调色** | VIA 的可选扩展。QMK 里由 `via_custom_value_command_kb()` 实现，默认返回 `id_unhandled`；MQ80 固件返回的就是 `id_unhandled` |
| **电量显示** | VIA 协议没有电量字段（`get_keyboard_value` 只定义 `0x01–0x06`）；真机探测也未发现厂商自定义的值 ID，也没有 HID 标准电池集合 |

详细证据链见 **[docs/firmware-analysis.md](docs/firmware-analysis.md)**（含固件里那张电池放电曲线表，
以及为什么它没有被暴露出来）。

> 补充：**蓝牙模式**下 Windows 会在「设置 → 蓝牙和其他设备」显示电量 ——
> 那是系统通过 BLE 电池服务（`0x180F`）读的，与本驱动无关。

### 宏编辑

宏缓冲区是扁平的字节数组，每个宏以 `0x00` 结束。界面里每个动作对应一段字节：

| 动作 | 协议 ≥ v11 编码 | 协议 < v11 |
| --- | --- | --- |
| 单击 | `0x01 0x01 <键码>` | `0x01 <键码>` |
| 按下 | `0x01 0x02 <键码>` | `0x02 <键码>` |
| 抬起 | `0x01 0x03 <键码>` | `0x03 <键码>` |
| 延迟 | `0x01 0x04 <十进制数字> 0x7C` | 不支持 |
| 文本 | ASCII 字符原样 | 同左 |

点「● 录制」后直接在电脑键盘上按键即可录入（按下记 Down、抬起记 Up），停止时会自动把
相邻的 `Down(x) + Up(x)` 合并为一次单击。

保存时按参考实现的做法写入：先 `MACRO_RESET`，把缓冲区最后一字节置 `0xFF` 标记"写入中"，
分块（每次 ≤ 28 字节）写入，最后把标记清 `0x00` —— 这样断电也不会留下半截数据。

---

## VIA 协议实现说明

所有命令按 VIA 规范封装（`app/driver/via-protocol.js`）。

**报文格式** — 发送 `[reportId=0x00][命令][参数…]`，补零到报告长度（MQ80 为 32 字节）；
键盘回显 `[命令][参数…][数据…]`。

| 命令 | 值 | 用途 |
| --- | --- | --- |
| `GET_PROTOCOL_VERSION` | `0x01` | 读协议版本（决定键码表） |
| `GET/SET_KEYBOARD_VALUE` | `0x02` / `0x03` | 固件版本、键码版本、布局选项 |
| `DYNAMIC_KEYMAP_GET/SET_KEYCODE` | `0x04` / `0x05` | 单键读写（协议 < 8 时使用） |
| `CUSTOM_MENU_GET/SET_VALUE` | `0x08` / `0x07` | 自定义菜单读写（灯光） |
| `CUSTOM_MENU_SAVE` | `0x09` | 按通道保存到 EEPROM |
| `EEPROM_RESET` / `BOOTLOADER_JUMP` | `0x0A` / `0x0B` | 恢复出厂 / 进入刷机模式 |
| `MACRO_GET_COUNT` | `0x0C` | 宏数量（0 表示未启用） |
| `MACRO_GET_BUFFER_SIZE` | `0x0D` | 宏缓冲区大小（16 位） |
| `MACRO_GET/SET_BUFFER` | `0x0E` / `0x0F` | 宏缓冲区读写（每次 ≤ 28 字节） |
| `MACRO_RESET` | `0x10` | 清空全部宏 |
| `DYNAMIC_KEYMAP_GET_LAYER_COUNT` | `0x11` | 图层数 |
| `DYNAMIC_KEYMAP_GET/SET_BUFFER` | `0x12` / `0x13` | 整层批量读写（每次 ≤ 28 字节） |

**键码表版本** — 与 the-via/app 一致，按协议版本自动选择：

| 协议版本 | 键码表 | `QK_KB`（自定义键码）基址 |
| --- | --- | --- |
| ≥ 13 | v13 | `0x5F80`（含 `RM_*` / `UG_*` 灯光键码） |
| 12 | v12 | `0x7E00` |
| 11 | v11 | `0x7F00` |
| 10 | v10 | `0x5F80` |
| ≤ 9 | v9 | `0x5F80` |

MQ80 的 12 个自定义功能键（2.4G / BT1-3 / USB / WinLock / Win-Mac / …）按定义顺序
映射到 `QK_KB + 索引`。

**灯光** — 定义中 `content: ["id_qmk_rgb_matrix_brightness", 3, 1]` 表示
`通道 = 3`（qmk rgb matrix）、`值 = 1`。读写时发送 `[通道, 值ID, ...数据]`，
写入后对通道调用一次 `CUSTOM_MENU_SAVE`：

| 控件 | 通道 | 值 ID | 取值范围 |
| --- | --- | --- | --- |
| 亮度 Brightness | 3 | 1 | 0–9 |
| 灯效 Effect | 3 | 2 | 0–18（MQ80 自定义灯效表） |
| 灯效速度 Effect Speed | 3 | 3 | 0–4 |
| 颜色 Color | 3 | 4 | hue, sat（各 1 字节） |

**未实现的功能如何识别** — 固件对没有处理器的通道会返回 `id_unhandled (0xFF)`。
驱动在 `ViaDevice._validate()` 里统一校验回显，遇到 `0xFF` 会抛出
「键盘未实现该功能」而不是笼统的"响应不正确"。

`showIf` 表达式（如 `{id_qmk_rgb_matrix_effect} != 0`）由内置的
分词 + 逆波兰求值器解析，**不使用 `eval`**。

---

## 已知限制

- 需要基于 Chromium 的浏览器（Chrome / Edge），Firefox / Safari 不支持 WebHID。
- **MQ80 固件不支持逐键调色、也读不到电量**，这两项已从驱动中移除
  （见[固件不支持的功能](#固件不支持的功能)与 [docs/firmware-analysis.md](docs/firmware-analysis.md)）。
- 宏功能依赖固件是否启用；宏数量或缓冲区为 0 时界面会直接提示不可用。
- 灯光面板按定义渲染；除 `range` / `dropdown` / `color` / `toggle` / `button` 外的控件类型暂未实现。
- 各项功能只经过模拟设备与浏览器自动化验证，**未逐项接真机实测**；
  建议先在演示模式熟悉操作，再逐个功能在真机上确认。

## 相关文档

- [固件安装包逆向分析](docs/firmware-analysis.md) —— 逐键调色 / 电量为什么不支持，完整证据链
- [打包成 exe](docs/packaging.md) —— 方案对比、WebHID 授权要点、签名与体积权衡

---

## 参考

- VIA 规范 <https://www.caniusevia.com/docs/specification>
- 自定义 UI <https://www.caniusevia.com/docs/custom_ui>
- the-via/app <https://github.com/the-via/app>（`keyboard-api.ts` / `macro-api/*` / `key-to-byte/*`）
- cebby2420/via-desktop <https://github.com/cebby2420/via-desktop>

MIT License.
