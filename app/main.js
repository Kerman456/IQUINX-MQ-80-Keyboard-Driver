/**
 * IQUNIX MQ80 · VIA 驱动 — application shell.
 *
 * Ties the transport (WebHID / simulator), the layout renderer, the keymap
 * editor, the lighting panel, the per-key colour tool and the macro editor
 * together. No framework, no build step.
 */
import definition from './definitions/iqunix-mq80.js';
import { WebHidViaDevice, ViaDevice } from './driver/via-device.js';
import { MockViaDevice } from './driver/mock-device.js';
import { KeyboardView } from './ui/keyboard-view.js';
import { KeyEditorPanel } from './ui/key-editor.js';
import { LightingPanel } from './ui/lighting-panel.js';
import { MacroPanel } from './ui/macro-panel.js';
import { getBasicKeyDict, labelForName } from './driver/keycodes.js';

const RECENT_KEY = 'mq80.recent';

const state = {
  device: null,
  demo: false,
  protocol: -1,
  keycodesVersion: null,
  layerCount: 4,
  layer: 0,
  keymaps: new Map(), // layer -> flat array
  connected: false,
  meta: {},
  /** keys currently selected in the editor: [{matrix, code}] */
  selection: [],
  multi: false,
  clipboard: null,
  recent: loadRecent(),
};

const els = {};
let boardView = null;
let editor = null;
let lighting = null;
let macros = null;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  cacheEls();
  buildBoard();
  buildEditor();
  buildLighting();
  buildMacro();
  wireChrome();
  renderLayers();
  setStatus('未连接', 'idle');
  log('提示', '点击「连接键盘」选择 IQUNIX MQ80（0x320F:0x5055），或先用「演示模式」体验。');
  showDevicePane();
  autoConnectAuthorized();
  applyDeepLink();
  window.addEventListener('resize', () => boardView.fit());
}

function cacheEls() {
  els.deviceChip = document.getElementById('deviceChip');
  els.boardHost = document.getElementById('boardHost');
  els.layerBar = document.getElementById('layerBar');
  els.toast = document.getElementById('toast');
  els.log = document.getElementById('logList');
  els.editorHost = document.getElementById('editorHost');
  els.lightingHost = document.getElementById('lightingHost');
  els.macroHost = document.getElementById('macroHost');
  els.deviceHost = document.getElementById('deviceHost');
  els.keymapPane = document.querySelector('[data-pane="keymap"]');
  els.panes = document.querySelectorAll('[data-pane]');
}

function wireChrome() {
  document.getElementById('btnConnect').addEventListener('click', connectReal);
  document.getElementById('btnDemo').addEventListener('click', connectDemo);
  document.getElementById('btnDisconnect').addEventListener('click', disconnect);
  for (const tab of document.querySelectorAll('.sidenav button')) {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selection.length) clearSelection();
  });
}

function selectTab(name) {
  for (const t of document.querySelectorAll('.sidenav button')) {
    t.classList.toggle('is-active', t.dataset.tab === name);
  }
  for (const pane of els.panes) pane.hidden = pane.dataset.pane !== name;

  if (name === 'keymap') requestAnimationFrame(() => boardView.fit());
  if (name === 'lighting') reload(lighting);
  if (name === 'macro') reload(macros);
}

/** Render a panel and, when a device is present, refresh it from the device. */
async function reload(panel) {
  panel.render?.();
  panel.syncVisibility?.();
  if (!state.device) return;
  try {
    await panel.refresh?.();
  } catch (e) {
    log('读取失败', e.message, true);
  }
  panel.render?.();
  panel.syncVisibility?.();
  panel.board?.fit?.();
}

/* ------------------------------------------------------------------ */
/* Board + toolbar                                                     */
/* ------------------------------------------------------------------ */

function buildBoard() {
  boardView = new KeyboardView(definition, {
    onKeyClick: (key) => onKeyClick(key),
  });
  els.boardHost.appendChild(boardView.el);
}

