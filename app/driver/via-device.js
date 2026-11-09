/**
 * VIA device driver.
 *
 * `ViaDevice` implements the whole VIA command set on top of a small
 * transport hook (`transportSend`). Two transports are provided:
 *
 *   WebHidViaDevice  – talks to the real keyboard over WebHID
 *   MockViaDevice    – in-memory simulator (demo mode / no hardware)
 *
 * Reference: the-via/app -> src/utils/keyboard-api.ts
 */
import {
  CMD,
  KEYBOARD_VALUE,
  PROTOCOL,
  REPORT_ID,
  DEFAULT_REPORT_SIZE,
  MAX_BUFFER_CHUNK,
  ID_UNHANDLED,
  shiftTo16Bit,
  shiftFrom16Bit,
} from './via-protocol.js';

export class ViaDevice {
  constructor(descriptor = {}) {
    this.descriptor = descriptor; // {name, vendorId, productId, path}
    this.reportSize = descriptor.reportSize || DEFAULT_REPORT_SIZE;
    this.protocol = -1;
    this.connected = false;
    this._queue = [];
    this._flushing = false;
    this._listeners = { disconnect: [] };
  }

  /* --------------------------------------------------------------- */
  /* Transport (implemented by subclasses)                            */
  /* --------------------------------------------------------------- */

  /** Send one packet and resolve with the 32-byte response payload. */
  async transportSend(_payload) {
    throw new Error('transportSend not implemented');
  }

  async transportOpen() {}
  async transportClose() {}

  /* --------------------------------------------------------------- */
  /* Command queue                                                    */
  /* --------------------------------------------------------------- */

  onDisconnect(fn) {
    this._listeners.disconnect.push(fn);
  }

  _emitDisconnect(reason) {
    if (!this.connected) return;
    this.connected = false;
    this._listeners.disconnect.forEach((fn) => fn(reason));
  }

  /**
   * Low level: send [command, ...bytes] and return the 32 byte answer.
   * @param {number[]} bytes
   * @param {{raw?: boolean}} [opts] raw: accept a mismatched echo so the
   *        caller can inspect `id_unhandled` instead of getting an exception.
   */
  command(command, bytes = [], opts = {}) {
    return new Promise((resolve, reject) => {
      this._queue.push({ command, bytes, raw: !!opts.raw, resolve, reject });
      if (!this._flushing) this._flush();
    });
  }

  async _flush() {
    this._flushing = true;
    while (this._queue.length) {
      const job = this._queue.shift();
      try {
        // [reportId=0 is implied by sendReport] -> payload = [command, ...args, 0...]
        const payload = new Uint8Array(this.reportSize);
        payload[0] = job.command;
        job.bytes.forEach((b, i) => {
          if (1 + i < payload.length) payload[1 + i] = b & 0xff;
        });
        const res = await this.transportSend(payload, { raw: job.raw });
        if (!job.raw) this._validate(res, job.command);
        job.resolve(res);
      } catch (e) {
        job.reject(e);
      }
    }
    this._flushing = false;
  }

  /**
   * The device must echo the command byte. When it answers `id_unhandled`
   * (0xFF) the firmware simply has no handler for that channel/command —
   * that is the signal we use to detect unsupported features.
   */
  _validate(res, command) {
    if (res[0] === command) return;
    if (res[0] === ID_UNHANDLED) {
      throw new Error(
        `键盘未实现该功能（命令 0x${hex2(command)} 返回 id_unhandled 0xFF）`,
      );
    }
    throw new Error(`收到的响应不正确（期望 0x${hex2(command)}，收到 0x${hex2(res[0])}）`);
  }

  /* --------------------------------------------------------------- */
  /* High level API                                                   */
  /* --------------------------------------------------------------- */

  async getProtocolVersion() {
    const res = await this.command(CMD.GET_PROTOCOL_VERSION);
    if (res[0] !== CMD.GET_PROTOCOL_VERSION) throw new Error('bad protocol response');
    this.protocol = shiftTo16Bit(res[1], res[2]);
    return this.protocol;
  }

  async getKeyboardValue(value, parameters = [], resultLength = 1) {
    const bytes = [value, ...parameters];
    const res = await this.command(CMD.GET_KEYBOARD_VALUE, bytes);
    return Array.from(res.slice(1 + bytes.length, 1 + bytes.length + resultLength));
  }

  async setKeyboardValue(value, ...rest) {
    await this.command(CMD.SET_KEYBOARD_VALUE, [value, ...rest]);
  }

  async getLayerCount() {
    if (this.protocol >= PROTOCOL.BETA) {
      const res = await this.command(CMD.DYNAMIC_KEYMAP_GET_LAYER_COUNT);
      return res[1] || 4;
    }
    return 4;
  }

  async getFirmwareVersion() {
    try {
      const [a, b, c] = await this.getKeyboardValue(KEYBOARD_VALUE.FIRMWARE_VERSION, [], 3);
      return `${a}.${b}.${c}`;
    } catch {
      return null;
    }
  }

