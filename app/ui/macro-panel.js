/**
 * Macro editor.
 *
 * Reads / writes the keyboard macro buffer through the VIA macro commands and
 * lets you compose each macro from taps, holds, releases, delays and literal
 * text — including recording straight from the host keyboard.
 */
import {
  ACTION,
  decodeMacros,
  encodeMacros,
  supportsDelay,
} from '../driver/macro.js';
import {
  basicByteToName,
  basicNameToByte,
  labelForName,
} from '../driver/keycodes.js';
import { openKeycodeModal } from './key-editor.js';

export class MacroPanel {
  constructor({ definition, onStatus }) {
    this.definition = definition;
    this.onStatus = onStatus;
    this.device = null;
    this.protocol = 12;
    this.macroCount = 0;
    this.bufferSize = 0;
    this.macros = [];
    this.active = 0;
    this.recording = false;
    this.el = document.createElement('div');
    this.el.className = 'macro-panel';
    this._build();
  }

  setDevice(device) {
    this.device = device;
  }

  setContext({ protocol }) {
    if (protocol) this.protocol = protocol;
    this._renderEditor();
  }

  /** Render the current state (called by the shell when the tab is opened). */
  render() {
    if (!this.macroCount) {
      this._renderEmpty();
      return;
    }
    this._renderList();
    this._renderEditor();
  }

  _build() {
    this.el.innerHTML = `
      <div class="card">
        <h3>宏编辑</h3>
        <div class="card-body">
          <div class="macro-toolbar">
            <button class="btn small" data-read>从键盘读取</button>
            <button class="btn small" data-save>保存到键盘</button>
            <button class="btn small ghost" data-reset>清空所有宏</button>
            <span class="macro-usage" data-usage></span>
          </div>
          <div class="macro-layout">
            <div class="macro-list" data-list></div>
            <div class="macro-detail" data-detail></div>
          </div>
        </div>
      </div>`;

    this._listEl = this.el.querySelector('[data-list]');
    this._detailEl = this.el.querySelector('[data-detail]');
    this._usageEl = this.el.querySelector('[data-usage]');

    this.el.querySelector('[data-read]').addEventListener('click', () => this.refresh());
    this.el.querySelector('[data-save]').addEventListener('click', () => this.save());
    this.el.querySelector('[data-reset]').addEventListener('click', () => this.resetAll());
    this._renderEmpty();
  }

  /* --------------------------------------------------------------- */

  async refresh() {
    if (!this.device) return;
    try {
      this.macroCount = await this.device.getMacroCount();
      this.bufferSize = await this.device.getMacroBufferSize();
      if (!this.macroCount || !this.bufferSize) {
        this.macros = [];
        this._renderEmpty('此键盘固件未启用宏功能（宏数量或缓冲区为 0）。');
        return;
      }
      const bytes = await this.device.getMacroBytes();
      const byteToName = basicByteToName(this.protocol);
      this.macros = decodeMacros(bytes, this.macroCount, this.protocol, byteToName);
      this.active = Math.min(this.active, this.macroCount - 1);
      this._renderList();
      this._renderEditor();
      this.onStatus?.({ ok: true, message: `已读取 ${this.macroCount} 个宏` });
    } catch (e) {
      this._renderEmpty(`读取宏失败：${e.message}`);
      this.onStatus?.({ ok: false, message: `读取宏失败：${e.message}` });
    }
  }

  async save() {
    if (!this.device) return;
    try {
      const bytes = this._encoded();
      await this.device.setMacroBytes(bytes);
      const readback = decodeMacros(
        await this.device.getMacroBytes(),
        this.macroCount,
        this.protocol,
        basicByteToName(this.protocol),
      );
      this.macros = readback;
      this._renderList();
      this._renderEditor();
      this.onStatus?.({ ok: true, message: `宏已保存（${bytes.length} 字节）` });
    } catch (e) {
      this.onStatus?.({ ok: false, message: `保存宏失败：${e.message}` });
    }
  }

