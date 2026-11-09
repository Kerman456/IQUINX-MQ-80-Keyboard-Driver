/**
 * Keycode helpers: dictionary selection, human labels and the picker tree.
 *
 * The byte dictionary is selected from the reported VIA protocol version,
 * exactly like the-via/app (src/utils/key-to-byte/dictionary-store.ts):
 *   protocol >= 13 -> v13 (keycodes version required)
 *   protocol == 12 -> v12   (QK_KB base 0x7E00)
 *   protocol == 11 -> v11   (QK_KB base 0x7F00)
 *   protocol == 10 -> v10
 *   otherwise      -> v9    (QK_KB base 0x5F80)
 */
import {
  KEY_DICT_V9,
  KEY_DICT_V10,
  KEY_DICT_V11,
  KEY_DICT_V12,
  KEY_DICT_V13,
} from './keycodes-data.js';

export const KC_NO = 0x0000;
export const KC_TRNS = 0x0001;

export function getBasicKeyDict(protocol, keycodesVersion) {
  if (protocol >= 13) {
    if (keycodesVersion === undefined || keycodesVersion === null) return KEY_DICT_V13;
    return KEY_DICT_V13;
  }
  if (protocol === 12) return KEY_DICT_V12;
  if (protocol === 11) return KEY_DICT_V11;
  if (protocol === 10) return KEY_DICT_V10;
  return KEY_DICT_V9;
}

/** Advanced-keycode bases for a given dictionary. */
export function advancedRanges(dict) {  return {
    mods: [dict._QK_MODS, dict._QK_MODS_MAX],
    modTap: [dict._QK_MOD_TAP, dict._QK_MOD_TAP_MAX],
    layerTap: [dict._QK_LAYER_TAP, dict._QK_LAYER_TAP_MAX],
    layerMod: [dict._QK_LAYER_MOD, dict._QK_LAYER_MOD_MAX],
    to: [dict._QK_TO, dict._QK_TO_MAX],
    momentary: [dict._QK_MOMENTARY, dict._QK_MOMENTARY_MAX],
    defLayer: [dict._QK_DEF_LAYER, dict._QK_DEF_LAYER_MAX],
    toggleLayer: [dict._QK_TOGGLE_LAYER, dict._QK_TOGGLE_LAYER_MAX],
    oneShotLayer: [dict._QK_ONE_SHOT_LAYER, dict._QK_ONE_SHOT_LAYER_MAX],
    oneShotMod: [dict._QK_ONE_SHOT_MOD, dict._QK_ONE_SHOT_MOD_MAX],
    layerTapToggle: [dict._QK_LAYER_TAP_TOGGLE, dict._QK_LAYER_TAP_TOGGLE_MAX],
    qkKb: [dict._QK_KB, dict._QK_KB_MAX],
  };
}

/**
 * Byte -> keycode name map for macros. Only single-byte keycodes are usable
 * inside a macro buffer, so anything above 0xFF is dropped.
 */
export function basicByteToName(protocol) {
  const dict = getBasicKeyDict(protocol);
  const map = {};
  for (const [name, code] of Object.entries(dict)) {
    if (name.startsWith('_')) continue;
    if (code > 0xff || code === 0) continue;
    if (map[code] === undefined) map[code] = name;
  }
  return map;
}

/** Name -> byte map used when encoding macros. */
export function basicNameToByte(protocol) {
  return getBasicKeyDict(protocol);
}

/** Keycode name for a 16-bit value, or '' when it is not a plain keycode. */
export function codeToName(code, protocol) {
  return BYTE_TO_NAME[dictRefKey(protocol)]?.[code] || BYTE_TO_NAME.global[code] || '';
}

/** Keycodes offered when editing a macro action (single byte only). */
export function macroKeycodeNames(protocol) {
  const dict = getBasicKeyDict(protocol);
  return Object.entries(dict)
    .filter(([name, code]) => !name.startsWith('_') && code > 0 && code <= 0xff)
    .map(([name, code]) => ({ name, code, label: labelForName(name) }));
}

/* ------------------------------------------------------------------ */
/* Human readable labels                                              */
/* ------------------------------------------------------------------ */

