/**
 * Driver test — exercises the whole VIA command set against the in-memory
 * simulator, so it runs without any hardware.
 *
 *   node tools/test-driver.mjs
 */
import { MockViaDevice } from '../app/driver/mock-device.js';
import definition from '../app/definitions/iqunix-mq80.js';
import {
  describeCode,
  buildKeycodeGroups,
  basicByteToName,
  basicNameToByte,
} from '../app/driver/keycodes.js';
import { decodeMacros, encodeMacros, ACTION, supportsDelay } from '../app/driver/macro.js';

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '   → ' + extra : ''}`);
};

const d = new MockViaDevice(definition);
await d.transportOpen();

/* ---------------------------- handshake --------------------------- */
const protocol = await d.getProtocolVersion();
ok('协议版本可读', protocol === 12, `v${protocol}`);
ok('图层数量可读', (await d.getLayerCount()) === 4);
ok('固件版本可读', (await d.getFirmwareVersion()) === '1.0.3');
ok('键码版本可读', (await d.getKeycodesVersion()) === 8, '0x8');

/* ----------------------------- keymap ----------------------------- */
const L0 = await d.readLayer(definition.matrix, 0);
ok('整层读取长度正确', L0.length === 128, `${L0.length} 项`);
ok('默认键位已填充', L0.filter(Boolean).length === 84, `${L0.filter(Boolean).length} 个非空`);
ok('读出 ` 键', describeCode(L0[1 * 16 + 0], definition, protocol).label === '`');

await d.setKey(0, 1, 0, 0x00a8);
ok('单键写入并可回读', (await d.getKey(0, 1, 0)) === 0x00a8, 'Mute');

await d.setKey(0, 1, 1, 0x7e00);
ok(
  '自定义键码按 QK_KB 解析',
  describeCode(await d.getKey(0, 1, 1), definition, protocol).label === '2.4G MODE',
);

const flat = new Array(128).fill(0);
flat[2 * 16 + 1] = 0x0004;
await d.writeLayer(definition.matrix, 1, flat);
ok('整层写入生效', (await d.readLayer(definition.matrix, 1))[2 * 16 + 1] === 0x0004);

/* ---------------------------- lighting ---------------------------- */
ok('亮度可读', (await d.getCustomMenuValue([3, 1]))[0] === 5);
await d.setCustomMenuValue(3, 1, 8);
await d.commitCustomMenu(3);
ok('亮度可写', (await d.getCustomMenuValue([3, 1]))[0] === 8);
ok('灯效可读', (await d.getCustomMenuValue([3, 2]))[0] === 1);
const colour = await d.getCustomMenuValue([3, 4]);
ok('颜色为 hue/sat 两个字节', colour.length >= 2, `H${colour[0]} S${colour[1]}`);

/* ------------------------------ macros ---------------------------- */
const count = await d.getMacroCount();
const bufferSize = await d.getMacroBufferSize();
ok('宏数量可读', count === 16, `${count}`);
ok('宏缓冲区大小可读', bufferSize === 512, `${bufferSize} 字节`);

const byteToName = basicByteToName(protocol);
const nameToByte = basicNameToByte(protocol);
let seqs = decodeMacros(await d.getMacroBytes(), count, protocol, byteToName);
ok('宏文本解析', seqs[0][0]?.value === 'hello', JSON.stringify(seqs[0]));
ok(
  '宏按下/抬起解析',
  seqs[1].map((s) => s.action).join(',') === 'down,tap,up',
  seqs[1].map((s) => s.value).join(' '),
);

seqs[0] = [{ action: ACTION.TEXT, value: 'pw ' }, { action: ACTION.TAP, value: 'KC_1' }];
seqs[1] = [
  { action: ACTION.DOWN, value: 'KC_LCTL' },
  { action: ACTION.TAP, value: 'KC_V' },
  { action: ACTION.UP, value: 'KC_LCTL' },
];
if (supportsDelay(protocol)) seqs[1].push({ action: ACTION.DELAY, value: 250 });
seqs[2] = [{ action: ACTION.TAP, value: 'KC_ESC' }];
await d.setMacroBytes(encodeMacros(seqs, protocol, nameToByte));
const readback = decodeMacros(await d.getMacroBytes(), count, protocol, byteToName);
const m0 = readback[0];
ok(
  '宏文本往返一致',
  m0.length === 2 &&
    m0[0].action === 'text' &&
    m0[0].value === 'pw ' &&
    m0[1].action === 'tap' &&
    m0[1].value === 'KC_1',
  JSON.stringify(m0),
);
ok('宏单击往返一致', readback[2][0]?.value === 'KC_ESC');
if (supportsDelay(protocol)) {
  ok('宏延迟往返一致', readback[1][3]?.value === 250, `${readback[1][3]?.value} ms`);
}

let guarded = false;
try {
  await d.setMacroBytes(new Array(bufferSize + 1).fill(1));
} catch {
  guarded = true;
}
ok('超出缓冲区被拦截', guarded);

/* ------------------------------ reset ----------------------------- */
await d.resetEEPROM();
ok('EEPROM 复位恢复默认键位', describeCode((await d.readLayer(definition.matrix, 0))[1 * 16 + 0], definition, protocol).label === '`');
ok('EEPROM 复位清空键位改动', (await d.getKey(0, 1, 0)) === 0x0035);

/* --------------------------- keycode tables ----------------------- */
const groups = buildKeycodeGroups(definition, protocol);
ok('键码分组齐全', groups.length === 11, groups.map((g) => g.title).join(' / '));
const custom = groups.find((g) => g.id === 'custom');
ok('自定义功能键 12 项', custom.items.length === 12, custom.items.slice(0, 3).map((i) => i.label).join(', '));
ok('自定义键码基址 0x7E00', custom.items[0].code === 0x7e00);

console.log(`\n  ${failures ? failures + ' 项失败' : '全部通过'}\n`);
process.exit(failures ? 1 : 0);