  async resetAll() {
    if (!this.device) return;
    if (!confirm('清空键盘上的所有宏？')) return;
    try {
      await this.device.resetMacros();
      this.macros = Array.from({ length: this.macroCount || 0 }, () => []);
      this._renderList();
      this._renderEditor();
      this.onStatus?.({ ok: true, message: '所有宏已清空' });
    } catch (e) {
      this.onStatus?.({ ok: false, message: `清空失败：${e.message}` });
    }
  }

  _encoded() {
    return encodeMacros(this.macros, this.protocol, basicNameToByte(this.protocol));
  }

  _renderEmpty(msg) {
    this._listEl.hidden = true;
    this._usageEl.textContent = '';
    this._detailEl.innerHTML = `<div class="empty">${
      msg || '尚未读取键盘宏。连接键盘后点击「从键盘读取」。'
    }</div>`;
  }

  /* --------------------------------------------------------------- */

  _seq(i) {
    if (!this.macros[i]) this.macros[i] = [];
    return this.macros[i];
  }

  _renderList() {
    this._listEl.hidden = false;
    this._listEl.innerHTML = '<div class="macro-list-title">宏</div>';
    const sizes = this.macros.map((s) => this._seqSize(s));
    for (let i = 0; i < this.macroCount; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'macro-item';
      b.classList.toggle('is-active', i === this.active);
      b.innerHTML = `<span>M${i + 1}</span><i>${sizes[i] ? `${sizes[i]}B` : '空'}</i>`;
      b.addEventListener('click', () => {
        this.active = i;
        this._renderList();
        this._renderEditor();
      });
      this._listEl.appendChild(b);
    }
  }

  _seqSize(seq) {
    const one = encodeMacros([seq], this.protocol, basicNameToByte(this.protocol)).length;
    return Math.max(0, one - 1); // exclude the terminator
  }

  _renderEditor() {
    if (!this.macroCount) return;
    const seq = this._seq(this.active);
    const used = this._encoded().length;

    this._usageEl.textContent = this.bufferSize
      ? `缓冲区占用 ${used} / ${this.bufferSize} 字节`
      : '';
    this._usageEl.classList.toggle('is-full', this.bufferSize > 0 && used > this.bufferSize);

    this._detailEl.innerHTML = `
      <div class="macro-detail-head">
        <b>宏 M${this.active + 1}</b>
        <span class="muted">${this._seqSize(seq)} 字节</span>
      </div>
      <div class="macro-actions">
        <button class="btn small" data-add="tap">＋ 单击</button>
        <button class="btn small" data-add="down">＋ 按下</button>
        <button class="btn small" data-add="up">＋ 抬起</button>
        <button class="btn small" data-add="delay" ${
          supportsDelay(this.protocol) ? '' : 'disabled title="需要协议 v11 及以上"'
        }>＋ 延迟</button>
        <button class="btn small" data-add="text">＋ 文本</button>
        <button class="btn small ghost" data-record>● 录制</button>
        <button class="btn small ghost" data-clear>清空本宏</button>
      </div>
      <div class="macro-seq" data-seq></div>
      <p class="hint">按顺序执行；「单击」按下并立即抬起，「按下 / 抬起」用于组合键，例如 Ctrl+C = 按下 Ctrl → 单击 C → 抬起 Ctrl。</p>
    `;

    for (const b of this._detailEl.querySelectorAll('[data-add]')) {
      b.addEventListener('click', () => this._addAction(b.dataset.add));
    }
    this._detailEl.querySelector('[data-record]').addEventListener('click', (e) =>
      this._toggleRecord(e.currentTarget),
    );
    this._detailEl.querySelector('[data-clear]').addEventListener('click', () => {
      this.macros[this.active] = [];
      this._renderList();
      this._renderEditor();
    });

    this._renderSeq();
  }