const LABELS = {
  KC_NO: '▽',
  KC_TRNS: '▽',
  KC_ENT: 'Enter',
  KC_ESC: 'Esc',
  KC_BSPC: '⌫',
  KC_TAB: 'Tab',
  KC_SPC: 'Space',
  KC_MINS: '-',
  KC_EQL: '=',
  KC_LBRC: '[',
  KC_RBRC: ']',
  KC_BSLS: '\\',
  KC_SCLN: ';',
  KC_QUOT: "'",
  KC_GRV: '`',
  KC_COMM: ',',
  KC_DOT: '.',
  KC_SLSH: '/',
  KC_CAPS: 'Caps',
  KC_PSCR: 'PrtSc',
  KC_SLCK: 'ScrLk',
  KC_PAUS: 'Pause',
  KC_INS: 'Ins',
  KC_HOME: 'Home',
  KC_PGUP: 'PgUp',
  KC_DEL: 'Del',
  KC_END: 'End',
  KC_PGDN: 'PgDn',
  KC_RGHT: '→',
  KC_LEFT: '←',
  KC_DOWN: '↓',
  KC_UP: '↑',
  KC_LCTL: 'LCtrl',
  KC_LSFT: 'LShift',
  KC_LALT: 'LAlt',
  KC_LGUI: 'LGui',
  KC_RCTL: 'RCtrl',
  KC_RSFT: 'RShift',
  KC_RALT: 'RAlt',
  KC_RGUI: 'RGui',
  KC_APP: 'Menu',
  KC_MUTE: 'Mute',
  KC_VOLU: 'Vol+',
  KC_VOLD: 'Vol-',
  KC_MNXT: 'Next',
  KC_MPRV: 'Prev',
  KC_MSTP: 'Stop',
  KC_MPLY: 'Play',
  KC_BRIU: 'Bri+',
  KC_BRID: 'Bri-',
  RESET: 'Reset',
  MAGIC_TOGGLE_NKRO: 'NKRO',
  KC_GESC: 'Grave/Esc',
};

for (let i = 1; i <= 24; i++) {
  LABELS[`KC_F${i}`] = `F${i}`;
}
for (let i = 1; i <= 9; i++) {
  LABELS[`KC_P${i}`] = `P${i}`;
}
LABELS.KC_P0 = 'P0';
for (const n of ['NLCK', 'PSLS', 'PAST', 'PMNS', 'PPLS', 'PENT', 'PDOT', 'PEQL']) {
  LABELS[`KC_${n}`] = n === 'NLCK' ? 'Num' : n.replace('P', '').toLowerCase();
}

export function labelForName(name) {
  if (!name) return '';
  if (LABELS[name]) return LABELS[name];
  if (name.startsWith('KC_')) {
    const rest = name.slice(3);
    if (rest.length === 1) return rest;
    return rest;
  }
  return name;
}

/* ------------------------------------------------------------------ */
/* Picker tree                                                        */
/* ------------------------------------------------------------------ */

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `KC_${c}`);
const DIGITS = '1234567890'.split('').map((c) => `KC_${c}`);

const SYMBOLS = [
  ['KC_MINS', '-'], ['KC_EQL', '='], ['KC_LBRC', '['], ['KC_RBRC', ']'],
  ['KC_BSLS', '\\'], ['KC_SCLN', ';'], ['KC_QUOT', "'"], ['KC_GRV', '`'],
  ['KC_COMM', ','], ['KC_DOT', '.'], ['KC_SLSH', '/'],
];

const WHITESPACE = [KC_TRNS, 'KC_SPC', 'KC_TAB', 'KC_ENT', 'KC_BSPC', 'KC_ESC', 'KC_DEL'];

const MODIFIERS = [
  'KC_LCTL', 'KC_LSFT', 'KC_LALT', 'KC_LGUI',
  'KC_RCTL', 'KC_RSFT', 'KC_RALT', 'KC_RGUI',
];

const NAV = [
  KC_NO, 'KC_PSCR', 'KC_SLCK', 'KC_PAUS',
  'KC_INS', 'KC_HOME', 'KC_PGUP',
  'KC_DEL', 'KC_END', 'KC_PGDN',
  'KC_RGHT', 'KC_LEFT', 'KC_DOWN', 'KC_UP', 'KC_APP',
];

const FUNC = Array.from({ length: 24 }, (_, i) => `KC_F${i + 1}`);

const NUMPAD = [
  'KC_NLCK', 'KC_PSLS', 'KC_PAST', 'KC_PMNS', 'KC_PPLS', 'KC_PENT',
  'KC_P1', 'KC_P2', 'KC_P3', 'KC_P4', 'KC_P5', 'KC_P6', 'KC_P7',
  'KC_P8', 'KC_P9', 'KC_P0', 'KC_PDOT', 'KC_PEQL',
];

