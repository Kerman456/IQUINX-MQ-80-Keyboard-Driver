/**
 * Reusable keycode browser: vertical category rail + search + grid + the
 * advanced builders (layer actions, mod-tap, layer-tap, raw value).
 *
 * Used by the keymap editor, by macro actions, and by the per-key panel.
 */
import {
  buildKeycodeGroups,
  getBasicKeyDict,
  advancedRanges,
  labelForName,
  KC_NO,
  KC_TRNS,
} from '../driver/keycodes.js';

const TAP_BASE_KEYS = [
  'KC_A','KC_B','KC_C','KC_D','KC_E','KC_F','KC_G','KC_H','KC_I','KC_J','KC_K',
  'KC_L','KC_M','KC_N','KC_O','KC_P','KC_Q','KC_R','KC_S','KC_T','KC_U','KC_V',
  'KC_W','KC_X','KC_Y','KC_Z',
  'KC_1','KC_2','KC_3','KC_4','KC_5','KC_6','KC_7','KC_8','KC_9','KC_0',
  'KC_ESC','KC_TAB','KC_ENT','KC_SPC','KC_BSPC','KC_DEL','KC_GRV','KC_MINS',
  'KC_EQL','KC_LBRC','KC_RBRC','KC_BSLS','KC_SCLN','KC_QUOT','KC_COMM','KC_DOT',
  'KC_SLSH','KC_LEFT','KC_RGHT','KC_UP','KC_DOWN','KC_HOME','KC_END','KC_PGUP','KC_PGDN',
  'KC_F1','KC_F2','KC_F3','KC_F4','KC_F5','KC_F6','KC_F7','KC_F8','KC_F9','KC_F10','KC_F11','KC_F12',
];

const MOD_FLAGS = [
  { bit: 0x01, label: 'LCtrl' },
  { bit: 0x02, label: 'LShift' },
  { bit: 0x04, label: 'LAlt' },
  { bit: 0x08, label: 'LGui' },
  { bit: 0x11, label: 'RCtrl' },
  { bit: 0x12, label: 'RShift' },
  { bit: 0x14, label: 'RAlt' },
  { bit: 0x18, label: 'RGui' },
];

const LAYER_ACTIONS = [
  { id: 'momentary', label: 'MO', hint: '按住时激活该层' },
  { id: 'toggleLayer', label: 'TG', hint: '按一下锁定/解锁该层' },
  { id: 'to', label: 'TO', hint: '切换到该层' },
  { id: 'defLayer', label: 'DF', hint: '设为默认层' },
  { id: 'oneShotLayer', label: 'OSL', hint: '单次激活该层' },
  { id: 'layerTapToggle', label: 'TT', hint: '点按锁定该层' },
];

export class KeycodeBrowser {
  constructor({ definition, onPick, onError } = {}) {
    this.definition = definition;
    this.onPick = onPick;
    this.onError = onError;
    this.protocol = 12;
    this.layerCount = 4;
    this.activeId = 'basic';
    this.query = '';
    this.recent = [];
    this.el = document.createElement('div');
    this.el.className = 'kcb';
    this._build();
  }

  setContext({ protocol, layerCount }) {
    const nextProtocol = protocol !== undefined && protocol > 0 ? protocol : this.protocol;
    const nextLayers = layerCount !== undefined ? layerCount : this.layerCount;
    const changed =
      nextProtocol !== this.protocol || nextLayers !== this.layerCount || !this._rendered;
    this.protocol = nextProtocol;
    this.layerCount = nextLayers;
    if (changed) {
      this._groups = buildKeycodeGroups(this.definition, this.protocol);
      this._renderRail();
      this._renderAdvanced();
      this._renderBody();
      this._renderRecent();
      this._rendered = true;
    }
  }

