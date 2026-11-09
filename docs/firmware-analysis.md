# MQ80 固件逆向分析报告

**对象**：`MQ80-CS9041-V0106-20260206.exe`（2,580,992 字节，2026-02-09）
**目的**：确认 IQUNIX MQ80 固件是否支持 VIA 的**逐键调色**（custom-menu 通道 0 / 值 1）。
**工具**：`tools/extract-firmware.mjs`（本仓库，纯 Node，无第三方依赖）

---

## 结论

**不支持。** 三条相互独立的证据都指向同一结论，且能解释你在真机上看到的"无法正常工作"。

| # | 证据 | 结论 |
| --- | --- | --- |
| A | QMK `quantum/via.c` 里根本没有通道 0 | 逐键调色是**键盘固件必须自己实现的扩展**，不是协议标配 |
| B | 官方 VIA 中 `getPerKeyRGBMatrix` 唯一调用点在 V3 路径，且要求 KLE 里有 `l<n>` LED 索引 | **官方 VIA 也不会给 MQ80 提供逐键调色** |
| C | MQ80 定义只声明通道 3（4 个值），19 个灯效是厂商私有命名 | 固件是厂商自研的 VIA 子集实现 |

---

## 1. 安装包是什么

| 项目 | 值 |
| --- | --- |
| 文件类型 | PE32 **.NET 程序集**（C# WinForms，CLR 头 @ 0x2008） |
| 内部名 | `USB_OTA.exe`，版本 `1.0.0.7`，描述 `mouse&keybaord usb ota` |
| 功能 | **Telink OTA over HID 刷机工具**（非 VIA 相关） |
| MCU | **Telink TLSR9511**（资源中的 UTF-16 字符串） |
| 设备名 | `IQUNIX MQ80 KB` |
| OTA HID 接口 | Usage Page `0xFFEF`、Usage `0x00` |
| 设备标识 | 硬编码 `320f5055`（= VID 0x320F / PID 0x5055） |

关键字符串（UTF-16）证实其刷机用途：

```
telink            Wrong password      OTA Success        OTA Fail=
Firmware CRC is wrong                 illegal firmware   --->ota stop
Firmware Verson=0x   code_Size=       )code_crc=
Bin File(*.bin)|*.bin                 telink bin File format error
code_2M           param_128K
```

> 附带发现：二进制里残留了一条厂商数据库连接串
> （`server=192.168.1.60;database=...;uid=sql;pwd=iton1234;`），是工具链遗留，与刷机逻辑无关。
> 这属于厂商自留信息，这里只作事实记录。

---

## 2. 固件藏在哪里

.NET 程序集里有 **2 个嵌入清单资源**（CLR 头 Resources RVA `0xE57C`，合计 2,301,280 字节），
每个都是 `.resources`（魔数 `0xBEEFCACE`）：

| blob | 条目 | 类型 | 大小 |
| --- | --- | --- | --- |
| @ 0xC77C | `code_2M` | ByteArray | 2,097,152 B（2 MB） |
| | `param_128K` | ByteArray | 131,072 B（128 KB） |
| | `right` / `wrong` | Bitmap | 状态图标 |
| @ 0x23569C | 2 个 Icon/Bitmap | | 界面图标 |

条目布局为 `[0x20 = ResourceTypeCode.ByteArray][uint32 长度][数据]`，
所以文件整体有 **89% 是 `0xFF`**——那正是 2 MB 擦除态闪存区。

提取方式：

```bash
npm run extract-firmware -- "MQ80-CS9041-V0106-20260206.exe/MQ80-CS9041-V0106-20260206.exe" firmware
```

---

## 3. 固件镜像结构

**`code_2M`（2 MB 代码区）**

- 93.9% 为 `0xFF`（擦除态），实际编程内容约 **120 KB**，分布在 259 个非 `0xFF` 段中
- `0x1508` 起是**真实的 RISC-V 32 位代码**：指令低两位均为 `0b11`，opcode 合法
  （`0x37` LUI / `0x13` ADDI / `0x03` LOAD / `0x23` STORE）→ 与 TLSR9511（RISC-V 核）一致
- 整块二进制里 **没有** `VIA` / `QMK` / `RGB` / `rgb_matrix` / `per_key` / `led_index` /
  `id_unhandled` / `bootloader` 任何字符串；≥8 字节的 ASCII 字符串只有 27 条且全是数据
  → 符号已剥离，且**不是原样编译的 QMK**

**`param_128K`（128 KB 参数区）**

99.9% 为 `0xFF`，仅 4 段有内容：

| 偏移 | 内容 | 含义 |
| --- | --- | --- |
| 0x0000 | `55` × 62 | 填充 |
| 0x003F | `320f505505` | VID / PID |
| 0x0050 | `FFEF` | OTA 的 HID Usage Page |
| 0x0100 | `Mouse_USB_OTA` | OTA 模式设备名 |