function renderLayers() {
  els.layerBar.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'toolbar-label';
  label.textContent = '图层';
  els.layerBar.appendChild(label);

  for (let i = 0; i < state.layerCount; i++) {
    const b = document.createElement('button');
    b.className = 'layer-btn';
    b.textContent = `${i}`;
    b.title = `图层 ${i}`;
    b.classList.toggle('is-active', i === state.layer);
    b.addEventListener('click', () => selectLayer(i));
    els.layerBar.appendChild(b);
  }

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  els.layerBar.appendChild(spacer);

  const multi = document.createElement('button');
  multi.className = 'btn small ghost';
  multi.textContent = state.multi ? '多选中' : '多选';
  multi.title = '开启后依次点击多个键位，可批量改成同一个键码';
  multi.classList.toggle('is-on', state.multi);
  multi.addEventListener('click', toggleMulti);
  els.layerBar.appendChild(multi);

  const copy = document.createElement('button');
  copy.className = 'btn small ghost';
  copy.textContent = '复制';
  copy.disabled = state.selection.length !== 1;
  copy.title = '复制当前键位的键码';
  copy.addEventListener('click', copySelection);
  els.layerBar.appendChild(copy);

  const paste = document.createElement('button');
  paste.className = 'btn small ghost';
  paste.textContent = '粘贴';
  paste.disabled = !state.clipboard || !state.selection.length;
  paste.title = state.clipboard ? `粘贴 ${labelForCode(state.clipboard)}` : '请先复制一个键码';
  paste.addEventListener('click', pasteSelection);
  els.layerBar.appendChild(paste);

  const clear = document.createElement('button');
  clear.className = 'btn small ghost';
  clear.textContent = '清空本层';
  clear.addEventListener('click', clearCurrentLayer);
  els.layerBar.appendChild(clear);

  if (state.selection.length) {
    const deselect = document.createElement('button');
    deselect.className = 'btn small ghost';
    deselect.textContent = `取消选择（${state.selection.length}）`;
    deselect.addEventListener('click', clearSelection);
    els.layerBar.appendChild(deselect);
  }
}

async function selectLayer(layer) {
  state.layer = layer;
  renderLayers();
  if (!state.device) return;
  if (!state.keymaps.has(layer)) await loadLayer(layer);
  boardView.setKeymap(state.keymaps.get(layer));
  refreshEditor();
}

async function loadLayer(layer) {
  if (!state.device) return;
  try {
    const flat = await state.device.readLayer(definition.matrix, layer);
    state.keymaps.set(layer, flat);
  } catch (e) {
    log('读取失败', `图层 ${layer}: ${e.message}`, true);
  }
}

/* ------------------------------------------------------------------ */
/* Selection & assignment                                              */
/* ------------------------------------------------------------------ */

function onKeyClick(key) {
  if (!state.connected) {
    toast('请先连接键盘或进入演示模式', false);
    return;
  }
  const id = key.matrix.join(',');
  if (state.multi) {
    const at = state.selection.findIndex((s) => s.matrix.join(',') === id);
    if (at >= 0) state.selection.splice(at, 1);
    else state.selection.push({ matrix: key.matrix, code: currentCodeOf(key.matrix) });
  } else {
    state.selection = [{ matrix: key.matrix, code: currentCodeOf(key.matrix) }];
  }
  refreshEditor();
}

function currentCodeOf(matrix) {
  const flat = state.keymaps.get(state.layer) || [];
  return flat[matrix[0] * definition.matrix.cols + matrix[1]] ?? 0;
}

function clearSelection() {
  state.selection = [];
  boardView.setSelection([]);
  editor.show([], state.layer);
  els.keymapPane.classList.remove('editor-open');
  renderLayers();
}

async function applyAssign(code, opts = {}) {
  if (opts.kind === 'copy') return copySelection();
  if (opts.kind === 'paste') return pasteSelection();
  if (!state.selection.length || !state.device) return;

  const flat = state.keymaps.get(state.layer) || [];
  for (const sel of state.selection) {
    const [r, c] = sel.matrix;
    flat[r * definition.matrix.cols + c] = code;
  }
  state.keymaps.set(state.layer, flat);
  boardView.setKeymap(flat);
  refreshEditor();
  pushRecent(code);

  try {
    for (const sel of state.selection) {
      await state.device.setKey(state.layer, sel.matrix[0], sel.matrix[1], code);
    }
    const n = state.selection.length;
    log(
      '写入',
      `L${state.layer} ${state.selection.map((s) => s.matrix.join(',')).join(' / ')} → 0x${code
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')}`,
    );
    if (n > 1) toast(`已应用到 ${n} 个键位`, true);
  } catch (e) {
    log('写入失败', e.message, true);
    toast(`写入失败：${e.message}`, false);
  }
}

