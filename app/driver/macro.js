/**
 * VIA macro codec.
 *
 * A macro buffer is a flat byte array holding every macro back to back.
 * Each macro ends with MacroTerminator (0x00). Inside a macro:
 *
 *   protocol < 11                     protocol >= 11
 *   ─────────────────────────────     ─────────────────────────────────
 *   0x01 <kc>            Tap          0x01 0x01 <kc>        Tap
 *   0x02 <kc>            Down         0x01 0x02 <kc>        Down
 *   0x03 <kc>            Up           0x01 0x03 <kc>        Up
 *   (unsupported) Delay               0x01 0x04 <digits> 0x7C ('|') Delay
 *   <ascii>              text         <ascii>              text
 *
 * Reference: the-via/app -> src/utils/macro-api/{macro-api.ts,macro-api.v11.ts}
 */

export const MACRO_TERMINATOR = 0x00;
export const KEY_ACTION_PREFIX = 0x01;
export const DELAY_TERMINATOR = 124; // '|'

export const KEY_ACTION = {
  TAP: 1,
  DOWN: 2,
  UP: 3,
  DELAY: 4,
};

/** Action kinds used by the UI. */
export const ACTION = {
  TAP: 'tap',
  DOWN: 'down',
  UP: 'up',
  DELAY: 'delay',
  TEXT: 'text',
};

const ACTION_TO_CODE = {
  [ACTION.TAP]: KEY_ACTION.TAP,
  [ACTION.DOWN]: KEY_ACTION.DOWN,
  [ACTION.UP]: KEY_ACTION.UP,
  [ACTION.DELAY]: KEY_ACTION.DELAY,
};
const CODE_TO_ACTION = {
  [KEY_ACTION.TAP]: ACTION.TAP,
  [KEY_ACTION.DOWN]: ACTION.DOWN,
  [KEY_ACTION.UP]: ACTION.UP,
  [KEY_ACTION.DELAY]: ACTION.DELAY,
};

export const supportsDelay = (protocol) => protocol >= 11;

/* ------------------------------------------------------------------ */
/* Decode: bytes -> sequences                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {number[]} bytes   whole macro buffer
 * @param {number} count     number of macros
 * @param {number} protocol
 * @param {Record<number,string>} byteToName  byte -> keycode name
 * @returns {Array<Array<{action: string, value: any}>>}
 */
export function decodeMacros(bytes, count, protocol, byteToName) {
  const sequences = [];
  let current = [];
  let macroId = 0;
  const name = (b) => byteToName[b] || `0x${(b || 0).toString(16).toUpperCase().padStart(2, '0')}`;

  if (!count) return sequences;

  let i = 0;
  const next = () => bytes[++i];
  while (i < bytes.length && macroId < count) {
    const byte = bytes[i];
    if (byte === MACRO_TERMINATOR) {
      sequences[macroId] = current;
      macroId++;
      current = [];
      i++;
      continue;
    }
    if (protocol >= 11) {
      if (byte === KEY_ACTION_PREFIX) {
        const action = next();
        if (action === KEY_ACTION.DELAY) {
          const digits = [];
          let b = next();
          while (b !== DELAY_TERMINATOR && i < bytes.length) {
            digits.push(String.fromCharCode(b));
            b = next();
          }
          current.push({ action: ACTION.DELAY, value: parseInt(digits.join(''), 10) || 0 });
        } else if (CODE_TO_ACTION[action]) {
          const kc = next();
          current.push({ action: CODE_TO_ACTION[action], value: name(kc) });
        } else {
          current.push({ action: ACTION.TEXT, value: '' });
        }
      } else {
        pushText(current, String.fromCharCode(byte));
      }
    } else {
      if (CODE_TO_ACTION[byte] && byte !== KEY_ACTION.DELAY) {
        const kc = next();
        current.push({ action: CODE_TO_ACTION[byte], value: name(kc) });
      } else {
        pushText(current, String.fromCharCode(byte));
      }
    }
    i++;
  }
  // keep the array dense up to `count`
  for (let m = 0; m < count; m++) if (!sequences[m]) sequences[m] = [];
  return sequences;
}

function pushText(seq, char) {
  const last = seq[seq.length - 1];
  if (last && last.action === ACTION.TEXT) last.value += char;
  else seq.push({ action: ACTION.TEXT, value: char });
}

/* ------------------------------------------------------------------ */
/* Encode: sequences -> bytes                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<Array<{action: string, value: any}>>} sequences
 * @param {number} protocol
 * @param {Record<string,number>} nameToByte
 */
export function encodeMacros(sequences, protocol, nameToByte) {
  const out = [];
  for (const sequence of sequences) {
    for (const item of sequence) {
      switch (item.action) {
        case ACTION.TAP:
        case ACTION.DOWN:
        case ACTION.UP: {
          const kc = nameToByte[item.value];
          if (kc === undefined) break;
          const code = ACTION_TO_CODE[item.action];
          if (protocol >= 11) out.push(KEY_ACTION_PREFIX, code);
          else out.push(code);
          out.push(kc & 0xff);
          break;
        }
        case ACTION.DELAY: {
          if (!supportsDelay(protocol)) break;
          const digits = String(Math.max(0, Math.round(item.value || 0)));
          out.push(KEY_ACTION_PREFIX, KEY_ACTION.DELAY);
          for (const ch of digits) out.push(ch.charCodeAt(0));
          out.push(DELAY_TERMINATOR);
          break;
        }
        case ACTION.TEXT: {
          for (const ch of String(item.value || '')) out.push(ch.charCodeAt(0) & 0xff);
          break;
        }
        default:
          break;
      }
    }
    out.push(MACRO_TERMINATOR);
  }
  return out;
}

/** Rough byte cost of one action, used for the buffer-usage meter. */
export function actionByteSize(item, protocol) {
  switch (item.action) {
    case ACTION.TAP:
    case ACTION.DOWN:
    case ACTION.UP:
      return protocol >= 11 ? 3 : 2;
    case ACTION.DELAY:
      return supportsDelay(protocol) ? 3 + String(item.value || 0).length : 0;
    case ACTION.TEXT:
      return String(item.value || '').length;
    default:
      return 0;
  }
}

/** Turn "abc" into tap actions for each character (extra helper for the UI). */
export function textToTaps(text) {
  return String(text)
    .split('')
    .map((ch) => ({ action: ACTION.TEXT, value: ch }));
}