→ 这是 **OTA / 引导参数块**，不是键位或灯效设置。

---

## 4. 为什么可以断定"不支持"——逐条展开

### 证据 A：QMK 里没有通道 0

抓取 `qmk/qmk_firmware@master:quantum/via.c` 核对，`via_custom_value_command()`
只分发这些通道：

```
id_qmk_backlight_channel    ->  via_qmk_backlight_command()
id_qmk_rgblight_channel     ->  via_qmk_rgblight_command()
id_qmk_rgb_matrix_channel   ->  via_qmk_rgb_matrix_command()   ← MQ80 用的就是这个
id_qmk_led_matrix_channel   ->  via_qmk_led_matrix_command()
id_qmk_audio_channel        ->  via_qmk_audio_command()
```

而 `rgb_matrix` 通道（=3）只有 **4 个值**：亮度、灯效、速度、颜色 —— 与 MQ80 定义完全一致。

逐键调色的"位置"是键盘级钩子：

```c
__attribute__((weak)) void via_custom_value_command_kb(uint8_t *data, uint8_t length) {
    // data = [ command_id, channel_id, value_id, value_data ]
    uint8_t *command_id = &(data[0]);
    *command_id = id_unhandled;      // ← 默认就是"未实现"
}
```

**即：逐键调色必须由键盘固件自己实现，默认是 `id_unhandled`。**

### 证据 B：连官方 VIA 都不支持 MQ80 逐键调色

在 the-via/app 里，`getPerKeyRGBMatrix` / `setPerKeyRGBMatrix` 的**唯一调用点**是
`src/store/menusSlice.ts#updateV3MenuData`，它有两道门槛：

1. `if (!isVIADefinitionV3(definition)) throw` —— 只处理 **V3** 定义；
2. `const maxLedIndex = Math.max(...definition.layouts.keys.map(key => key.li ?? -1))`
   —— 需要 KLE 里带 `l<n>` 形式的 LED 索引，`maxLedIndex >= 0` 才去读逐键颜色。

而 MQ80 的定义是 **V2 风格**（`menus` 自定义 UI + `"keycodes": ["qmk_lighting"]`），
通篇没有任何 `l` 图例 → `li` 全为 `undefined` → `maxLedIndex = -1`。

**结论：官方 VIA 打开 MQ80 时，连"逐键调色"这个界面都不会出现。**

### 证据 C：定义本身只声明了通道 3

`IQUNIX MQ80 KB-USB.json` 的 `menus` 只有 `rgb_matrix`（通道 3）的 4 个值；
19 个灯效名（`WAVE_MODE` / `VORTEX_MODE` / `COLOUR_CLOUD_MODE` …）是 **IQUNIX 私有命名**，
不是 QMK 的 `RGB_MATRIX_*` 效果集。

→ 固件是**厂商在 Telink 平台上自研**、只实现了 VIA 协议的一个子集，而不是完整的 QMK+VIA。

---

## 5. 真机上"无法工作"的具体表现

固件对未实现的通道会返回 `id_unhandled (0xFF)`，而 VIA 要求设备**回显命令字**：

- 读：应答 `0xFF ≠ 0x08` → 判定失败
- 写：应答 `0xFF ≠ 0x07` → 判定失败

所以表现是**读写直接被拒绝**（而不是"写进去了但灯不变"）。
这也解释了为什么在演示模式里一切正常、一插真机就失效 —— 模拟设备"实现"了这个扩展。

---

## 6. 本次在驱动里做的相应改动

| 改动 | 说明 |
| --- | --- |
| `ID_UNHANDLED = 0xFF` 常量 | `app/driver/via-protocol.js` |
| 统一回显校验 `ViaDevice._validate()` | 提到基类，模拟设备与真机行为一致；错误信息直接写明"键盘未实现该功能" |
| `probePerKeySupport()` | 两步探测：① 看是否回 `id_unhandled`；② 写入特征色 `H200 S255` 再回读比对 |
| 逐键调色页自动探测 | 打开页面即给出**明确结论**（支持 / 不支持 + 原因），不支持时禁用会失败的按钮 |
| `MockViaDevice(def, {perKeyUnsupported:true})` | 模拟"没有该扩展的固件"，让这条路径可测试 |

自测：`npm test` 覆盖了支持与不支持两条路径，全部通过。

---

## 7. 附：电量能不能读？（追加分析）

**先说结论：固件内部确实在算电量，但 VIA 协议没有电量字段；能不能读到，取决于厂商有没有
额外开一个口子 —— 需要在真机上探测确认。**

### 7.1 固件里确实有电量计算

在 `code_2M` 里找到一张非常典型的**电池放电曲线表**（`0x1D530` 起，逆序）：