function copySelection() {
  if (state.selection.length !== 1) return;
  state.clipboard = state.selection[0].code;
  toast(`已复制 ${labelForCode(state.clipboard)}`, true);
  renderLayers();
  editor.setClipboardState(true);
}

function pasteSelection() {
  if (state.clipboard === null || !state.selection.length) return;
  applyAssign(state.clipboard, { kind: 'set' });
}

function labelForCode(code) {
  const name = nameOfCode(code);
  if (name) return labelForName(name) || name;
  return `0x${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

function nameOfCode(code) {
  const dict = getBasicKeyDict(state.protocol);
  for (const [name, value] of Object.entries(dict)) {
    if (value === code && !name.startsWith('_')) return name;
  }
  return '';
}

function toggleMulti() {
  state.multi = !state.multi;
  if (!state.multi && state.selection.length > 1) {
    state.selection = state.selection.slice(0, 1);
    refreshEditor();
  }
  renderLayers();
  toast(state.multi ? '多选已开启：依次点击多个键位' : '多选已关闭', true);
}

async function clearCurrentLayer() {
  if (!state.device) return;
  if (!confirm(`清空图层 ${state.layer} 的所有键位？`)) return;
  const flat = new Array(definition.matrix.rows * definition.matrix.cols).fill(0);
  try {
    await state.device.writeLayer(definition.matrix, state.layer, flat);
    state.keymaps.set(state.layer, flat);
    boardView.setKeymap(flat);
    refreshEditor();
    toast(`图层 ${state.layer} 已清空`, true);
  } catch (e) {
    log('清空失败', e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* Editor panel                                                        */
/* ------------------------------------------------------------------ */

function buildEditor() {
  editor = new KeyEditorPanel({
    definition,
    onAssign: (code, opts) => applyAssign(code, opts),
    onClose: () => clearSelection(),
  });
  els.editorHost.appendChild(editor.el);
  editor.setClipboardState(false);
  editor.show([], 0);
}

function refreshEditor() {
  for (const s of state.selection) s.code = currentCodeOf(s.matrix);
  editor.setContext({ protocol: state.protocol, layerCount: state.layerCount });
  editor.show(state.selection, state.layer);
  editor.setClipboardState(state.clipboard !== null);
  boardView.setSelection(state.selection.map((s) => s.matrix.join(',')));
  els.keymapPane.classList.toggle('editor-open', state.selection.length > 0);
  renderLayers();
  if (state.selection.length) requestAnimationFrame(() => boardView.fit());
}

/* ------------------------------------------------------------------ */
/* Recently used keycodes                                              */
/* ------------------------------------------------------------------ */

function pushRecent(code) {
  const entry = { code, name: nameOfCode(code), label: labelForCode(code) };
  state.recent = [entry, ...state.recent.filter((r) => r.code !== code)].slice(0, 12);
  saveRecent(state.recent);
  editor.browser.setRecent(state.recent);
}

function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || [];
  } catch {
    return [];
  }
}

function saveRecent(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Device connection                                                   */
/* ------------------------------------------------------------------ */

async function connectReal() {
  try {
    setStatus('正在选择设备…', 'busy');
    const hidDevice = await WebHidViaDevice.request();
    if (!hidDevice) {
      setStatus(state.connected ? '已连接' : '未连接', state.connected ? 'ok' : 'idle');
      return;
    }
    await initDevice(new WebHidViaDevice(hidDevice), false);
  } catch (e) {
    setStatus('未连接', 'idle');
    log('连接失败', e.message, true);
    toast(e.message, false);
  }
}

async function autoConnectAuthorized() {
  try {
    const list = await WebHidViaDevice.authorized();
    if (list.length) log('提示', `检测到已授权设备 ${list.length} 个，点击「连接键盘」即可使用。`);
  } catch {
    /* ignore */
  }
}

async function connectDemo() {
  try {
    await initDevice(new MockViaDevice(definition), true);
    toast('已进入演示模式（模拟设备）', true);
  } catch (e) {
    log('演示模式失败', e.message, true);
  }
}

async function initDevice(device, demo) {
  if (state.device) await disconnect();
  await device.transportOpen();
  state.device = device;
  state.demo = demo;
  state.connected = true;
  state.keymaps.clear();
  state.selection = [];
  state.clipboard = null;

  device.onDisconnect((reason) => {
    log('设备断开', reason || '连接已关闭', true);
    state.device = null;
    state.connected = false;
    setStatus('未连接', 'idle');
    showDevicePane();
  });

  state.protocol = await device.getProtocolVersion();
  boardView.setProtocol(state.protocol);
  state.layerCount = await device.getLayerCount();
  const firmware = await device.getFirmwareVersion();
  state.keycodesVersion = await safeKeycodesVersion(device);
  state.meta = { firmware, keycodesVersion: state.keycodesVersion };

  editor.setContext({ protocol: state.protocol, layerCount: state.layerCount });
  editor.browser.setRecent(state.recent);
  lighting.setDevice(device);
  macros.setContext({ protocol: state.protocol });
  macros.setDevice(device);

  await selectLayer(0);
  clearSelection();
  showDevicePane();
  setStatus(device.descriptor.name, 'ok');
  log(
    '已连接',
    `${device.descriptor.name} · 协议 v${state.protocol} · 固件 ${firmware || '未知'} · ${state.layerCount} 层`,
  );
  toast(`已连接：协议 v${state.protocol}`, true);
}

async function safeKeycodesVersion(device) {
  try {
    return await device.getKeycodesVersion();
  } catch {
    return null;
  }
}

async function disconnect() {
  if (!state.device) return;
  try {
    await state.device.close();
  } catch {
    /* ignore */
  }
  state.device = null;
  state.connected = false;
  state.keymaps.clear();
  state.selection = [];
  boardView.setSelection([]);
  editor.show([], state.layer);
  els.keymapPane.classList.remove('editor-open');
  renderLayers();
  setStatus('未连接', 'idle');
  showDevicePane();
}

/* ------------------------------------------------------------------ */
/* Device pane                                                         */
/* ------------------------------------------------------------------ */

function showDevicePane() {
  const host = els.deviceHost;
  if (!host) return;
  const d = state.device;
  if (!d) {
    host.innerHTML = `
      <section class="card">
        <h3>设备信息</h3>
        <div class="card-body">
          <p class="muted">尚未连接设备。请点击右上角「连接键盘」，或使用「演示模式」。</p>
          <ul class="kv">
            <li><span>VID / PID</span><b>0x320F / 0x5055</b></li>
            <li><span>矩阵</span><b>${definition.matrix.rows} × ${definition.matrix.cols}</b></li>
            <li><span>键位数量</span><b>${countKeys()}</b></li>
          </ul>
        </div>
      </section>`;
    return;
  }
  host.innerHTML = `
    <section class="card">
      <h3>设备信息</h3>
      <div class="card-body">
        <ul class="kv">
          <li><span>名称</span><b>${escapeHtml(d.descriptor.name)}</b></li>
          <li><span>VID / PID</span><b>0x${d.descriptor.vendorId.toString(16).toUpperCase()} / 0x${d.descriptor.productId
            .toString(16)
            .toUpperCase()}</b></li>
          <li><span>连接方式</span><b>${state.demo ? '模拟设备' : 'WebHID'}</b></li>
          <li><span>VIA 协议</span><b>v${state.protocol}</b></li>
          <li><span>固件版本</span><b>${state.meta?.firmware || '未知'}</b></li>
          <li><span>键码版本</span><b>${
            state.keycodesVersion
              ? '0x' + state.keycodesVersion.toString(16).padStart(8, '0')
              : '—'
          }</b></li>
          <li><span>图层数量</span><b>${state.layerCount}</b></li>
          <li><span>报告长度</span><b>${d.reportSize} 字节</b></li>
        </ul>
      </div>
    </section>
    <section class="card danger">
      <h3>维护</h3>
      <div class="card-body actions-col">
        <button class="btn" id="btnEeprom">恢复出厂设置（清除改键、灯效与宏）</button>
        <button class="btn" id="btnBoot">进入 Bootloader（刷新固件用）</button>
        <button class="btn ghost" id="btnReload">重新读取键盘</button>
      </div>
    </section>`;

  host.querySelector('#btnEeprom')?.addEventListener('click', async () => {
    if (!confirm('这会清除键盘上所有的改键、灯效与宏设置，确定继续？')) return;
    try {
      await state.device.resetEEPROM();
      state.keymaps.clear();
      await loadLayer(state.layer);
      boardView.setKeymap(state.keymaps.get(state.layer));
      refreshEditor();
      toast('已恢复出厂设置', true);
    } catch (e) {
      toast(`失败：${e.message}`, false);
    }
  });
  host.querySelector('#btnBoot')?.addEventListener('click', async () => {
    if (!confirm('键盘将进入 Bootloader 模式（主要用于刷新固件），确定继续？')) return;
    try {
      await state.device.jumpToBootloader();
      toast('已发送进入 Bootloader 指令', true);
    } catch (e) {
      toast(`失败：${e.message}`, false);
    }
  });
  host.querySelector('#btnReload')?.addEventListener('click', async () => {
    state.keymaps.clear();
    await loadLayer(state.layer);
    boardView.setKeymap(state.keymaps.get(state.layer));
    refreshEditor();
    toast('已重新读取', true);
  });
}

function countKeys() {
  return (definition.layouts?.keymap || []).reduce(
    (n, row) => n + row.filter((x) => typeof x === 'string').length,
    0,
  );
}

/* ------------------------------------------------------------------ */
/* Panels                                                             */
/* ------------------------------------------------------------------ */

function buildLighting() {
  lighting = new LightingPanel({ definition, onStatus: onPanelStatus });
  lighting.el.classList.add('panel-root');
  els.lightingHost.appendChild(lighting.el);
}

function buildMacro() {
  macros = new MacroPanel({ definition, onStatus: onPanelStatus });
  macros.el.classList.add('panel-root');
  els.macroHost.appendChild(macros.el);
}

function onPanelStatus({ ok, message }) {
  if (message) log(ok ? '操作' : '错误', message, !ok);
  toast(message, ok);
}

/* ------------------------------------------------------------------ */
/* Small UI helpers                                                    */
/* ------------------------------------------------------------------ */

function setStatus(text, kind) {
  if (!els.deviceChip) return;
  els.deviceChip.textContent = text;
  els.deviceChip.dataset.kind = kind;
}

function log(title, message, error = false) {
  if (!els.log) return;
  const li = document.createElement('li');
  li.className = error ? 'is-error' : '';
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  li.innerHTML = `<span class="t">${time}</span><b>${escapeHtml(title)}</b><span>${escapeHtml(
    message,
  )}</span>`;
  els.log.prepend(li);
  while (els.log.children.length > 60) els.log.removeChild(els.log.lastChild);
}

let toastTimer;
function toast(message, ok) {
  if (!message) return;
  els.toast.textContent = message;
  els.toast.className = `toast is-show ${ok ? 'ok' : 'bad'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.className = 'toast'), 2600);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

/* ------------------------------------------------------------------ */
/* Deep links                                                          */
/* ------------------------------------------------------------------ */

/**
 * ?demo=1        start the in-memory simulator
 * &tab=lighting  open a tab (keymap|lighting|macro|device|about)
 * &layer=1       preselect a layer
 * &select=1,0    preselect a key (opens the editor panel)
 */
async function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) await connectDemo();

  const layer = Number(params.get('layer'));
  if (state.connected && Number.isInteger(layer) && layer > 0 && layer < state.layerCount) {
    await selectLayer(layer);
  }
  const sel = params.get('select');
  if (sel && state.connected) {
    const [r, c] = sel.split(',').map(Number);
    if (Number.isInteger(r) && Number.isInteger(c)) onKeyClick({ matrix: [r, c] });
  }
  const tab = params.get('tab');
  if (tab && ['keymap', 'lighting', 'macro', 'device', 'about'].includes(tab)) {
    selectTab(tab);
  }
}

void ViaDevice;

window.addEventListener('DOMContentLoaded', boot);
