// Generates the PWA icons in public/icons/ (no dependencies: raw PNG via zlib).
// Design: the Risk/Light in "Protected" green on a dark tile. Run: npm run icons -w frontend
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x11, 0x18, 0x27]; // --color-text
const HALO = [0xdc, 0xfc, 0xe7]; // --color-safe-tint
const CORE = [0x15, 0x80, 0x3d]; // --color-safe

/**
 * @param size  output px
 * @param scale circle size relative to the tile (maskable icons keep art inside the 80% safe zone)
 * @param radius tile corner radius as a fraction of size (0 = full-bleed square, for maskable/iOS)
 */
function icon(size: number, { scale = 1, radius = 0 }: { scale?: number; radius?: number } = {}): Buffer {
  const SS = 4; // supersampling per axis for antialiasing
  const c = size / 2;
  const rHalo = size * 0.36 * scale;
  const rCore = size * 0.28 * scale;
  const rTile = size * radius;
  const px = Buffer.alloc(size * size * 4);
  const inTile = (x: number, y: number) => {
    if (rTile === 0) return true;
    const dx = Math.max(rTile - x, 0, x - (size - rTile));
    const dy = Math.max(rTile - y, 0, y - (size - rTile));
    return dx * dx + dy * dy <= rTile * rTile;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
          if (!inTile(fx, fy)) continue;
          const d = Math.hypot(fx - c, fy - c);
          const col = d <= rCore ? CORE : d <= rHalo ? HALO : BG;
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      // un-premultiply so edge pixels keep their colour
      const cov = a / 255;
      px[i] = cov ? r / cov : 0;
      px[i + 1] = cov ? g / cov : 0;
      px[i + 2] = cov ? b / cov : 0;
      px[i + 3] = a / n;
    }
  }
  return png(size, size, px);
}

function png(w: number, h: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = -1;
  for (const byte of td) crc = CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const out = Buffer.alloc(4);
  out.writeInt32BE(~crc);
  return Buffer.concat([len, td, out]);
}

const dir = new URL('../public/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
const files = {
  'icon-192.png': icon(192, { radius: 0.22 }),
  'icon-512.png': icon(512, { radius: 0.22 }),
  'maskable-512.png': icon(512, { scale: 0.8 }), // full bleed; OS applies its own mask
  'apple-touch-icon.png': icon(180), // iOS rounds corners itself; must be opaque
};
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(new URL(name, dir), buf);
  console.log(`public/icons/${name}  ${buf.length} bytes`);
}
