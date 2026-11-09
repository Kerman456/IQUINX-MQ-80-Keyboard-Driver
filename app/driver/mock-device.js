/**
 * Simulated VIA device – lets the whole app (connect, remap, lighting,
 * layers, save/reset) run without a physical keyboard plugged in.
 * It answers the exact same byte protocol as the real firmware.
 */
import {
  CMD,
  KEYBOARD_VALUE,
  DEFAULT_REPORT_SIZE,
  ID_UNHANDLED,
  shiftTo16Bit,
  shiftFrom16Bit,
} from './via-protocol.js';
import { ViaDevice } from './via-device.js';

const PROTOCOL_VERSION = 12;
const LAYER_COUNT = 4;
const MACRO_COUNT = 16;
const MACRO_BUFFER_SIZE = 512;

export class MockViaDevice extends ViaDevice {
  constructor(definition, opts = {}) {
    super({
      name: `${definition?.name || 'IQUNIX MQ80'} (模拟)`,
      vendorId: 0x320f,
      productId: 0x5055,
      path: 'mock:0x320f:0x5055',
      reportSize: DEFAULT_REPORT_SIZE,
      mock: true,
    });
    this.definition = definition;
    this.protocol = PROTOCOL_VERSION;
    const matrix = definition?.matrix || { rows: 8, cols: 16 };
    this.matrix = { rows: matrix.rows, cols: matrix.cols };
    this.length = this.matrix.rows * this.matrix.cols;

    this._keymap = [];
    for (let l = 0; l < LAYER_COUNT; l++) {
      this._keymap.push(new Array(this.length).fill(0));
    }
    this._seedDefaultKeymap();
    for (let l = 1; l < LAYER_COUNT; l++) this._keymap[l].fill(0x0001);

    // lighting state for channel 3 (qmk rgb matrix)
    this._lighting = { 1: 5, 2: 1, 3: 2, 4: [170, 255] };
    this._macroSize = MACRO_BUFFER_SIZE;
    this._macroCount = MACRO_COUNT;
    this._macroBytes = this._seedMacros();
  }

  _seedMacros() {
    const bytes = new Array(MACRO_BUFFER_SIZE).fill(0);
    let i = 0;
    // macro 0: plain text "hello"
    for (const ch of 'hello') bytes[i++] = ch.charCodeAt(0);
    bytes[i++] = 0x00;
    // macro 1: Ctrl+C  ->  Down(Ctrl) Tap(C) Up(Ctrl)
    for (const b of [0x01, 2, 0xe0, 0x01, 1, 0x06, 0x01, 3, 0xe0]) bytes[i++] = b;
    bytes[i++] = 0x00;
    // macros 2.. are empty
    return bytes;
  }

  async transportOpen() {
    await delay(120);
    this.connected = true;
  }

  async transportClose() {
    this.connected = false;
  }

  _seedDefaultKeymap() {
    // build a plausible ANSI default so the demo looks alive
    const layout = this.definition?.layouts?.keymap || [];
    const layer = this._keymap[0];
    CYCLE.forEach((rowsDefault, rowIdx) => {
      const kleRow = layout[rowIdx];
      if (!kleRow) return;
      const positions = kleRow.filter((x) => typeof x === 'string');
      positions.forEach((pos, i) => {
        const [r, c] = pos.split(',').map(Number);
        if (r < this.matrix.rows && c < this.matrix.cols) {
          layer[r * this.matrix.cols + c] = rowsDefault[i] ?? 0x0000;
        }
      });
    });
  }