  _renderSeq() {
    const host = this._detailEl.querySelector('[data-seq]');
    if (!host) return;
    host.innerHTML = '';
    const seq = this._seq(this.active);
    if (!seq.length) {
      host.innerHTML = '<div class="empty small">空的宏。用上面的按钮添加动作，或点「录制」直接按键。</div>';
      return;
    }
    seq.forEach((item, idx) => {
      const chip = document.createElement('div');
      chip.className = `macro-chip act-${item.action}`;
      const badge = { tap: '单击', down: '按下', up: '抬起', delay: '延迟', text: '文本' }[item.action];
      const value = item.action === 'delay' ? `${item.value} ms` : String(item.value);
      chip.innerHTML = `
        <span class="mc-idx">${idx + 1}</span>
        <span class="mc-badge">${badge}</span>
        <span class="mc-value"></span>
        <span class="mc-tools">
          <button class="mc-btn" data-move="-1" title="前移">‹</button>
          <button class="mc-btn" data-move="1" title="后移">›</button>
          <button class="mc-btn" data-del title="删除">✕</button>
        </span>`;
      chip.querySelector('.mc-value').textContent =
        item.action === 'text' || item.action === 'delay' ? value : labelForName(item.value) || value;
      chip.title = item.action === 'text' ? '双击编辑文本' : '双击编辑';

      chip.querySelector('[data-del]').addEventListener('click', (e) => {
        e.stopPropagation();
        seq.splice(idx, 1);
        this._renderList();
        this._renderEditor();
      });
      for (const mb of chip.querySelectorAll('[data-move]')) {
        mb.addEventListener('click', (e) => {
          e.stopPropagation();
          const dir = Number(mb.dataset.move);
          const to = idx + dir;
          if (to < 0 || to >= seq.length) return;
          [seq[idx], seq[to]] = [seq[to], seq[idx]];
          this._renderEditor();
        });
      }
      chip.addEventListener('dblclick', () => this._editAction(idx));
      host.appendChild(chip);
    });
  }

  _editAction(idx) {
    const seq = this._seq(this.active);
    const item = seq[idx];
    if (!item) return;
    if (item.action === ACTION.TEXT) {
      const next = prompt('文本内容：', item.value);
      if (next === null) return;
      item.value = next;
      this._renderEditor();
      return;
    }
    if (item.action === ACTION.DELAY) {
      const next = prompt('延迟毫秒数：', String(item.value));
      if (next === null) return;
      item.value = Math.max(0, parseInt(next, 10) || 0);
      this._renderEditor();
      return;
    }
    openKeycodeModal({
      definition: this.definition,
      protocol: this.protocol,
      layerCount: 4,
      title: `修改动作 · ${idx + 1}`,
      onPick: (code) => {
        item.value = this._nameFor(code);
        this._renderEditor();
      },
    });
  }

  _nameFor(code) {
    const map = basicByteToName(this.protocol);
    return map[code & 0xff] || 'KC_NO';
  }

  _addAction(kind) {
    const seq = this._seq(this.active);
    if (kind === 'delay') {
      seq.push({ action: ACTION.DELAY, value: 100 });
      this._renderEditor();
      return;
    }
    if (kind === 'text') {
      const text = prompt('要输入的文本：', '');
      if (!text) return;
      seq.push({ action: ACTION.TEXT, value: text });
      this._renderEditor();
      return;
    }
    const action = { tap: ACTION.TAP, down: ACTION.DOWN, up: ACTION.UP }[kind];
    openKeycodeModal({
      definition: this.definition,
      protocol: this.protocol,
      layerCount: 4,
      title: `添加动作 · ${{ tap: '单击', down: '按下', up: '抬起' }[kind]}`,
      onPick: (code) => {
        seq.push({ action, value: this._nameFor(code) });
        this._renderEditor();
      },
    });
  }

  /* ------------------------------ recording ----------------------- */

