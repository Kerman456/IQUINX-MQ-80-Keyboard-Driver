/**
 * Key editor — the persistent right-hand panel used by the 键位映射 tab,
 * plus a modal variant of the same browser for other tabs (macro actions).
 */
import { KeycodeBrowser } from './keycode-browser.js';
import { describeCode, codeToName, KC_NO, KC_TRNS } from '../driver/keycodes.js';

export class KeyEditorPanel {
  constructor({ definition, onAssign, onClose }) {
    this.definition = definition;
    this.onAssign = onAssign;
    this.onClose = onClose;
    this.selection = [];
    this.layer = 0;
    this.protocol = 12;

    this.el = document.createElement('aside');
    this.el.className = 'key-editor';
    this.el.innerHTML = `
      <header class="ke-head">
        <div class="ke-title">
          <b data-title>键位编辑</b>
          <span data-subtitle>点击键盘上的任意键位开始</span>
        </div>
        <button class="icon-btn" data-close title="收起面板">✕</button>
      </header>
      <div class="ke-current" data-current>
        <div class="ke-current-code">
          <span class="ke-code-label" data-cur-label>—</span>
          <span class="ke-code-hex" data-cur-hex></span>
        </div>
        <div class="ke-quick">
          <button class="btn small ghost" data-quick="trns" title="透传到下一层">▽ 透传</button>
          <button class="btn small ghost" data-quick="none" title="不触发任何按键">▽ 无</button>
          <button class="btn small ghost" data-quick="copy" title="复制这个键码">复制</button>
          <button class="btn small ghost" data-quick="paste" title="粘贴已复制的键码">粘贴</button>
        </div>
      </div>
      <div class="ke-browser" data-browser></div>
    `;
    this._titleEl = this.el.querySelector('[data-title]');
    this._subEl = this.el.querySelector('[data-subtitle]');
    this._curLabel = this.el.querySelector('[data-cur-label]');
    this._curHex = this.el.querySelector('[data-cur-hex]');
    this.el.querySelector('[data-close]').addEventListener('click', () => this.onClose?.());
    for (const b of this.el.querySelectorAll('[data-quick]')) {
      b.addEventListener('click', () => {
        const q = b.dataset.quick;
        if (q === 'trns') this.onAssign?.(KC_TRNS, { kind: 'set' });
        else if (q === 'none') this.onAssign?.(KC_NO, { kind: 'set' });
        else this.onAssign?.(null, { kind: q });
      });
    }

    this.browser = new KeycodeBrowser({
      definition,
      onPick: (code) => this.onAssign?.(code, { kind: 'set' }),
      onError: (msg) => this._flash(msg),
    });
    this.el.querySelector('[data-browser]').appendChild(this.browser.el);

    this._pasteAvailable = false;
  }

  setContext({ protocol, layerCount }) {
    this.protocol = protocol ?? this.protocol;
    this.browser.setContext({ protocol, layerCount });
  }

  setClipboardState(has) {
    this._pasteAvailable = has;
    const btn = this.el.querySelector('[data-quick="paste"]');
    btn.disabled = !has;
  }

  /** @param {Array<{matrix:number[], code:number}>} selection */
  show(selection, layer) {
    this.selection = selection || [];
    this.layer = layer;
    const n = this.selection.length;
    if (!n) {
      this._titleEl.textContent = '键位编辑';
      this._subEl.textContent = '点击键盘上的任意键位开始';
      this._curLabel.textContent = '—';
      this._curHex.textContent = '';
      return;
    }
    if (n === 1) {
      const { matrix, code } = this.selection[0];
      const info = describeCode(code, this.definition, this.protocol);
      const name = info.custom ? '自定义键码' : codeToName(code, this.protocol);
      this._titleEl.textContent = `位置 ${matrix.join(',')} · 图层 ${layer}`;
      this._subEl.textContent = '选择下方键码即可替换';
      this._curLabel.textContent = info.label || '（无）';
      this._curLabel.classList.toggle('is-blank', !info.label);
      this._curHex.textContent = [name, `0x${code.toString(16).toUpperCase().padStart(4, '0')}`]
        .filter(Boolean)
        .join('   ·   ');
    } else {
      this._titleEl.textContent = `已选中 ${n} 个键位`;
      this._subEl.textContent = `在图层 ${layer} 上批量替换`;
      this._curLabel.textContent = `${n} 个键`;
      this._curHex.textContent = '选择一个键码应用到全部';
    }
  }

  focus() {
    this.browser.focus();
  }

  _flash(msg) {
    this._subEl.textContent = msg;
    this._subEl.classList.add('is-warn');
    clearTimeout(this._warnTimer);
    this._warnTimer = setTimeout(() => {
      this._subEl.classList.remove('is-warn');
      this.show(this.selection, this.layer);
    }, 2200);
  }
}

/**
 * Modal keycode picker sharing the same browser — returns a handle so the
 * caller can close it.
 */
export function openKeycodeModal({ definition, protocol, layerCount, title, onPick, onClose }) {
  const host = document.createElement('div');
  host.className = 'modal-host';
  host.innerHTML = `
    <div class="modal">
      <header class="modal-head">
        <b data-title></b>
        <button class="icon-btn" data-close title="关闭">✕</button>
      </header>
      <div class="modal-body" data-browser></div>
    </div>`;
  host.querySelector('[data-title]').textContent = title || '选择键码';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    host.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const browser = new KeycodeBrowser({
    definition,
    onPick: (code) => {
      onPick?.(code);
      close();
    },
  });
  browser.setContext({ protocol, layerCount });
  host.querySelector('[data-browser]').appendChild(browser.el);
  host.querySelector('[data-close]').addEventListener('click', close);
  host.addEventListener('click', (e) => {
    if (e.target === host) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(host);
  setTimeout(() => browser.focus(), 30);
  return { close, browser };
}
