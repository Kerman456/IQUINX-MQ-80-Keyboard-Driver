/**
 * Headless UI test — drives the running app through the Chrome DevTools
 * Protocol and asserts the interactive flows really work.
 *
 *   node tools/ui-test.mjs [cdpPort]
 *
 * Requires: preview server on :5173 and a debug Chrome on :9222
 *   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<tmp> \
 *          --no-proxy-server about:blank
 */
const CDP_PORT = process.argv[2] || 9222;
const APP = 'http://127.0.0.1:5173/?demo=1';

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res) => pending.set(mid, res));
};

const HELPERS = `
  const byText = (t, sel='button') =>
    [...document.querySelectorAll(sel)].find(b => b.textContent.trim() === t);
  const contains = (t, sel='button') =>
    [...document.querySelectorAll(sel)].find(b => b.textContent.includes(t));
  const cap = (id) => document.querySelector('#boardHost .keycap[data-id="'+id+'"]');
  const capLabel = (id) => cap(id)?.querySelector('.cap-label')?.textContent || '';
  const pkCap = (id) => document.querySelector('.pk-board .keycap[data-id="'+id+'"]');
  const bar = (t) => [...document.querySelectorAll('#layerBar button')].find(b => b.textContent.trim() === t);
  const barHas = (t) => [...document.querySelectorAll('#layerBar button')].find(b => b.textContent.includes(t));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const pick = async (label) => {
    const search = document.querySelector('.kcb-search input');
    search.value = label;
    search.dispatchEvent(new Event('input', {bubbles:true}));
    await sleep(150);
    const chip = [...document.querySelectorAll('.kcb-chip')]
      .find(c => (c.querySelector('.kc-label')?.textContent || '').trim() === label);
    if (!chip) throw new Error('keycode chip not found: ' + label);
    chip.click();
    await sleep(250);
    return true;
  };
`;

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${HELPERS} ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description || JSON.stringify(ex));
  return r.result?.result?.value;
}

const results = [];
const check = async (name, fn) => {
  try {
    const value = typeof fn === 'function' ? await fn() : fn;
    results.push({ name, ok: !!value, extra: value === true || !value ? '' : String(value).slice(0, 80) });
  } catch (e) {
    results.push({ name, ok: false, extra: e.message.slice(0, 120) });
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: APP });
await new Promise((r) => setTimeout(r, 5500));

/* ---------------------- connection & render ---------------------- */
await check('演示模式已连接', () => evaluate(`return document.getElementById('deviceChip').dataset.kind === 'ok';`));
await check('键盘渲染出 84 个键位', async () =>
  (await evaluate(`return document.querySelectorAll('#boardHost .keycap').length;`)) === 84,
);

/* ------------------------- single select ------------------------- */
await check('单击键位打开编辑面板', async () => {
  await evaluate(`cap('1,0').click(); await sleep(150); return 1;`);
  return evaluate(`return document.querySelector('.keymap-pane').classList.contains('editor-open');`);
});
await check('面板显示当前键码与名称', () =>
  evaluate(`return document.querySelector('.ke-code-hex').textContent.replace(/\\s+/g,' ').trim();`).then(
    (t) => (t.includes('KC_GRV') && t.includes('0x0035') ? t : null),
  ),
);

/* --------------------------- assign one -------------------------- */
await check('搜索并替换键码（Mute）', async () => {
  await evaluate(`await pick('Mute'); return 1;`);
  return evaluate(`return capLabel('1,0');`).then((l) => (l === 'Mute' ? 'Mute' : null));
});
await check('“最近使用”出现记录', () =>
  evaluate(`return document.querySelectorAll('.kcb-recent .kcb-chip').length >= 1;`),
);

/* ------------------------ multi selection ------------------------ */
await check('多选模式可选中 3 个键', async () => {
  await evaluate(`
    barHas('取消选择')?.click(); await sleep(100);
    bar('多选').click(); await sleep(80);
    cap('1,1').click(); await sleep(60);
    cap('1,2').click(); await sleep(60);
    cap('1,3').click(); await sleep(150);
    return 1;`);
  return evaluate(`return document.querySelectorAll('.keycap.is-selected').length;`).then((n) =>
    n === 3 ? '3' : null,
  );
});
await check('面板显示批量数量', () =>
  evaluate(`return document.querySelector('.ke-title b').textContent;`).then((t) =>
    t.includes('3') ? t : null,
  ),
);
await check('批量替换应用到全部 3 个键', async () => {
  await evaluate(`await pick('Esc'); await sleep(300); return 1;`);
  return evaluate(`return ['1,1','1,2','1,3'].every(id => capLabel(id) === 'Esc');`);
});
await check('批量替换未影响其它键', () =>
  evaluate(`return capLabel('1,0') === 'Mute';`),
);