  _toggleRecord(btn) {
    this.recording = !this.recording;
    btn.classList.toggle('is-recording', this.recording);
    btn.textContent = this.recording ? '■ 停止录制' : '● 录制';
    if (this.recording) {
      this._handler = (e) => this._onRecordKey(e);
      window.addEventListener('keydown', this._handler, true);
      window.addEventListener('keyup', this._handler, true);
      this.onStatus?.({ ok: true, message: '录制中：直接按下键盘上的按键' });
    } else {
      window.removeEventListener('keydown', this._handler, true);
      window.removeEventListener('keyup', this._handler, true);
      this._optimize();
      this._renderList();
      this._renderEditor();
      this.onStatus?.({ ok: true, message: '录制结束' });
    }
  }

  _onRecordKey(e) {
    if (!this.recording) return;
    if (e.key === 'Escape') {
      const btn = this._detailEl.querySelector('[data-record]');
      if (btn) this._toggleRecord(btn);
      return;
    }
    const name = CODE_TO_NAME[e.code];
    if (!name) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const seq = this._seq(this.active);
    seq.push({ action: e.type === 'keydown' ? ACTION.DOWN : ACTION.UP, value: name });
    this._renderSeq();
  }

  /** Merge immediate Down(x)+Up(x) pairs into a single tap. */
  _optimize() {
    const seq = this._seq(this.active);
    const out = [];
    for (let i = 0; i < seq.length; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      if (
        a.action === ACTION.DOWN &&
        b &&
        b.action === ACTION.UP &&
        a.value === b.value
      ) {
        out.push({ action: ACTION.TAP, value: a.value });
        i++;
      } else {
        out.push(a);
      }
    }
    this.macros[this.active] = out;
  }
}

/** KeyboardEvent.code -> QMK keycode name (single-byte keycodes only). */
const CODE_TO_NAME = (() => {
  const map = {};
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => {
    map[`Key${c}`] = `KC_${c}`;
    void i;
  });
  '1234567890'.split('').forEach((d) => {
    map[`Digit${d}`] = `KC_${d}`;
    map[`Numpad${d}`] = `KC_P${d}`;
  });
  Object.assign(map, {
    Enter: 'KC_ENT', NumpadEnter: 'KC_PENT', Escape: 'KC_ESC', Backspace: 'KC_BSPC',
    Tab: 'KC_TAB', Space: 'KC_SPC', CapsLock: 'KC_CAPS',
    Minus: 'KC_MINS', Equal: 'KC_EQL', BracketLeft: 'KC_LBRC', BracketRight: 'KC_RBRC',
    Backslash: 'KC_BSLS', Semicolon: 'KC_SCLN', Quote: 'KC_QUOT', Backquote: 'KC_GRV',
    Comma: 'KC_COMM', Period: 'KC_DOT', Slash: 'KC_SLSH',
    ArrowLeft: 'KC_LEFT', ArrowRight: 'KC_RGHT', ArrowUp: 'KC_UP', ArrowDown: 'KC_DOWN',
    Home: 'KC_HOME', End: 'KC_END', PageUp: 'KC_PGUP', PageDown: 'KC_PGDN',
    Insert: 'KC_INS', Delete: 'KC_DEL',
    ShiftLeft: 'KC_LSFT', ShiftRight: 'KC_RSFT',
    ControlLeft: 'KC_LCTL', ControlRight: 'KC_RCTL',
    AltLeft: 'KC_LALT', AltRight: 'KC_RALT',
    MetaLeft: 'KC_LGUI', MetaRight: 'KC_RGUI',
    PrintScreen: 'KC_PSCR', ScrollLock: 'KC_SLCK', Pause: 'KC_PAUS', ContextMenu: 'KC_APP',
    NumpadAdd: 'KC_PPLS', NumpadSubtract: 'KC_PMNS', NumpadMultiply: 'KC_PAST',
    NumpadDivide: 'KC_PSLS', NumpadDecimal: 'KC_PDOT', NumLock: 'KC_NLCK',
    AudioVolumeUp: 'KC_VOLU', AudioVolumeDown: 'KC_VOLD', AudioVolumeMute: 'KC_MUTE',
  });
  for (let i = 1; i <= 24; i++) map[`F${i}`] = `KC_F${i}`;
  return map;
})();