  async getKeycodesVersion() {
    try {
      const r = await this.getKeyboardValue(KEYBOARD_VALUE.KEYCODES_VERSION, [], 4);
      return ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0;
    } catch {
      return null;
    }
  }

  /* ---- dynamic keymap ------------------------------------------- */

  async getKey(layer, row, col) {
    const res = await this.command(CMD.DYNAMIC_KEYMAP_GET_KEYCODE, [layer, row, col]);
    return shiftTo16Bit(res[4], res[5]);
  }

  async setKey(layer, row, col, keycode) {
    const [hi, lo] = shiftFrom16Bit(keycode & 0xffff);
    await this.command(CMD.DYNAMIC_KEYMAP_SET_KEYCODE, [layer, row, col, hi, lo]);
  }

  async getKeymapBuffer(offset, size) {
    if (size > MAX_BUFFER_CHUNK) throw new Error('Max data length is 28');
    const [hi, lo] = shiftFrom16Bit(offset);
    const res = await this.command(CMD.DYNAMIC_KEYMAP_GET_BUFFER, [hi, lo, size]);
    return Array.from(res.slice(4, size + 4));
  }

  async setKeymapBuffer(offset, data) {
    const [hi, lo] = shiftFrom16Bit(offset);
    await this.command(CMD.DYNAMIC_KEYMAP_SET_BUFFER, [hi, lo, data.length, ...data]);
  }

  /** Read every keycode of one layer as a flat rows*cols array. */
  async readLayer({ rows, cols }, layer) {
    const length = rows * cols;
    if (this.protocol >= PROTOCOL.BETA) {
      const chunks = [];
      for (let offset = 0; offset < length; ) {
        const remaining = length - offset;
        const count = Math.min(14, remaining);
        chunks.push(
          this.getKeymapBuffer(layer * length * 2 + 2 * offset, count * 2),
        );
        offset += count;
      }
      const buffers = await Promise.all(chunks);
      const flat = buffers.flat();
      const out = [];
      for (let i = 0; i < flat.length; i += 2) out.push(shiftTo16Bit(flat[i], flat[i + 1]));
      return out;
    }
    const jobs = [];
    for (let i = 0; i < length; i++) jobs.push(this.getKey(layer, Math.floor(i / cols), i % cols));
    return Promise.all(jobs);
  }

  /** Write one full layer (rows*cols keycodes). */
  async writeLayer({ rows, cols }, layer, keycodes) {
    const length = rows * cols;
    const data = keycodes.slice(0, length).flatMap((k) => shiftFrom16Bit(k & 0xffff));
    if (this.protocol >= PROTOCOL.BETA) {
      for (let offset = 0; offset < data.length; offset += MAX_BUFFER_CHUNK) {
        await this.setKeymapBuffer(layer * length * 2 + offset, data.slice(offset, offset + MAX_BUFFER_CHUNK));
      }
      return;
    }
    for (let i = 0; i < length; i++) {
      await this.setKey(layer, Math.floor(i / cols), i % cols, keycodes[i]);
    }
  }

  /* ---- custom menus / lighting ---------------------------------- */

  /** @param {number[]} commandBytes e.g. [channel, valueId] */
  async getCustomMenuValue(commandBytes) {
    const res = await this.command(CMD.CUSTOM_MENU_GET_VALUE, commandBytes);
    return Array.from(res.slice(1 + commandBytes.length));
  }

  async setCustomMenuValue(...args) {
    await this.command(CMD.CUSTOM_MENU_SET_VALUE, args);
  }

  async commitCustomMenu(channel) {
    await this.command(CMD.CUSTOM_MENU_SAVE, [channel]);
  }

  /* ---- macros ---------------------------------------------------- */

  async getMacroCount() {
    const res = await this.command(CMD.DYNAMIC_KEYMAP_MACRO_GET_COUNT);
    return res[1] || 0;
  }

  /** Size of the macro buffer in bytes (0 when macros are disabled). */
  async getMacroBufferSize() {
    const res = await this.command(CMD.DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE);
    return shiftTo16Bit(res[1], res[2]);
  }

  async getMacroBytes() {
    const size = await this.getMacroBufferSize();
    if (!size) return [];
    const out = [];
    for (let offset = 0; offset < size; offset += MAX_BUFFER_CHUNK) {
      const want = Math.min(MAX_BUFFER_CHUNK, size - offset);
      const [hi, lo] = shiftFrom16Bit(offset);
      const res = await this.command(CMD.DYNAMIC_KEYMAP_MACRO_GET_BUFFER, [hi, lo, want]);
      out.push(...Array.from(res.slice(4, 4 + want)));
    }
    return out;
  }