```
200 194 188 182 176 170 164 158 152 146 140 134 129 124 119 114
109 104  99  94  89  85  81  77  73  69  65  61  57  53  49  45
 42  39  36  33  30  27  24  22  20  18  16  14  12  10   9   8
  7   6   5   4   3   2   1   0
```

从 200 单调递减到 0，步长先 6 后 4 再 3、2、1 —— 这是把电池电压映射成电量等级的查表。
另外 VIA 定义里的自定义键码 `BATTERY STATUS`（"Show Battery status"）也印证：固件知道电量，
按下这个键会在键盘上显示。

### 7.2 但 VIA 协议里没有电量

核对 QMK `quantum/via.c` 的 `id_get_keyboard_value` 分支，它只处理：

| 值 ID | 含义 |
| --- | --- |
| `0x01` | uptime |
| `0x02` | layout options |
| `0x03` | switch matrix state |
| `0x04` | firmware version |
| `0x05` | device indication |
| `0x06` | keycodes version |
| 其他 | `*command_id = id_unhandled` |

`via.c` 里 "battery" 出现 0 次。MQ80 的定义里也没有任何电量相关的菜单项或值。

### 7.3 电量只可能从两个地方来

| 途径 | 说明 | 可探测性 |
| --- | --- | --- |
| **厂商自定义的值 ID** | 固件在 `via_custom_value_command_kb()` 之外，或在 `get_keyboard_value` 里加了 `0x07+` 的分支 | ✅ 发 `get_keyboard_value(0x07…)`，只要不回 `id_unhandled` 就说明有 |
| **HID 标准电池集合** | usage page `0x06`（Generic Desktop）/ usage `0x20`（Battery Strength），无线 HID 设备常用 | ✅ 枚举 `HIDDevice.collections` 即可看到，再订阅输入报告 |

两种都不是 VIA 的一部分，所以配置软件里的"有电量"和"没电量"是两回事。

### 7.4 驱动怎么帮你确认

「设备」页新增了**设备诊断 · 电量**：

- **检测电量来源**：先查 HID 电池集合（有就订阅输入报告读百分比），
  再把 `get_keyboard_value` 的 `0x07–0x1F` 全扫一遍；返回 0–100 的会列为
  **疑似电量**（单次读数无法证明含义，所以标注"需人工确认"）。连接键盘时会自动跑一次，
  若确实找到电量，标题栏会直接显示 `电量 72%`。
- **扫描可读的键盘值**：把 31 个值 ID 的响应原样列出来，自己判断。
- **查看 HID 接口**：列出浏览器授权到的所有 HID 集合，标出哪个是电池集合。

想先看不支持的样子：`?demo=1&tab=device`；
想看"如果固件支持会长什么样"：`?demo=1&battery=72&tab=device`。

### 7.5 真机验证结果（已确认）

**用户在真机上跑过「检测电量来源」，结果是：检测不到。**

- 固件对 `get_keyboard_value` 的 `0x07–0x1F` 全部回 `id_unhandled`（即没有任何厂商自定义的值）；
- 也没有暴露 HID 标准电池集合，拿不到电池输入报告。

结论：**MQ80 的电量不通过 USB HID 暴露**。固件内部算出来的那个电量只服务于键盘自身的
`BATTERY STATUS` 键（按键后在键盘上用灯显示），**不给上位机读**。

因此「电量显示」这个功能已经**从驱动里移除**，避免留下点了没反应的按钮。
相关代码（`detectBattery` / `probeKeyboardValues` / `inspectHidCollections` 等）也一并删掉了。

如果以后想拿到电量，只有两条路：

1. **蓝牙模式**：键盘作为 BLE HID 设备，Windows 会在「设置 → 蓝牙和其他设备」显示电量
   （系统走 BLE 电池服务 `0x180F`）。这与本驱动无关，WebHID 读不到。
2. **厂商在新固件里开口子**：在 `get_keyboard_value` 里加一个自定义值 ID 返回百分比，
   或在 HID 描述符里加电池集合。有了之后驱动几行代码就能接上。

---

## 8. 局限与后续

- 固件是**剥离符号的 RISC-V 二进制**，无法形式化地"证明某个分支不存在"。
  上述结论来自 **协议架构 + 键盘定义 + 二进制字符串/结构** 三重证据，
  已经足以判定，但最终以**真机探测**为准（逐键调色页 →「检测固件支持」）。
- 若确实想要逐键调色，需要：
  1. IQUNIX 在固件里实现 `via_custom_value_command_kb()` 的通道 0 处理
     （按 `[通道, 值, LED索引, 数量]` 存取 hue/sat）；
  2. 在定义 JSON 的 KLE 里补上 `l<n>` 形式的 LED 索引；
  3. 灯效需要处于会渲染逐键缓冲区的模式，否则颜色不会显示。
- 提取出的固件镜像建议只作本地分析，不要二次分发（版权属于 IQUNIX）。