  async transportSend(payload) {
    await delay(6);
    const command = payload[0];
    const padded = Array.from(payload.slice(1));
    // Only the declared number of argument bytes are echoed back by a real
    // device; the rest of the packet is padding.
    const args = padded.slice(0, argCount(command, padded));
    const res = new Uint8Array(this.reportSize);
    res[0] = command;
    for (let i = 0; i < args.length; i++) res[1 + i] = args[i] & 0xff;
    const put = (offset, values) => {
      (values || []).forEach((v, i) => {
        if (offset + i < res.length) res[offset + i] = v & 0xff;
      });
    };

    switch (command) {
      case CMD.GET_PROTOCOL_VERSION: {
        const [hi, lo] = shiftFrom16Bit(PROTOCOL_VERSION);
        put(1, [hi, lo]);
        break;
      }
      case CMD.GET_KEYBOARD_VALUE: {
        const value = args[0];
        const base = 1 + args.length;
        if (value === KEYBOARD_VALUE.FIRMWARE_VERSION) put(base, [1, 0, 3]);
        else if (value === KEYBOARD_VALUE.KEYCODES_VERSION) put(base, [0, 0, 0, 8]);
        else if (value === KEYBOARD_VALUE.LAYOUT_OPTIONS) put(base, [0]);
        else if (value === KEYBOARD_VALUE.SWITCH_MATRIX_STATE) put(base, [0, 0, 0, 0]);
        else if (value === KEYBOARD_VALUE.UPTIME) put(base, [0, 0, 0, 0]);
        else if (value === KEYBOARD_VALUE.DEVICE_INDICATION) put(base, [0]);
        else {
          // Unknown value id -> stock QMK behaviour
          res[0] = ID_UNHANDLED;
        }
        break;
      }
      case CMD.SET_KEYBOARD_VALUE:
        break;
      case CMD.DYNAMIC_KEYMAP_GET_LAYER_COUNT:
        put(1, [LAYER_COUNT]);
        break;
      case CMD.DYNAMIC_KEYMAP_GET_KEYCODE: {
        const [layer, row, col] = args;
        put(4, shiftFrom16Bit(this._read(layer, row, col)));
        break;
      }
      case CMD.DYNAMIC_KEYMAP_SET_KEYCODE: {
        const [layer, row, col, hi, lo] = args;
        this._write(layer, row, col, shiftTo16Bit(hi, lo));
        break;
      }
      case CMD.DYNAMIC_KEYMAP_GET_BUFFER: {
        const [hi, lo, size] = args;
        const offset = shiftTo16Bit(hi, lo);
        put(4, this._bytes().slice(offset, offset + size));
        break;
      }
      case CMD.DYNAMIC_KEYMAP_SET_BUFFER: {
        const [hi, lo, size, ...data] = padded.slice();
        const offset = shiftTo16Bit(hi, lo);
        const bytes = this._bytes();
        data.slice(0, size).forEach((b, i) => {
          if (offset + i < bytes.length) bytes[offset + i] = b;
        });
        this._fromBytes(bytes);
        break;
      }
      case CMD.CUSTOM_MENU_GET_VALUE: {
        const channel = args[0];
        const valueId = args[1];
        if (channel === 3) {
          const v = this._lighting[valueId];
          put(1 + args.length, Array.isArray(v) ? v : [v ?? 0]);
        } else {
          // stock QMK answers a channel it has no handler for with id_unhandled
          res[0] = ID_UNHANDLED;
        }
        break;
      }
      case CMD.CUSTOM_MENU_SET_VALUE: {
        const [channel, valueId, ...rest] = padded.slice();
        if (channel === 3) {
          this._lighting[valueId] = rest.length > 1 ? rest : rest[0];
        } else {
          res[0] = ID_UNHANDLED;
        }
        break;
      }
      case CMD.CUSTOM_MENU_SAVE:
        break;
      case CMD.DYNAMIC_KEYMAP_MACRO_GET_COUNT:
        put(1, [this._macroCount]);
        break;
      case CMD.DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE:
        put(1, shiftFrom16Bit(this._macroSize));
        break;
      case CMD.DYNAMIC_KEYMAP_MACRO_GET_BUFFER: {
        const [hi, lo, size] = args;
        const offset = shiftTo16Bit(hi, lo);
        put(4, this._macroBytes.slice(offset, offset + size));
        break;
      }
      case CMD.DYNAMIC_KEYMAP_MACRO_SET_BUFFER: {
        const [hi, lo, size, ...data] = padded.slice();
        const offset = shiftTo16Bit(hi, lo);
        data.slice(0, size).forEach((b, n) => {
          if (offset + n < this._macroBytes.length) this._macroBytes[offset + n] = b;
        });
        break;
      }
      case CMD.DYNAMIC_KEYMAP_MACRO_RESET: {
        this._macroBytes = new Array(this._macroSize).fill(0);
        break;
      }
      case CMD.EEPROM_RESET:
        this._keymap.forEach((l) => l.fill(0));
        this._seedDefaultKeymap();
        for (let l = 1; l < LAYER_COUNT; l++) this._keymap[l].fill(0x0001);
        this._lighting = { 1: 5, 2: 1, 3: 2, 4: [170, 255] };
        this._macroBytes = this._seedMacros();
        break;
      default:
        break;
    }
    return res;
  }

