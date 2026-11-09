/**
 * Lighting / custom-menu panel.
 *
 * Renders the `menus` tree from the keyboard definition (the "custom UI"
 * format described at https://www.caniusevia.com/docs/custom_ui) and binds
 * every control to the device through the CUSTOM_MENU get/set/save commands.
 *
 * For the MQ80 that is channel 3 (qmk rgb matrix):
 *   value 1 = brightness (0-9)   value 2 = effect (0-18)
 *   value 3 = effect speed (0-4) value 4 = colour (hue, sat)
 */

const CHANNEL_LABEL = {
  1: 'Backlight',
  2: 'RGBLight',
  3: 'RGB Matrix',
  4: 'Audio',
  5: 'LED Matrix',
};

export class LightingPanel {
  constructor({ definition, onStatus }) {
    this.definition = definition;
    this.onStatus = onStatus;
    this.device = null;
    this.values = {}; // token -> number | number[]
    this.controls = []; // flattened control list
    this.el = document.createElement('div');
    this.el.className = 'lighting-panel';
    this._collectControls();
  }

  setDevice(device) {
    this.device = device;
  }

  setContext() {
    /* lighting only needs the menu definition — kept for a uniform panel API */
  }

  /** Public alias used by the shell after a (re)render. */
  syncVisibility() {
    this._syncVisibility();
  }

  _menus() {
    const menus = this.definition?.menus;
    if (!Array.isArray(menus)) return [];
    return menus.filter((m) => m && typeof m === 'object');
  }

  _collectControls() {
    this.controls = [];
    const walk = (node, trail) => {
      if (!node || typeof node !== 'object') return;
      if (node.type) {
        const cmd = Array.isArray(node.content) ? node.content.slice(1) : [];
        this.controls.push({
          label: node.label,
          type: node.type,
          options: node.options,
          showIf: node.showIf,
          token: Array.isArray(node.content) ? node.content[0] : null,
          command: cmd,
          trail: trail.join(' / '),
          bytes: node.bytes || (Array.isArray(node.options) && node.options[1] > 255 ? 2 : 1),
        });
        return;
      }
      const nextTrail = node.label ? trail.concat([node.label]) : trail;
      if (Array.isArray(node.content)) node.content.forEach((c) => walk(c, nextTrail));
    };
    this._menus().forEach((m) => walk(m, []));
  }

  /** Read every bound value from the device. */
  async refresh() {
    if (!this.device) return;
    const jobs = this.controls
      .filter((c) => c.token)
      .map(async (c) => {
        try {
          const raw = await this.device.getCustomMenuValue(c.command);
          if (c.type === 'color') this.values[c.token] = [raw[0] ?? 0, raw[1] ?? 0];
          else if (c.type === 'range' && c.bytes === 2) this.values[c.token] = ((raw[0] ?? 0) << 8) | (raw[1] ?? 0);
          else this.values[c.token] = raw[0] ?? 0;
        } catch (e) {
          this.values[c.token] = 0;
        }
      });
    await Promise.all(jobs);
  }

  render() {
    this.el.innerHTML = '';
    const menus = this._menus();
    if (!menus.length) {
      this.el.innerHTML = '<div class="empty">此键盘定义没有自定义菜单。</div>';
      return;
    }
    for (const menu of menus) {
      const card = document.createElement('section');
      card.className = 'card';
      card.innerHTML = `<h3>${escapeHtml(menu.label || 'Menu')}</h3>`;
      const body = document.createElement('div');
      body.className = 'card-body';
      card.appendChild(body);
      this._renderNodes(menu.content, body, []);
      this.el.appendChild(card);
    }
  }