  _build() {
    this.el.innerHTML = `
      <aside class="kcb-rail" data-rail></aside>
      <div class="kcb-main">
        <div class="kcb-search">
          <input type="search" placeholder="搜索键码 / MUTE / 音量 / F5" data-search />
        </div>
        <div class="kcb-recent" data-recent></div>
        <div class="kcb-body" data-body></div>
        <div class="kcb-advanced" data-advanced hidden></div>
      </div>`;
    this._railEl = this.el.querySelector('[data-rail]');
    this._bodyEl = this.el.querySelector('[data-body]');
    this._advEl = this.el.querySelector('[data-advanced]');
    this._recentEl = this.el.querySelector('[data-recent]');
    const search = this.el.querySelector('[data-search]');
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this._renderRail();
      this._renderBody();
    });
    this._searchEl = search;
    this._groups = buildKeycodeGroups(this.definition, this.protocol);
    this._renderRail();
    this._renderAdvanced();
    this._renderBody();
    this._renderRecent();
  }

  focus() {
    this._searchEl.focus();
  }

  reset() {
    this.query = '';
    if (this._searchEl) this._searchEl.value = '';
    this.activeId = 'basic';
    this._renderRail();
    this._renderBody();
  }

  pushRecent(item) {
    if (!item) return;
    this.recent = [item, ...this.recent.filter((r) => r.code !== item.code)].slice(0, 12);
    this._renderRecent();
  }

  setRecent(list) {
    this.recent = list || [];
    this._renderRecent();
  }

  _cats() {
    return [
      ...this._groups.map((g) => ({ id: g.id, title: g.title })),
      { id: 'advanced', title: '高级' },
    ];
  }

  _renderRail() {
    this._railEl.innerHTML = '';
    for (const cat of this._cats()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kcb-cat';
      b.textContent = cat.title;
      b.classList.toggle('is-active', cat.id === this.activeId && !this.query);
      b.addEventListener('click', () => {
        this.activeId = cat.id;
        this.query = '';
        if (this._searchEl) this._searchEl.value = '';
        this._renderRail();
        this._renderBody();
      });
      this._railEl.appendChild(b);
    }
    if (this.query) {
      const hint = document.createElement('div');
      hint.className = 'kcb-cat-hint';
      hint.textContent = '搜索结果';
      this._railEl.appendChild(hint);
    }
  }

  _renderRecent() {
    this._recentEl.innerHTML = '';
    if (!this.recent.length) {
      this._recentEl.hidden = true;
      return;
    }
    this._recentEl.hidden = false;
    const label = document.createElement('span');
    label.className = 'kcb-recent-label';
    label.textContent = '最近';
    this._recentEl.appendChild(label);
    for (const item of this.recent) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kcb-chip mini';
      b.textContent = item.label || item.name || `0x${item.code.toString(16)}`;
      b.title = `${item.name || ''}  0x${item.code.toString(16).toUpperCase().padStart(4, '0')}`;
      b.addEventListener('click', () => this._pick(item.code));
      this._recentEl.appendChild(b);
    }
  }

  _renderBody() {
    const advanced = this.activeId === 'advanced' && !this.query;
    this._advEl.hidden = !advanced;
    this._bodyEl.hidden = advanced;
    if (advanced) return;

    let items;
    if (this.query) {
      items = this._groups.flatMap((g) => g.items).filter((it) => matches(it, this.query));
    } else {
      const group = this._groups.find((g) => g.id === this.activeId) || this._groups[0];
      items = group ? group.items : [];
    }

    this._bodyEl.innerHTML = '';
    if (!items.length) {
      this._bodyEl.innerHTML = '<div class="empty">没有匹配的键码</div>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'kc-grid';
    for (const item of items) {
      grid.appendChild(this._chip(item));
    }
    this._bodyEl.appendChild(grid);
  }

  _chip(item) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kcb-chip';
    b.innerHTML = '<span class="kc-label"></span><span class="kc-meta"></span>';
    b.querySelector('.kc-label').textContent =
      item.label || item.name || (item.code === KC_NO ? '▽' : '');
    b.querySelector('.kc-meta').textContent = item.title || item.name || '';
    b.title = `${item.name || ''}   0x${item.code.toString(16).toUpperCase().padStart(4, '0')}`;
    b.addEventListener('click', () => this._pick(item.code, item));
    return b;
  }

  _pick(code, item) {
    if (item) this.pushRecent(item);
    else {
      this.pushRecent({ code, label: code === KC_NO ? '无' : '', name: '' });
    }
    this.onPick?.(code);
  }

  _renderAdvanced() {
    const dict = getBasicKeyDict(this.protocol);
    const r = advancedRanges(dict);
    const layers = Array.from({ length: this.layerCount }, (_, i) => i);
    const tapOptions = TAP_BASE_KEYS.filter((n) => dict[n] !== undefined)
      .map((n) => `<option value="${n}">${labelForName(n)} (${n})</option>`)
      .join('');

    this._advEl.innerHTML = `
      <section class="adv-block">
        <h4>常用</h4>
        <div class="adv-row wrap">
          <button class="btn small ghost" data-quick="none">▽ 无（不触发）</button>
          <button class="btn small ghost" data-quick="trns">▽ 透传（用下层）</button>
        </div>
      </section>

      <section class="adv-block">
        <h4>层操作</h4>
        <div class="adv-row wrap">
          ${LAYER_ACTIONS.map(
            (a) =>
              `<label class="seg"><input type="radio" name="lay-act" value="${a.id}" ${
                a.id === 'momentary' ? 'checked' : ''
              }/><span>${a.label}</span><i>${a.hint}</i></label>`,
          ).join('')}
        </div>
        <div class="adv-row">
          <select data-layer-num>${layers
            .map((n) => `<option value="${n}">Layer ${n}</option>`)
            .join('')}</select>
          <button class="btn small" data-apply-layer>应用</button>
        </div>
      </section>

      <section class="adv-block">
        <h4>Mod-Tap<span class="adv-note">按住＝修饰键，单击＝普通键</span></h4>
        <div class="adv-row wrap" data-modflags>
          ${MOD_FLAGS.map(
            (m) =>
              `<label class="chk"><input type="checkbox" value="${m.bit}" /> ${m.label}</label>`,
          ).join('')}
        </div>
        <div class="adv-row">
          <select data-mt-key>${tapOptions}</select>
          <button class="btn small" data-apply-mt>应用</button>
        </div>
      </section>

      <section class="adv-block">
        <h4>Layer-Tap<span class="adv-note">按住＝切层，单击＝普通键</span></h4>
        <div class="adv-row">
          <select data-lt-layer>${layers
            .map((n) => `<option value="${n}">Layer ${n}</option>`)
            .join('')}</select>
          <select data-lt-key>${tapOptions}</select>
          <button class="btn small" data-apply-lt>应用</button>
        </div>
      </section>

      <section class="adv-block">
        <h4>直接输入</h4>
        <div class="adv-row">
          <input type="text" data-raw placeholder="如 KC_MUTE 或 0x00A8" />
          <button class="btn small" data-apply-raw>应用</button>
        </div>
      </section>`;

    this._advEl.querySelector('[data-apply-layer]').addEventListener('click', () => {
      const id = this._advEl.querySelector('input[name="lay-act"]:checked')?.value || 'momentary';
      const n = Number(this._advEl.querySelector('[data-layer-num]').value);
      this._pick(r[id][0] + n);
    });
    this._advEl.querySelector('[data-apply-mt]').addEventListener('click', () => {
      let mask = 0;
      this._advEl.querySelectorAll('[data-modflags] input:checked').forEach((c) => {
        mask |= Number(c.value);
      });
      if (!mask) {
        this.onError?.('请至少勾选一个修饰键');
        return;
      }
      const base = dict[this._advEl.querySelector('[data-mt-key]').value] & 0xff;
      this._pick(r.modTap[0] + (mask << 8) + base);
    });
    this._advEl.querySelector('[data-apply-lt]').addEventListener('click', () => {
      const layer = Number(this._advEl.querySelector('[data-lt-layer]').value);
      const base = dict[this._advEl.querySelector('[data-lt-key]').value] & 0xff;
      this._pick(r.layerTap[0] + (layer << 8) + base);
    });
    this._advEl.querySelector('[data-apply-raw]').addEventListener('click', () => {
      const code = parseRaw(this._advEl.querySelector('[data-raw]').value.trim(), dict);
      if (code === null) {
        this.onError?.('无法识别，请输入 KC_ 名称或 0x 十六进制值');
        return;
      }
      this._pick(code);
    });
    for (const b of this._advEl.querySelectorAll('[data-quick]')) {
      b.addEventListener('click', () => this._pick(b.dataset.quick === 'trns' ? KC_TRNS : KC_NO));
    }
  }
}

function parseRaw(raw, dict) {
  if (!raw) return null;
  if (/^0x[0-9a-f]+$/i.test(raw)) return parseInt(raw, 16);
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const upper = raw.toUpperCase();
  if (dict[upper] !== undefined) return dict[upper];
  return null;
}

function matches(item, q) {
  const hay = `${item.name || ''} ${item.label || ''} ${item.title || ''}`.toLowerCase();
  return hay.includes(q);
}