const MEDIA = [
  'KC_MUTE', 'KC_VOLU', 'KC_VOLD', 'KC_MNXT', 'KC_MPRV', 'KC_MSTP', 'KC_MPLY',
  'KC_MSEL', 'KC_EJCT', 'KC_MAIL', 'KC_CALC', 'KC_MYCM',
  'KC_WWW_SEARCH', 'KC_WWW_HOME', 'KC_WWW_BACK', 'KC_WWW_FORWARD', 'KC_WWW_STOP',
  'KC_WWW_REFRESH', 'KC_WWW_FAVORITES', 'KC_BRIU', 'KC_BRID',
  'KC_PWR', 'KC_SLEP', 'KC_WAKE',
];

const MOUSE = [
  'KC_MS_UP', 'KC_MS_DOWN', 'KC_MS_LEFT', 'KC_MS_RIGHT',
  'KC_MS_BTN1', 'KC_MS_BTN2', 'KC_MS_BTN3', 'KC_MS_BTN4', 'KC_MS_BTN5',
  'KC_MS_WH_UP', 'KC_MS_WH_DOWN', 'KC_MS_WH_LEFT', 'KC_MS_WH_RIGHT',
  'KC_MS_ACCEL0', 'KC_MS_ACCEL1', 'KC_MS_ACCEL2',
];

/** Legacy (protocol <= 12) QMK lighting keycodes, "qmk_lighting" definitions. */
const LIGHTING_LEGACY = [
  'RGB_TOG', 'RGB_MOD', 'RGB_RMOD', 'RGB_HUI', 'RGB_HUD', 'RGB_SAI', 'RGB_SAD',
  'RGB_VAI', 'RGB_VAD', 'RGB_SPI', 'RGB_SPD',
  'RGB_M_P', 'RGB_M_B', 'RGB_M_R', 'RGB_M_SW', 'RGB_M_SN', 'RGB_M_K',
  'RGB_M_X', 'RGB_M_G',
  'BL_ON', 'BL_OFF', 'BL_DEC', 'BL_INC', 'BL_TOGG', 'BL_STEP', 'BL_BRTG',
];

/** Protocol 13 lighting keycodes. */
const LIGHTING_V13 = [
  'RM_TOGG', 'RM_NEXT', 'RM_PREV', 'RM_HUEU', 'RM_HUED', 'RM_SATU', 'RM_SATD',
  'RM_VALU', 'RM_VALD', 'RM_SPDU', 'RM_SPDD',
  'UG_TOGG', 'UG_NEXT', 'UG_PREV', 'UG_HUEU', 'UG_HUED', 'UG_SATU', 'UG_SATD',
  'UG_VALU', 'UG_VALD', 'UG_SPDU', 'UG_SPDD',
];

const SYSTEM = ['RESET', 'DEBUG', 'MAGIC_TOGGLE_NKRO', 'KC_GESC'];

/**
 * Build the grouped keycode list shown in the picker.
 * @param {{customKeycodes?: Array<any>, keycodes?: string[]}} definition
 * @param {number} protocol
 */
export function buildKeycodeGroups(definition, protocol) {
  const dict = getBasicKeyDict(protocol);
  const groups = [];

  const pick = (names) =>
    names
      .filter((n) => typeof n === 'number' || dict[n] !== undefined)
      .map((n) => ({
        name: typeof n === 'number' ? null : n,
        code: typeof n === 'number' ? n : dict[n],
        label: typeof n === 'number' ? (n === KC_NO ? '▽' : '▽') : labelForName(n),
      }));

  groups.push({ id: 'basic', title: '基本', items: pick([...ALPHA, ...DIGITS, ...SYMBOLS.map(([n]) => n)]) });
  groups.push({ id: 'whitespace', title: '空白 / 编辑', items: pick(WHITESPACE) });
  groups.push({ id: 'mods', title: '修饰键', items: pick(MODIFIERS) });
  groups.push({ id: 'nav', title: '导航', items: pick(NAV) });
  groups.push({ id: 'func', title: '功能键', items: pick(FUNC) });
  groups.push({ id: 'numpad', title: '小键盘', items: pick(NUMPAD) });
  groups.push({ id: 'media', title: '媒体 / 系统', items: pick(MEDIA) });
  groups.push({ id: 'mouse', title: '鼠标', items: pick(MOUSE) });

  // Custom keycodes from the keyboard definition (QK_KB range).
  const custom = Array.isArray(definition?.customKeycodes) ? definition.customKeycodes : [];
  if (custom.length) {
    const base = dict._QK_KB ?? 0x5f80;
    groups.push({
      id: 'custom',
      title: '自定义功能 (MQ80)',
      items: custom.map((c, i) => ({
        name: `QK_KB_${i}`,
        code: base + i,
        label: c.shortName || c.name || `CUSTOM(${i})`,
        title: c.title,
      })),
    });
  }

  const lighting = protocol >= 13 ? LIGHTING_V13 : LIGHTING_LEGACY;
  groups.push({ id: 'lighting', title: '灯光', items: pick(lighting) });
  groups.push({ id: 'system', title: '系统', items: pick(SYSTEM) });

  return groups;
}