  _renderNodes(nodes, container, trail) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      if (node.type) {
        container.appendChild(this._renderControl(node, trail));
        continue;
      }
      const nextTrail = node.label ? trail.concat([node.label]) : trail;
      if (Array.isArray(node.content)) {
        const wrap = document.createElement('div');
        wrap.className = 'group';
        wrap.dataset.trail = nextTrail.join('>');
        if (node.showIf) wrap.dataset.showIf = node.showIf;
        if (node.label) wrap.innerHTML = `<h4>${escapeHtml(node.label)}</h4>`;
        this._renderNodes(node.content, wrap, nextTrail);
        container.appendChild(wrap);
      }
    }
  }

  _renderControl(node, trail) {
    const row = document.createElement('div');
    row.className = 'ctl';
    const cmd = Array.isArray(node.content) ? node.content.slice(1) : [];
    const token = Array.isArray(node.content) ? node.content[0] : null;
    const channel = cmd[0];
    const valueId = cmd[1];
    if (node.showIf) row.dataset.showIf = node.showIf;
    row.dataset.token = token || '';

    const head = document.createElement('div');
    head.className = 'ctl-head';
    head.innerHTML = `<label>${escapeHtml(node.label || '')}</label><output></output>`;
    const out = head.querySelector('output');
    row.appendChild(head);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'ctl-body';
    row.appendChild(bodyWrap);
    row.title = `channel ${channel} · value ${valueId}`;

    const current = this.values[token];

    if (node.type === 'range') {
      const [min, max] = node.options || [0, 255];
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.value = String(clamp(current ?? min, min, max));
      const apply = debounce(async (v) => {
        this.values[token] = v;
        out.textContent = v;
        this._syncVisibility();
        await this._write(token, channel, valueId, v, node);
      }, 90);
      input.addEventListener('input', () => {
        out.textContent = input.value;
        apply(Number(input.value));
      });
      out.textContent = String(input.value);
      bodyWrap.appendChild(input);
    } else if (node.type === 'dropdown') {
      const select = document.createElement('select');
      const options = node.options || [];
      const isPairs = Array.isArray(options[0]);
      options.forEach((opt, idx) => {
        const o = document.createElement('option');
        if (isPairs) {
          o.textContent = opt[0];
          o.value = String(opt[1]);
        } else {
          o.textContent = String(opt);
          o.value = String(idx);
        }
        select.appendChild(o);
      });
      select.value = String(current ?? (isPairs ? options[0]?.[1] : 0));
      out.textContent = optionLabel(options, select.value);
      select.addEventListener('change', async () => {
        this.values[token] = Number(select.value);
        out.textContent = optionLabel(options, select.value);
        this._syncVisibility();
        await this._write(token, channel, valueId, Number(select.value), node);
      });
      bodyWrap.appendChild(select);
    } else if (node.type === 'color') {
      const hue = Array.isArray(current) ? current[0] : 0;
      const sat = Array.isArray(current) ? current[1] : 255;
      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.value = hsvToHex(hue, sat, 255);
      out.textContent = `H${hue} S${sat}`;
      const apply = debounce(async (h, s) => {
        this.values[token] = [h, s];
        out.textContent = `H${h} S${s}`;
        await this._write(token, channel, valueId, [h, s], node);
      }, 120);
      swatch.addEventListener('input', () => {
        const [r, g, b] = hexToRgb(swatch.value);
        const [h, s] = rgbToHsv(r, g, b);
        apply(h, s);
      });
      bodyWrap.appendChild(swatch);

      const presets = document.createElement('div');
      presets.className = 'swatches';
      for (const [name, h, s] of COLOR_PRESETS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.title = name;
        b.style.background = hsvToHex(h, s, 255);
        b.addEventListener('click', () => {
          swatch.value = hsvToHex(h, s, 255);
          apply(h, s);
        });
        presets.appendChild(b);
      }
      bodyWrap.appendChild(presets);
    } else if (node.type === 'toggle') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = this.values[token] ? '开' : '关';
      btn.addEventListener('click', async () => {
        const next = this.values[token] ? 0 : 1;
        this.values[token] = next;
        btn.textContent = next ? '开' : '关';
        await this._write(token, channel, valueId, next, node);
      });
      bodyWrap.appendChild(btn);
    } else if (node.type === 'button') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = node.label || '执行';
      btn.addEventListener('click', () => this._write(token, channel, valueId, 1, node));
      bodyWrap.appendChild(btn);
    } else {
      row.classList.add('unsupported');
      bodyWrap.innerHTML = `<span class="muted">暂不支持的控件类型：${escapeHtml(node.type)}</span>`;
    }
    void trail;
    return row;
  }

  async _write(token, channel, valueId, value, node) {
    if (!this.device) return;
    const payload = Array.isArray(value)
      ? value
      : node?.bytes === 2
        ? [(value >> 8) & 0xff, value & 0xff]
        : [value & 0xff];
    try {
      await this.device.setCustomMenuValue(channel, valueId, ...payload);
      await this.device.commitCustomMenu(channel);
      this.onStatus?.({ ok: true, message: `已应用：${node?.label || token}` });
    } catch (e) {
      this.onStatus?.({ ok: false, message: `写入失败：${e.message}` });
    }
  }

  _syncVisibility() {
    const hidden = new Set();
    const evalAll = () => {
      for (const el of this.el.querySelectorAll('[data-show-if]')) {
        const ok = evalExpr(el.dataset.showIf, this.values);
        el.classList.toggle('is-hidden', !ok);
        if (!ok) hidden.add(el);
      }
    };
    evalAll();
  }
}

