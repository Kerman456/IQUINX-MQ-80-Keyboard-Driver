/**
 * Renders a VIA / KLE keyboard layout into a clickable keycap grid.
 *
 * The definition stores its layout in KLE "keymap" form: each row is an array
 * where plain strings are key legends and objects carry the geometry / colour
 * for the keys that follow. Legend 0 is the "row,col" matrix position; legend
 * 6 (bottom-right) may hold an LED index such as "l12".
 */
import { describeCode } from '../driver/keycodes.js';

const UNIT = 46; // px per 1u
const GAP = 4;
const LED_REGEX = /^[lL]\d+\s*$/;

export function parseLayout(definition) {
  const raw = definition?.layouts?.keymap || [];
  const rows = [];
  let y = 0;
  let order = 0;

  for (const rawRow of raw) {
    let w = 1;
    let h = 1;
    let x = 0;
    let color = null;
    let cursor = 0;
    let maxH = 1;
    const keys = [];

    for (const token of rawRow) {
      if (token && typeof token === 'object') {
        if (token.w !== undefined) w = token.w;
        if (token.h !== undefined) h = token.h;
        if (token.x !== undefined) cursor += token.x;
        if (token.y !== undefined) y += token.y;
        if (token.c !== undefined) color = token.c;
        continue;
      }
      if (typeof token !== 'string') continue;

      const legends = token.split('\n');
      const [r, c] = legends[0].split(',').map(Number);
      const led = legends[6];
      const li = led && LED_REGEX.test(led) ? Number(led.trim().slice(1)) : null;

      keys.push({ matrix: [r, c], x: cursor, y, w, h, color, li, order: order++ });
      cursor += w;
      maxH = Math.max(maxH, h);
    }
    rows.push({ height: maxH, keys });
    y += maxH;
  }
  return rows;
}

const COLOR_SLOT = {
  '#777777': 'accent',
  '#aaaaaa': 'mod',
  '#cccccc': 'alpha',
};

export class KeyboardView {
  constructor(definition, { onKeyClick, onKeyHover } = {}) {
    this.definition = definition;
    this.rows = parseLayout(definition);
    this.onKeyClick = onKeyClick;
    this.onKeyHover = onKeyHover;
    this.protocol = 12;
    this.counts = definition?.matrix || {
      rows: Math.max(...this.rows.flatMap((r) => r.keys.map((k) => k.matrix[0]))) + 1,
      cols: Math.max(...this.rows.flatMap((r) => r.keys.map((k) => k.matrix[1]))) + 1,
    };
    /** flat list of keys in KLE order — used as the default LED index order */
    this.keys = this.rows.flatMap((r) => r.keys);
    this.el = document.createElement('div');
    this.el.className = 'kbd-view';
    this._keyEls = new Map();
    this._selection = new Set();
    this._flat = null;
    this._build();
  }

  _build() {
    const width = Math.max(
      ...this.rows.map((r) => r.keys.reduce((m, k) => Math.max(m, k.x + k.w), 0)),
    );
    const height = this.rows.reduce((sum, r) => sum + r.height, 0);
    this.width = width * UNIT + GAP;
    this.height = height * UNIT + GAP;
    this.el.style.width = `${this.width}px`;
    this.el.style.height = `${this.height}px`;

    for (const key of this.keys) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `keycap cap-${COLOR_SLOT[key.color] || 'alpha'}`;
      el.style.left = `${key.x * UNIT + GAP / 2}px`;
      el.style.top = `${key.y * UNIT + GAP / 2}px`;
      el.style.width = `${key.w * UNIT - GAP}px`;
      el.style.height = `${key.h * UNIT - GAP}px`;
      el.dataset.id = key.matrix.join(',');
      el.innerHTML = '<span class="cap-label"></span><span class="cap-sub"></span>';
      el.addEventListener('click', (ev) => this.onKeyClick?.(key, ev));
      el.addEventListener('mouseenter', () => this.onKeyHover?.(key));
      this.el.appendChild(el);
      this._keyEls.set(key.matrix.join(','), el);
    }
  }

  /** @param {number[]} flat rows*cols keycodes */
  setKeymap(flat) {
    this._flat = flat;
    for (const key of this.keys) {
      const el = this._keyEls.get(key.matrix.join(','));
      if (!el) continue;
      const [r, c] = key.matrix;
      const code = flat?.[r * this.counts.cols + c] ?? 0;
      const info = describeCode(code, this.definition, this.protocol);
      el.querySelector('.cap-label').textContent = info.label || '';
      el.querySelector('.cap-sub').textContent = info.sub || '';
      el.classList.toggle('is-transparent', !!info.transparent);
      el.classList.toggle('is-custom', !!info.custom);
      el.title = `位置 ${key.matrix.join(',')}   ·   0x${code
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')}`;
    }
  }

  setProtocol(protocol) {
    this.protocol = protocol;
    if (this._flat) this.setKeymap(this._flat);
  }

  /** Highlight a set of "row,col" ids. */
  setSelection(ids) {
    const next = new Set(ids || []);
    for (const [id, el] of this._keyEls) el.classList.toggle('is-selected', next.has(id));
    this._selection = next;
  }

  /**
   * Scale the board down so it always fits its container width — keeps the
   * whole layout visible when the editor panel is open.
   */
  fit() {
    const host = this.el.parentElement;
    if (!host) return;
    const available = host.clientWidth - 4;
    const scale = available > 0 ? Math.min(1, available / this.width) : 1;
    this.el.style.transformOrigin = 'top left';
    this.el.style.transform = scale < 1 ? `scale(${scale})` : '';
    host.style.height = scale < 1 ? `${this.height * scale}px` : '';
  }
}

export { UNIT };
