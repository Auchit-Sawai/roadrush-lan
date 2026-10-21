import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '..', 'extension', 'icons');
const S = 512;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makeCanvas(size) {
  return new Uint8ClampedArray(size * size * 4);
}

function mixPixel(canvas, size, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const index = (y * size + x) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  const srcA = (color[3] / 255) * a;
  const dstA = canvas[index + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    canvas[index + c] = (color[c] * srcA + canvas[index + c] * dstA * (1 - srcA)) / outA;
  }
  canvas[index + 3] = outA * 255;
}

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
    && x >= left && x <= right && y >= top && y <= bottom;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function drawIcon(size = S) {
  const canvas = makeCanvas(size);
  const scale = size / 512;
  const RED = [230, 57, 70, 255];
  const CREAM = [243, 238, 226, 255];
  const DARK = [13, 23, 34, 255];
  const GOLD = [233, 196, 106, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundedRect(x, y, 18 * scale, 18 * scale, 494 * scale, 494 * scale, 92 * scale)) continue;
      mixPixel(canvas, size, x, y, DARK, 1);
      if (distToSegment(x, y, 60 * scale, 462 * scale, 430 * scale, 62 * scale) < 38 * scale) {
        mixPixel(canvas, size, x, y, RED, 0.9);
      }
      if (distToSegment(x, y, 60 * scale, 462 * scale, 430 * scale, 62 * scale) < 7 * scale) {
        mixPixel(canvas, size, x, y, GOLD, 0.9);
      }
    }
  }

  const wheels = [
    [172 * scale, 344 * scale, 74 * scale],
    [354 * scale, 344 * scale, 74 * scale],
  ];
  for (const [cx, cy, radius] of wheels) {
    for (let y = Math.floor(cy - radius - 6); y <= cy + radius + 6; y++) {
      for (let x = Math.floor(cx - radius - 6); x <= cx + radius + 6; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (Math.abs(d - radius) < 12 * scale) mixPixel(canvas, size, x, y, CREAM, 1);
      }
    }
  }

  const strokes = [
    [172 * scale, 344 * scale, 250 * scale, 260 * scale, 15 * scale],
    [250 * scale, 260 * scale, 354 * scale, 344 * scale, 15 * scale],
    [250 * scale, 260 * scale, 292 * scale, 210 * scale, 14 * scale],
    [286 * scale, 210 * scale, 332 * scale, 210 * scale, 13 * scale],
    [250 * scale, 260 * scale, 324 * scale, 272 * scale, 14 * scale],
    [300 * scale, 272 * scale, 356 * scale, 262 * scale, 13 * scale],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (const [ax, ay, bx, by, width] of strokes) {
        if (distToSegment(x, y, ax, ay, bx, by) < width / 2) {
          mixPixel(canvas, size, x, y, CREAM, 1);
        }
      }
    }
  }

  const seat = [250, 292, 326, 308];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x >= seat[0] * scale && x <= seat[2] * scale && y >= seat[1] * scale && y <= seat[3] * scale) {
        mixPixel(canvas, size, x, y, RED, 1);
      }
    }
  }
  return canvas;
}

function downsample(source, sourceSize, targetSize) {
  const target = makeCanvas(targetSize);
  const ratio = sourceSize / targetSize;
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = Math.floor(y * ratio); sy < Math.floor((y + 1) * ratio); sy++) {
        for (let sx = Math.floor(x * ratio); sx < Math.floor((x + 1) * ratio); sx++) {
          const index = (sy * sourceSize + sx) * 4;
          const alpha = source[index + 3] / 255;
          r += source[index] * alpha;
          g += source[index + 1] * alpha;
          b += source[index + 2] * alpha;
          a += alpha;
          count++;
        }
      }
      const index = (y * targetSize + x) * 4;
      if (a > 0) {
        target[index] = r / a;
        target[index + 1] = g / a;
        target[index + 2] = b / a;
      }
      target[index + 3] = (a / count) * 255;
    }
  }
  return target;
}

const source = drawIcon(S);
mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const pixels = size === S ? source : downsample(source, S, size);
  const png = encodePng(size, size, Buffer.from(pixels.buffer));
  writeFileSync(resolve(OUT, `icon${size}.png`), png);
  console.log(`wrote icon${size}.png`);
}
