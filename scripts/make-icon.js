#!/usr/bin/env node
/**
 * 生成应用图标（零依赖）
 * ---------------------------------------------------------------
 * 用 Node 内置 zlib 手写一个 PNG 编码器，画出 M3 主色底 + 药丸形图案。
 * 不引入 sharp/canvas 之类的图形库，保持"构建环境零额外依赖"。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.resolve(__dirname, '..', 'build');
const SIZE = 256;

// M3 primary #6750A4，on-primary #FFFFFF
const BG = [0x67, 0x50, 0xa4, 255];
const FG = [0xff, 0xff, 0xff, 255];
const FG_DIM = [0xcf, 0xbc, 0xff, 255];

/* ---------- 极简绘图画布 ---------- */
class Canvas {
  constructor(size) {
    this.size = size;
    this.data = Buffer.alloc(size * size * 4);
  }
  set(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const a = rgba[3] / 255;
    if (a >= 1) {
      this.data[i] = rgba[0]; this.data[i + 1] = rgba[1];
      this.data[i + 2] = rgba[2]; this.data[i + 3] = 255;
    } else {
      this.data[i] = Math.round(this.data[i] * (1 - a) + rgba[0] * a);
      this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + rgba[1] * a);
      this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + rgba[2] * a);
      this.data[i + 3] = Math.max(this.data[i + 3], rgba[3]);
    }
  }
  /** 圆角矩形填充（4 倍超采样抗锯齿） */
  roundRect(x0, y0, w, h, r, rgba) {
    const SS = 4;
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const px = x + (sx + 0.5) / SS;
            const py = y + (sy + 0.5) / SS;
            if (insideRoundRect(px, py, x0, y0, w, h, r)) hits++;
          }
        }
        if (!hits) continue;
        const a = Math.round((rgba[3] * hits) / (SS * SS));
        this.set(x, y, [rgba[0], rgba[1], rgba[2], a]);
      }
    }
  }
  fill(rgba) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, rgba);
  }
}

function insideRoundRect(px, py, x0, y0, w, h, r) {
  if (px < x0 || py < y0 || px > x0 + w || py > y0 + h) return false;
  const cx = Math.min(Math.max(px, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(py, y0 + r), y0 + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/* ---------- PNG 编码 ---------- */
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(canvas) {
  const { size, data } = canvas;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type 0
    data.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 绘制 ---------- */
function draw() {
  const c = new Canvas(SIZE);
  const S = SIZE;
  c.fill(BG);

  const pad = S * 0.12;
  const box = S - pad * 2;
  // 白色卡片托底
  c.roundRect(pad * 0.72, pad * 0.72, box * 1.1, box * 1.1, S * 0.14, FG);

  // 药丸：斜 45° 的圆角长条
  const cx = S / 2, cy = S / 2;
  const len = S * 0.5;
  const th = S * 0.23;
  c.roundRect(cx - len / 2, cy - th / 2, len, th, th / 2, BG);
  // 药丸分割线（模拟胶囊两色）
  c.roundRect(cx - S * 0.012, cy - th / 2, S * 0.024, th, S * 0.012, FG_DIM);

  // 右上角代表"经济学"的上升折线
  const gx = S * 0.60, gy = S * 0.40;
  const barW = S * 0.045;
  c.roundRect(gx, gy, barW, S * 0.16, barW / 2, BG);
  c.roundRect(gx + barW * 1.7, gy - S * 0.07, barW, S * 0.23, barW / 2, BG);

  return encodePNG(c);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const png = draw();
  const file = path.join(OUT_DIR, 'icon.png');
  fs.writeFileSync(file, png);
  console.log(`[icon] 已生成 ${file} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`);
}

main();