  _read(layer, row, col) {
    if (layer < 0 || layer >= LAYER_COUNT) return 0;
    return this._keymap[layer][row * this.matrix.cols + col] || 0;
  }

  _write(layer, row, col, kc) {
    if (layer < 0 || layer >= LAYER_COUNT) return;
    this._keymap[layer][row * this.matrix.cols + col] = kc & 0xffff;
  }

  _bytes() {
    const out = new Uint8Array(this._keymap.length * this.length * 2);
    let i = 0;
    for (const layer of this._keymap) {
      for (const kc of layer) {
        out[i++] = (kc >> 8) & 0xff;
        out[i++] = kc & 0xff;
      }
    }
    return out;
  }

  _fromBytes(bytes) {
    let i = 0;
    for (let l = 0; l < this._keymap.length; l++) {
      for (let k = 0; k < this.length; k++) {
        this._keymap[l][k] = shiftTo16Bit(bytes[i] || 0, bytes[i + 1] || 0);
        i += 2;
      }
    }
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** How many argument bytes each command echoes back. */
function argCount(command, padded) {
  return ARG_LEN[command] ?? padded.length;
}

const ARG_LEN = {
  [CMD.GET_PROTOCOL_VERSION]: 0,
  [CMD.GET_KEYBOARD_VALUE]: 1,
  [CMD.SET_KEYBOARD_VALUE]: 1,
  [CMD.DYNAMIC_KEYMAP_GET_KEYCODE]: 3,
  [CMD.DYNAMIC_KEYMAP_SET_KEYCODE]: 5,
  [CMD.DYNAMIC_KEYMAP_GET_LAYER_COUNT]: 0,
  [CMD.DYNAMIC_KEYMAP_GET_BUFFER]: 3,
  [CMD.DYNAMIC_KEYMAP_SET_BUFFER]: 3,
  [CMD.CUSTOM_MENU_GET_VALUE]: 2,
  [CMD.CUSTOM_MENU_SET_VALUE]: 3,
  [CMD.CUSTOM_MENU_SAVE]: 1,
  [CMD.DYNAMIC_KEYMAP_MACRO_GET_COUNT]: 0,
  [CMD.DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE]: 0,
  [CMD.DYNAMIC_KEYMAP_MACRO_GET_BUFFER]: 3,
  [CMD.DYNAMIC_KEYMAP_MACRO_SET_BUFFER]: 3,
  [CMD.DYNAMIC_KEYMAP_MACRO_RESET]: 0,
  [CMD.EEPROM_RESET]: 0,
  [CMD.BOOTLOADER_JUMP]: 0,
};

const A = (n) => 0x0004 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(n);
const D = (n) => 0x001e + '1234567890'.indexOf(n);

/** Per-row ANSI default keycodes, indexed by the layout row order in the JSON. */
const CYCLE = [
  // row 0 – function row
  [
    0x0029, 0x003a, 0x003b, 0x003c, 0x003d, 0x003e, 0x003f, 0x0040,
    0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x0046, 0x0047, 0x0048,
  ],
  // row 1 – number row
  [
    0x0035, D('1'), D('2'), D('3'), D('4'), D('5'), D('6'), D('7'), D('8'),
    D('9'), D('0'), 0x002d, 0x002e, 0x002a, 0x004e,
  ],
  // row 2
  [
    0x002b, A('Q'), A('W'), A('E'), A('R'), A('T'), A('Y'), A('U'), A('I'),
    A('O'), A('P'), 0x002f, 0x0030, 0x0031, 0x004a,
  ],
  // row 3
  [
    0x0039, A('A'), A('S'), A('D'), A('F'), A('G'), A('H'), A('J'), A('K'),
    A('L'), 0x0033, 0x0034, 0x0028, 0x004c,
  ],
  // row 4
  [
    0x00e1, A('Z'), A('X'), A('C'), A('V'), A('B'), A('N'), A('M'), 0x0036,
    0x0037, 0x0038, 0x00e5, 0x0052, 0x004b,
  ],
  // row 5
  [
    0x00e0, 0x00e3, 0x00e2, 0x002c, 0x00e2, 0x00e3, 0x0065, 0x00e0,
    0x0050, 0x0051, 0x004f,
  ],
];
