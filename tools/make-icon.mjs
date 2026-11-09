/**
 * Generate build/icon.ico for the packaged app.
 *
 *   node tools/make-icon.mjs [outPath]
 *
 * Pure Node (only the built-in zlib) — no image libraries. Draws a rounded
 * gradient tile with a 4x3 keycap grid, renders it at several sizes with
 * 3x supersampling for smooth edges, PNG-encodes each one and packs them
 * into a multi-size .ico.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outPath = process.argv[2] || path.join('build', 'icon.ico');
const SIZES = [256, 128, 64, 48, 32, 16];
const SS = 3; // supersampling factor

/* ------------------------------- palette ------------------------------- */

const src = [0x2f, 0x6d, 0xf6]; // #2f6df6
const dst = [0x7c, 0x3a, 0xed]; // #7c3aed
const accent = [0xff, 0xd1, 0x66]; // #ffd166

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const over = (bg, fg, alpha) => mix(bg, fg, alpha);

/** signed distance to a rounded rectangle centred in [w,h] */
function roundedRect(x, y, w, h, radius) {
  const dx = Math.abs(x - w / 2) - (w / 2 - radius);
  const dy = Math.abs(y - h / 2) - (h / 2 - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

/* ------------------------------ rendering ------------------------------ */

function render(size) {
  const out = new Uint8Array(size * size * 4);
  const px = size * SS;

  // geometry, in supersampled pixels
  const tileR = px * 0.22;
  const margin = px * 0.16;
  const cols = 4;
  const rows = 3;
  const gap = px * 0.045;
  const cellW = (px - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (px - margin * 2 - gap * (rows - 1)) / rows;
  const keyR = Math.min(cellW, cellH) * 0.26;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px_ = x * SS + sx + 0.5;
          const py_ = y * SS + sy + 0.5;

          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;

          // tile
          const tileD = roundedRect(px_, py_, px, px, tileR);
          const tileA = Math.min(Math.max(0.5 - tileD, 0), 1);
          if (tileA > 0) {
            const t = (px_ / px + py_ / px) / 2;
            const base = mix(src, dst, t);
            cr = base[0];
            cg = base[1];
            cb = base[2];
            ca = 255;

            // keycaps
            for (let cy = 0; cy < rows; cy++) {
              for (let cx = 0; cx < cols; cx++) {
                const kx = margin + cx * (cellW + gap);
                const ky = margin + cy * (cellH + gap);
                const d = roundedRect(px_ - kx, py_ - ky, cellW, cellH, keyR);
                const kA = Math.min(Math.max(0.5 - d, 0), 1);
                if (kA <= 0) continue;
                // one accent key in the bottom-right corner
                const isAccent = cx === cols - 1 && cy === rows - 1;
                const face = isAccent ? accent : [255, 255, 255];
                const alpha = (isAccent ? 0.98 : 0.92) * kA;
                const nr = over([cr, cg, cb], face, alpha);
                cr = nr[0];
                cg = nr[1];
                cb = nr[2];
              }
            }
          }

          r += cr * (ca / 255);
          g += cg * (ca / 255);
          b += cb * (ca / 255);
          a += ca;
        }
      }

      const n = SS * SS;
      const alpha = a / n;
      const idx = (y * size + x) * 4;
      out[idx] = alpha ? Math.round(r / (a / 255 || 1)) : 0;
      out[idx + 1] = alpha ? Math.round(g / (a / 255 || 1)) : 0;
      out[idx + 2] = alpha ? Math.round(b / (a / 255 || 1)) : 0;
      out[idx + 3] = Math.round(alpha);
    }
  }
  return out;
}

/* ------------------------------ PNG encode ----------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ ICO pack ------------------------------- */

const images = SIZES.map((size) => ({ size, png: encodePng(render(size), size) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + images.length * 16;
const entries = images.map(({ size, png }) => {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size;
  e[1] = size >= 256 ? 0 : size;
  e[2] = 0; // palette
  e[3] = 0;
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
console.log(
  `wrote ${outPath} (${SIZES.join('/')} px, ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`,
);
