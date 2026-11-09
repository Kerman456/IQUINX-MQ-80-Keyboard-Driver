/**
 * Extract the firmware images embedded in an IQUNIX / Telink updater .exe.
 *
 *   node tools/extract-firmware.mjs "<path to MQ80-...exe>" [outDir]
 *
 * The updater is a .NET (C#/WinForms) build of Telink's USB_OTA tool. The
 * firmware lives in two embedded manifest resources — `code_2M` (the 2 MB
 * flash code region) and `param_128K` (128 KB parameter area) — stored as
 * ByteArray entries inside .NET `.resources` blobs.
 *
 * How it works:
 *   1. parse the PE header to find the CLR header and the embedded-resource
 *      block (a flat sequence of [uint32 length][bytes]);
 *   2. in each blob, collect every entry whose layout is
 *      [0x20 = ResourceTypeCode.ByteArray][uint32 length][data];
 *   3. chain the candidates (each entry must start where the previous ended)
 *      to reject false positives;
 *   4. pair the surviving entries with the resource names found in the blob
 *      header, in file order.
 *
 * Read-only apart from writing the extracted files; no third-party packages.
 */
import fs from 'node:fs';
import path from 'node:path';

const exePath = process.argv[2];
if (!exePath) {
  console.error('usage: node tools/extract-firmware.mjs <installer.exe> [outDir]');
  process.exit(1);
}
const outDir = process.argv[3] || 'extracted-firmware';

const d = fs.readFileSync(exePath);
const u16 = (o) => d.readUInt16LE(o);
const u32 = (o) => d.readUInt32LE(o);
const hx = (n) => `0x${n.toString(16)}`;

/* --------------------------- 1. PE / CLR --------------------------- */

const peOff = u32(0x3c);
if (d.toString('latin1', peOff, peOff + 4) !== 'PE\0\0') throw new Error('not a PE file');
const nSections = u16(peOff + 6);
const secOff = peOff + 24 + u16(peOff + 20);

const sections = [];
for (let i = 0; i < nSections; i++) {
  const o = secOff + i * 40;
  sections.push({
    name: d.toString('latin1', o, o + 8).replace(/\0+$/, ''),
    vsize: u32(o + 8),
    vaddr: u32(o + 12),
    rsize: u32(o + 16),
    raddr: u32(o + 20),
  });
}
const r2o = (rva) => {
  for (const s of sections) {
    if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rsize)) return s.raddr + (rva - s.vaddr);
  }
  return null;
};

console.log(`PE32 · ${sections.map((s) => `${s.name}(${s.rsize}B)`).join(' ')}`);

const clrRva = u32(peOff + 24 + 96 + 14 * 8);
if (!clrRva) throw new Error('not a .NET assembly (no CLR header)');
const clr = r2o(clrRva);
const resRva = u32(clr + 24);
console.log(`CLR header @ ${hx(clrRva)} · embedded resources @ ${hx(resRva)}`);

/* --------------------- 2. embedded resource blobs ------------------ */

const blobs = [];
for (let cursor = r2o(resRva), guard = 0; guard < 64; guard++) {
  const len = u32(cursor);
  if (!len || cursor + 4 + len > d.length) break;
  blobs.push({ offset: cursor, data: d.subarray(cursor + 4, cursor + 4 + len) });
  cursor += 4 + len;
}
console.log(`found ${blobs.length} embedded .resources blob(s)`);

/* ----------------------------- helpers ----------------------------- */

/** Resource names live in the blob header as [len byte][UTF-16LE][4-byte pad]. */
function readNames(buf, limit = 4096) {
  const names = [];
  for (let i = 0x80; i < Math.min(limit, buf.length - 4); i++) {
    const len = buf[i];
    if (len < 2 || len > 48 || len & 0x80) continue;
    const text = buf.toString('utf16le', i + 1, i + 1 + len);
    if (!/^[\x20-\x7e]{2,}$/.test(text)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(text)) {
      // require 4 padding bytes after the string, matching ResourceWriter
      names.push({ at: i, text });
      i += len + 3;
    }
  }
  return names;
}

/**
 * Find ByteArray entries: [0x20][uint32 length][data]. A candidate is kept
 * only when the whole chain is contiguous, which rules out random 0x20 bytes
 * inside image data.
 */
function findByteArrays(buf, minLen = 32768) {
  const cands = [];
  for (let p = 0x100; p < buf.length - 5; p++) {
    if (buf[p] !== 0x20) continue;
    const len = buf[p + 1] | (buf[p + 2] << 8) | (buf[p + 3] << 16) | (buf[p + 4] << 24);
    if (len < minLen || len > 8 * 1024 * 1024) continue;
    if (p + 5 + len > buf.length) continue;
    cands.push({ start: p, len, dataAt: p + 5 });
  }
  if (cands.length < 2) return cands;

  // keep the longest contiguous chain (entry[i].end === entry[i+1].start)
  let best = [];
  for (const seed of cands) {
    const chain = [seed];
    let cur = seed;
    for (;;) {
      const next = cands.find((c) => c.start === cur.start + 5 + cur.len);
      if (!next) break;
      chain.push(next);
      cur = next;
    }
    if (chain.length > best.length) best = chain;
  }
  return best;
}

/* ------------------------------ run -------------------------------- */

fs.mkdirSync(outDir, { recursive: true });
let wrote = 0;

for (const blob of blobs) {
  const entries = findByteArrays(blob.data);
  if (!entries.length) continue;
  const names = readNames(blob.data).map((n) => n.text);

  console.log(`\n.resources blob @ ${hx(blob.offset)} (${blob.data.length} bytes)`);
  if (names.length) console.log(`  header names: ${names.join(', ')}`);

  entries.forEach((e, i) => {
    const name = names[i] || `bytearray_${i}`;
    const erased = e.dataAt ? countErased(blob.data, e.dataAt, e.len) : 0;
    console.log(
      `  [${i}] ${name.padEnd(14)} ${String(e.len).padStart(9)} bytes` +
        `  (erased 0xFF: ${((erased / e.len) * 100).toFixed(1)}%)`,
    );
    const out = path.join(outDir, `${name}.bin`);
    fs.writeFileSync(out, blob.data.subarray(e.dataAt, e.dataAt + e.len));
    console.log(`       → ${out}`);
    wrote++;
  });
}

function countErased(buf, at, len) {
  let n = 0;
  for (let i = at; i < at + len; i++) if (buf[i] === 0xff) n++;
  return n;
}

console.log(
  wrote
    ? `\nDone — ${wrote} image(s) in ${outDir}/.\n` +
        '`code_2M` is the whole 2 MB flash region; a large share of it is 0xFF (erased).'
    : '\nNo firmware image found — this build does not embed one.',
);