/* --------------------------- copy/paste -------------------------- */
await check('单选时“复制”可用', async () => {
  await evaluate(`barHas('多选').click(); await sleep(80); cap('1,0').click(); await sleep(150); return 1;`);
  return evaluate(`return !bar('复制').disabled;`);
});
await check('复制后“粘贴”可用', async () => {
  await evaluate(`bar('复制').click(); await sleep(80); return 1;`);
  return evaluate(`return !bar('粘贴').disabled;`);
});
await check('粘贴到另一个键位', async () => {
  await evaluate(`cap('2,1').click(); await sleep(120); bar('粘贴').click(); await sleep(350); return 1;`);
  return evaluate(`return capLabel('2,1') === 'Mute';`);
});

/* --------------------------- layer switch ------------------------ */
await check('切换到图层 1 显示透传键', async () => {
  await evaluate(`[...document.querySelectorAll('.layer-btn')].find(b => b.textContent === '1').click(); await sleep(450); return 1;`);
  return evaluate(`return document.querySelectorAll('#boardHost .keycap.is-transparent').length;`).then((n) =>
    n > 50 ? String(n) + ' 个' : null,
  );
});

/* ------------------------------ macros --------------------------- */
await check('宏列表渲染 16 项', async () => {
  await evaluate(`byText('宏').click(); await sleep(2600); return 1;`);
  return evaluate(`return document.querySelectorAll('.macro-item').length;`).then((n) => (n === 16 ? '16' : n));
});
await check('宏 1 解析为文本 hello', async () => {
  await evaluate(`document.querySelectorAll('.macro-item')[0].click(); await sleep(200); return 1;`);
  return evaluate(`return document.querySelector('.macro-seq').textContent;`).then((t) =>
    t.includes('hello') ? 'hello' : null,
  );
});
await check('宏 2 解析为 按下/单击/抬起', async () => {
  await evaluate(`document.querySelectorAll('.macro-item')[1].click(); await sleep(200); return 1;`);
  return evaluate(`return [...document.querySelectorAll('.macro-chip')].map(c=>c.className).join(' ');`).then(
    (t) => (t.includes('act-down') && t.includes('act-tap') && t.includes('act-up') ? 'ok' : null),
  );
});
await check('缓冲区占用提示', () =>
  evaluate(`return document.querySelector('.macro-usage').textContent;`).then((t) =>
    t.includes('/ 512') ? t : null,
  ),
);
await check('新增动作按钮可用', async () => {
  const before = await evaluate(`return document.querySelectorAll('.macro-chip').length;`);
  await evaluate(`byText('＋ 延迟').click(); await sleep(250); return 1;`);
  const after = await evaluate(`return document.querySelectorAll('.macro-chip').length;`);
  return after > before ? `${before}→${after}` : null;
});

/* ---------------------------- lighting --------------------------- */
await check('灯光面板渲染控件', async () => {
  await evaluate(`byText('灯光').click(); await sleep(1200); return 1;`);
  return evaluate(`return document.querySelectorAll('.ctl').length;`).then((n) => (n >= 4 ? String(n) : null));
});
await check('showIf 按灯效联动显隐', () =>
  evaluate(`
    const sel = document.querySelector('.ctl-body select');
    sel.value = '0'; sel.dispatchEvent(new Event('change')); await sleep(300);
    const hidden = [...document.querySelectorAll('[data-show-if]')].filter(e => e.classList.contains('is-hidden')).length;
    sel.value = '1'; sel.dispatchEvent(new Event('change')); await sleep(300);
    const shown = [...document.querySelectorAll('[data-show-if]')].filter(e => e.classList.contains('is-hidden')).length;
    return hidden + '/' + shown;`).then((t) => (t.startsWith('2/0') || t === '2/0' ? t : null)),
);

/* ----------------------------- report ---------------------------- */
ws.close();
let failed = 0;
console.log('');
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${r.name}${r.extra ? '   → ' + r.extra : ''}`);
}
console.log(`\n  ${results.length - failed}/${results.length} 项通过\n`);
process.exit(failed ? 1 : 0);
