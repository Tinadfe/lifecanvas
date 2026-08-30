// tools/gen-icons.mjs — 生成 PWA 图标（纯 Node，无依赖）
// 用法: node tools/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'icons');
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, px) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      const o = y * (1 + w * 4) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// 配色
const BG = [246, 239, 227];      // 象牙
const SUN = [196, 123, 90];      // 陶土橙（太阳）
const MTN = [63, 93, 74];        // 墨绿（山）
const MTN2 = [88, 122, 97];      // 浅绿（远山）

function makeIcon(size) {
  const R = size * 0.16;                       // 圆角
  const cx = size / 2, cy = size * 0.40;       // 太阳圆心
  const sunR = size * 0.21;                    // 太阳半径
  const horizon = size * 0.72;                 // 地平线
  const inRoundRect = (x, y) => {
    const nx = Math.min(x, size - 1 - x), ny = Math.min(y, size - 1 - y);
    if (nx < R && ny < R) return Math.hypot(x - (R - 0.5), y - (R - 0.5)) <= R;
    if (x > size - 1 - R && y < R) return Math.hypot(x - (size - R), y - (R - 0.5)) <= R;
    if (x < R && y > size - 1 - R) return Math.hypot(x - (R - 0.5), y - (size - R)) <= R;
    if (x > size - 1 - R && y > size - 1 - R) return Math.hypot(x - (size - R), y - (size - R)) <= R;
    return true;
  };
  return png(size, size, (x, y) => {
    if (!inRoundRect(x, y)) return [0, 0, 0, 0];
    // 太阳
    if (Math.hypot(x - cx, y - cy) < sunR) return [...SUN, 255];
    // 山（两条三角山脊）
    if (y > horizon - (size * 0.05) * Math.max(0, 1 - Math.abs(x - size * 0.30) / (size * 0.24))) {
      const ridge1 = horizon - (size * 0.16) * Math.max(0, 1 - Math.abs(x - size * 0.30) / (size * 0.26));
      if (y > ridge1) return [...MTN2, 255];
      const ridge2 = horizon - (size * 0.30) * Math.max(0, 1 - Math.abs(x - size * 0.72) / (size * 0.34));
      if (y > ridge2) return [...MTN, 255];
    }
    return [...BG, 255];
  });
}

const sizes = [512, 192, 180];
for (const s of sizes) {
  const buf = makeIcon(s);
  const file = join(OUT, `icon-${s}.png`);
  writeFileSync(file, buf);
  console.log('生成', file, buf.length, 'bytes');
}
