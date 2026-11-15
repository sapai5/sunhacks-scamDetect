// Generates the PWA icons in public/icons/ (no dependencies: raw PNG via zlib).
// Design: a hung-up handset over the name's "...": listening, listening, scam. Same geometry as
// public/logo.svg and public/icon.svg (512 units). Run: npm run icons -w frontend
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x11, 0x18, 0x27]; // --color-text
const FG = [0xf9, 0xfa, 0xfb]; // handset
const DOT = [0x6b, 0x72, 0x80]; // --color-listening
const RED = [0xf8, 0x71, 0x71]; // --color-danger (dark)

// Handset: a 52-wide arc of radius 170 about (256,320), spanning 55deg either side of straight up,
// with a rounded 76x88 pad at each end.
const ARC = { cx: 256, cy: 320, r: 170, half: 26, sweep: (55 * Math.PI) / 180 };
const PAD = { x0: 218, y0: 124, x1: 294, y1: 212, r: 18 };
const DOTS = [[176, DOT], [256, DOT], [336, RED]] as const;
const DOT_Y = 372, DOT_R = 30;

function inPad(u: number, v: number, angle: number): boolean {
  // rotate the point back by `angle` about the arc centre, then test the upright rounded rect
  const dx = u - ARC.cx, dy = v - ARC.cy;
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const x = ARC.cx + dx * cos - dy * sin, y = ARC.cy + dx * sin + dy * cos;
  if (x < PAD.x0 || x > PAD.x1 || y < PAD.y0 || y > PAD.y1) return false;
  const ex = Math.max(PAD.x0 + PAD.r - x, 0, x - (PAD.x1 - PAD.r));
  const ey = Math.max(PAD.y0 + PAD.r - y, 0, y - (PAD.y1 - PAD.r));
  return ex * ex + ey * ey <= PAD.r * PAD.r;
}

/** Colour of the artwork at (u, v) in 512-unit logo space. */
function art(u: number, v: number): number[] {
  for (const [cx, col] of DOTS) if (Math.hypot(u - cx, v - DOT_Y) <= DOT_R) return col as unknown as number[];
  const dx = u - ARC.cx, dy = v - ARC.cy;
  const d = Math.hypot(dx, dy);
  if (Math.abs(d - ARC.r) <= ARC.half && Math.abs(Math.atan2(dx, -dy)) <= ARC.sweep) return FG;
  if (inPad(u, v, -ARC.sweep) || inPad(u, v, ARC.sweep)) return FG;
  return BG;
}

/**
 * @param size  output px
 * @param scale artwork size relative to the tile (maskable icons keep art inside the 80% safe zone)
 * @param radius tile corner radius as a fraction of size (0 = full-bleed square, for maskable/iOS)
 */
function icon(size: number, { scale = 1, radius = 0 }: { scale?: number; radius?: number } = {}): Buffer {
  const SS = 4; // supersampling per axis for antialiasing
  const k = 512 / size / scale; // output px -> logo units, scaled about the centre
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
          const col = art((fx - size / 2) * k + 256, (fy - size / 2) * k + 256);
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