function optionLabel(options, value) {
  const v = String(value);
  const isPairs = Array.isArray(options?.[0]);
  if (isPairs) {
    const found = options.find((o) => String(o[1]) === v);
    return found ? found[0] : v;
  }
  return options?.[Number(v)] ?? v;
}

/* --------------------------- showIf evaluator --------------------------- */

/**
 * Evaluates VIA showIf expressions such as
 *   "{id_qmk_rgb_matrix_effect} != 0 && {x} != 24"
 * without using eval(): the expression is tokenised and evaluated by hand.
 */
export function evalExpr(expr, values) {
  if (!expr || !String(expr).trim()) return true;
  try {
    const tokens = tokenize(expr);
    if (!tokens.length) return true;
    const rpn = toRpn(tokens);
    const result = evalRpn(rpn, values);
    return typeof result === 'number' ? Boolean(result) : true;
  } catch {
    // Never hide a control because an expression could not be parsed.
    return true;
  }
}

function tokenize(expr) {
  const out = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '{') {
      const end = expr.indexOf('}', i);
      const name = expr.slice(i + 1, end).trim();
      out.push({ t: 'val', name });
      i = end + 1;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (['!=', '==', '>=', '<='].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (['>', '<'].includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (two === '&&' || two === '||') {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (ch === '&' || ch === '|') {
      out.push({ t: 'op', v: ch === '&' ? '&&' : '||' });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      out.push({ t: ch });
      i++;
      continue;
    }
    const m = /^[0-9]+/.exec(expr.slice(i));
    if (m) {
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    const idm = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i));
    if (idm) {
      out.push({ t: 'val', name: idm[0] });
      i += idm[0].length;
      continue;
    }
    i++; // skip unknown char
  }
  return out;
}

const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4 };

function toRpn(tokens) {
  const out = [];
  const stack = [];
  for (const tk of tokens) {
    if (tk.t === 'num' || tk.t === 'val') out.push(tk);
    else if (tk.t === 'op') {
      while (stack.length && stack[stack.length - 1].t === 'op' && PREC[stack[stack.length - 1].v] >= PREC[tk.v]) {
        out.push(stack.pop());
      }
      stack.push(tk);
    } else if (tk.t === '(') stack.push(tk);
    else if (tk.t === ')') {
      while (stack.length && stack[stack.length - 1].t !== '(') out.push(stack.pop());
      stack.pop();
    }
  }
  while (stack.length) out.push(stack.pop());
  return out;
}

function evalRpn(rpn, values) {
  const stack = [];
  for (const tk of rpn) {
    if (tk.t === 'num') stack.push(tk.v);
    else if (tk.t === 'val') {
      const v = values[tk.name];
      stack.push(Array.isArray(v) ? v[0] : typeof v === 'number' ? v : 0);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      switch (tk.v) {
        case '&&': stack.push(a && b ? 1 : 0); break;
        case '||': stack.push(a || b ? 1 : 0); break;
        case '!=': stack.push(a !== b ? 1 : 0); break;
        case '==': stack.push(a === b ? 1 : 0); break;
        case '>': stack.push(a > b ? 1 : 0); break;
        case '<': stack.push(a < b ? 1 : 0); break;
        case '>=': stack.push(a >= b ? 1 : 0); break;
        case '<=': stack.push(a <= b ? 1 : 0); break;
        default: stack.push(0);
      }
    }
  }
  return stack.pop();
}

/* ------------------------------ colour utils ---------------------------- */

export function hsvToRgb(h, s, v) {
  const hh = (h / 255) * 360;
  const ss = s / 255;
  const vv = v / 255;
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [Math.round((h / 360) * 255) & 0xff, Math.round(s * 255)];
}

const hex2 = (n) => n.toString(16).padStart(2, '0');
export function hsvToHex(h, s, v) {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}
function hexToRgb(hex) {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const COLOR_PRESETS = [
  ['红', 0, 255],
  ['橙', 21, 255],
  ['黄', 43, 255],
  ['绿', 85, 255],
  ['青', 128, 255],
  ['蓝', 170, 255],
  ['紫', 200, 255],
  ['品红', 234, 255],
  ['白', 0, 0],
];

/* ------------------------------- helpers -------------------------------- */

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

void CHANNEL_LABEL;
