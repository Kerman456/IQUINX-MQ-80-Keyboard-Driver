# v1.2.0 — 首个可分发版本

IQUNIX MQ80（VID `0x320F` / PID `0x5055`）的轻量 VIA 驱动，原生 ES Module + WebHID，
同时提供 Windows 桌面版（Electron）。

## 下载哪个

| 文件 | 说明 | 适合 |
| --- | --- | --- |
| `IQUNIX MQ80 VIA-1.2.0-portable.exe` | 免安装单文件，约 75 MB | **推荐先用这个**，双击即用，不写注册表 |
| `IQUNIX MQ80 VIA-1.2.0-x64.exe` | NSIS 安装包，约 75 MB | 需要开始菜单 / 桌面快捷方式与卸载入口 |

> ⚠️ **首次运行会被 SmartScreen 拦一下**。当前版本未做代码签名，Windows 会提示
> 「Windows 已保护你的电脑」——点「更多信息」→「仍要运行」即可。
> 想要消除这个提示需要购买 Authenticode 证书后重新签名。

**系统要求**：Windows 10/11 x64。浏览器版需要 Chromium 内核（Chrome / Edge），Firefox 与 Safari 不支持 WebHID。

## 功能

- **键位映射**：多图层改键，图层数从键盘读取；竖向分类栏 + 搜索的键码浏览器；多选批量改键、复制/粘贴、最近使用
- **灯光**：按键盘定义渲染——亮度、19 种 MQ80 灯效、灯效速度、颜色；`showIf` 条件显隐由内置的
  分词 + 逆波兰求值器解析，**不使用 `eval`**
- **宏编辑**：16 个宏的序列编辑（单击 / 按下 / 抬起 / 延迟 / 文本），支持直接按键录制；
  写入按 `MACRO_RESET` → 标记写入中 → 分块写 → 清标记的流程，断电不会留半截数据
- **设备维护**：固件版本、键码版本、恢复出厂设置、进入 Bootloader
- **演示模式**：内置内存模拟设备，不插键盘也能走完所有界面

## 已知限制（请先读）

- **不支持逐键调色**：这是 VIA 的可选扩展。QMK 里由 `via_custom_value_command_kb()` 实现，
  默认返回 `id_unhandled`；MQ80 固件返回的正是 `id_unhandled`。
  详见 [docs/firmware-analysis.md](docs/firmware-analysis.md) 里的证据链。
- **读不到电量**：VIA 协议没有电量字段（`get_keyboard_value` 只定义 `0x01–0x06`）；
  真机扫描也未发现厂商自定义值 ID，也没有 HID 标准电池集合。
  蓝牙模式下 Windows 显示的电量是系统走 BLE 电池服务读的，与本驱动无关。
- **未逐项真机验证**：协议层由模拟设备测试覆盖（27 项断言），界面由 CDP 驱动的真实
  Chrome 测试覆盖（21 项断言），但灯光/宏的实际写入效果仍建议先小范围试。
- 灯光面板目前支持 `range` / `dropdown` / `color` / `toggle` / `button` 五类控件。

## 校验值

```
1f2b00f099e255543ab4d53089e26502b657e9f985934ea636a08a8a1db458da  IQUNIX MQ80 VIA-1.2.0-portable.exe
bfd9ddddd149acc2240f86e8d60803e122b2f679164ebabc52cc04a8827deafd  IQUNIX MQ80 VIA-1.2.0-x64.exe
```

Windows 上核对：`certutil -hashfile "文件名" SHA256`

## 从源码构建

```bash
npm install
npm run dist        # 需要配置 ELECTRON_MIRROR，见 docs/packaging.md
```

## 致谢

协议实现参考 [the-via/app](https://github.com/the-via/app)，桌面封装思路参考
[cebby2420/via-desktop](https://github.com/cebby2420/via-desktop)。