/**
 * Describe a 16-bit keycode for display on a keycap.
 * @returns {{label: string, sub?: string, custom?: boolean, transparent?: boolean}}
 */
export function describeCode(code, definition, protocol) {
  const dict = getBasicKeyDict(protocol);
  const ranges = advancedRanges(dict);

  if (code === KC_NO) return { label: '', sub: 'None', transparent: false };
  if (code === KC_TRNS) return { label: '▽', sub: undefined, transparent: true };

  // custom keycodes
  const [kbBase, kbMax] = ranges.qkKb;
  if (code >= kbBase && code <= kbMax) {
    const idx = code - kbBase;
    const c = definition?.customKeycodes?.[idx];
    if (c) return { label: c.shortName || c.name, custom: true };
    return { label: `CUSTOM(${idx})`, custom: true };
  }

  // reverse lookup of the plain dictionary entries
  const name = BYTE_TO_NAME[dictRefKey(protocol)]?.[code] || BYTE_TO_NAME.global[code];
  if (name) return { label: labelForName(name) };

  if (ranges.layerTap && code >= ranges.layerTap[0] && code <= ranges.layerTap[1]) {
    const layer = (code >> 8) & 0x0f;
    const kc = code & 0xff;
    return { label: `L${layer}`, sub: kc ? labelForByte(kc, dict) : '', };
  }
  if (ranges.modTap && code >= ranges.modTap[0] && code <= ranges.modTap[1]) {
    const mod = (code >> 8) & 0x1f;
    const kc = code & 0xff;
    return { label: `${modLabel(mod)}`, sub: kc ? labelForByte(kc, dict) : '' };
  }
  const layerSimple = [
    ['momentary', 'MO'],
    ['toggleLayer', 'TG'],
    ['to', 'TO'],
    ['defLayer', 'DF'],
    ['oneShotLayer', 'OSL'],
    ['layerTapToggle', 'TT'],
  ];
  for (const [key, tag] of layerSimple) {
    const r = ranges[key];
    if (r && code >= r[0] && code <= r[1]) return { label: `${tag}(${code - r[0]})` };
  }
  if (ranges.oneShotMod && code >= ranges.oneShotMod[0] && code <= ranges.oneShotMod[1]) {
    return { label: `OSM(${modLabel(code & 0x1f)})` };
  }

  return { label: `0x${code.toString(16).toUpperCase().padStart(4, '0')}` };
}

const MOD_NAMES = ['Ctrl', 'Shift', 'Alt', 'Gui'];
function modLabel(mask) {
  const parts = [];
  if (mask & 0x01) parts.push('Ctrl');
  if (mask & 0x02) parts.push('Shift');
  if (mask & 0x04) parts.push('Alt');
  if (mask & 0x08) parts.push('Gui');
  return (parts.join('+') || 'Mod');
}

function labelForByte(byte, dict) {
  for (const [name, code] of Object.entries(dict)) {
    if (code === byte && !name.startsWith('_')) return labelForName(name);
  }
  return `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}

/* reverse maps ---------------------------------------------------- */
const dictRefKey = (protocol) =>
  protocol >= 13 ? 'v13' : protocol === 12 ? 'v12' : protocol === 11 ? 'v11' : protocol === 10 ? 'v10' : 'v9';

const BYTE_TO_NAME = (() => {
  const build = (dict) => {
    const m = {};
    for (const [name, code] of Object.entries(dict)) {
      if (name.startsWith('_')) continue;
      if (m[code] === undefined) m[code] = name;
    }
    return m;
  };
  const global = {};
  for (const d of [KEY_DICT_V9, KEY_DICT_V10, KEY_DICT_V11, KEY_DICT_V12, KEY_DICT_V13]) {
    for (const [code, name] of Object.entries(build(d))) {
      if (global[code] === undefined) global[code] = name;
    }
  }
  return {
    v9: build(KEY_DICT_V9),
    v10: build(KEY_DICT_V10),
    v11: build(KEY_DICT_V11),
    v12: build(KEY_DICT_V12),
    v13: build(KEY_DICT_V13),
    global,
  };
})();

export { advancedRanges as ranges };