  /**
   * Rewrite the whole macro buffer. Mirrors the reference implementation:
   * reset -> flag the last byte as 0xFF (write in progress) -> chunked write
   * -> clear the flag, so a power loss cannot leave a half-written buffer.
   */
  async setMacroBytes(data) {
    const size = await this.getMacroBufferSize();
    if (!size) throw new Error('此键盘未提供宏缓冲区');
    if (data.length > size) {
      throw new Error(`宏数据 ${data.length} 字节，超出缓冲区 ${size} 字节`);
    }
    await this.resetMacros();
    const [lhi, llo] = shiftFrom16Bit(size - 1);
    await this.command(CMD.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, [lhi, llo, 1, 0xff]);
    try {
      for (let offset = 0; offset < data.length; offset += MAX_BUFFER_CHUNK) {
        const chunk = data.slice(offset, offset + MAX_BUFFER_CHUNK);
        const [hi, lo] = shiftFrom16Bit(offset);
        await this.command(CMD.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, [hi, lo, chunk.length, ...chunk]);
      }
    } finally {
      await this.command(CMD.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, [lhi, llo, 1, 0x00]);
    }
  }

  async resetMacros() {
    await this.command(CMD.DYNAMIC_KEYMAP_MACRO_RESET);
  }

  /* ---- maintenance ---------------------------------------------- */

  async resetEEPROM() {
    await this.command(CMD.EEPROM_RESET);
  }

  async jumpToBootloader() {
    await this.command(CMD.BOOTLOADER_JUMP);
  }

  async close() {
    await this.transportClose();
    this.connected = false;
  }
}

/* ------------------------------------------------------------------ */
/* WebHID transport                                                   */
/* ------------------------------------------------------------------ */

export class WebHidViaDevice extends ViaDevice {
  constructor(hidDevice) {
    const info = hidDevice;
    super({
      name: info.productName || 'VIA Keyboard',
      vendorId: info.vendorId,
      productId: info.productId,
      path: `hid:${info.vendorId}:${info.productId}`,
    });
    this.hid = hidDevice;
    this.reportSize = detectReportSize(hidDevice);
    this._pending = null;
    this._inputHandler = (event) => this._onInputReport(event);
  }

  static get filters() {
    return [
      {
        vendorId: 0x320f,
        productId: 0x5055,
        usagePage: 0xff60,
        usage: 0x61,
      },
    ];
  }

  static async request() {
    if (!('hid' in navigator)) {
      throw new Error('此浏览器不支持 WebHID，请使用 Chrome / Edge，或使用桌面版。');
    }
    const devices = await navigator.hid.requestDevice({ filters: WebHidViaDevice.filters });
    if (!devices.length) return null;
    return devices[0];
  }

  static async authorized() {
    if (!('hid' in navigator)) return [];
    const list = await navigator.hid.getDevices();
    return list.filter(
      (d) => d.vendorId === 0x320f || d.collections?.some((c) => c.usagePage === 0xff60),
    );
  }

  async transportOpen() {
    if (!this.hid.opened) await this.hid.open();
    this.hid.addEventListener('inputreport', this._inputHandler);
    const onDisc = (e) => {
      if (e.device === this.hid) this._emitDisconnect('设备已断开');
    };
    navigator.hid.addEventListener('disconnect', onDisc);
    this._discHandler = onDisc;
    this.connected = true;
  }

  async transportClose() {
    this.hid.removeEventListener('inputreport', this._inputHandler);
    if (this._discHandler) navigator.hid.removeEventListener('disconnect', this._discHandler);
    try {
      await this.hid.close();
    } catch {
      /* ignore */
    }
    this._pending?.reject(new Error('closed'));
    this._pending = null;
  }

  _onInputReport(event) {
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const pending = this._pending;
    if (!pending) return;
    this._pending = null;
    clearTimeout(pending.timer);
    pending.resolve(data);
  }

  async transportSend(payload) {
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending === entry) this._pending = null;
        reject(new Error('设备响应超时'));
      }, 2000);
      const entry = { resolve, reject, timer };
      this._pending = entry;
    });
    try {
      await this.hid.sendReport(REPORT_ID, payload);
    } catch (e) {
      this._pending = null;
      throw e;
    }
    // Echo validation happens in ViaDevice._validate so that every transport
    // (including the simulator) behaves identically.
    return answer;
  }
}

/** 2-digit hex helper for error messages. */
function hex2(n) {
  return (n & 0xff).toString(16).padStart(2, '0');
}

function detectReportSize(device) {
  try {
    const reports = (device.collections || []).flatMap((c) => c.outputReports || []);
    const pick = reports.find((r) => r.reportId === REPORT_ID) || reports[0];
    if (!pick) return DEFAULT_REPORT_SIZE;
    const bytes = (pick.items || []).reduce(
      (sum, item) => sum + item.reportCount * (item.reportSize / 8),
      0,
    );
    return bytes || DEFAULT_REPORT_SIZE;
  } catch {
    return DEFAULT_REPORT_SIZE;
  }
}
