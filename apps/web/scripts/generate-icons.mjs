/**
 * Generates the PWA icon set as real PNGs, with no image dependency.
 *
 * Chrome will not offer installation from an SVG-only manifest on every
 * platform, so the icons have to be raster. Rather than commit binaries
 * produced by some designer's machine, they are drawn here from the same
 * tokens the CSS uses and regenerated with `node scripts/generate-icons.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const INK = [0x14, 0x14, 0x1a];
const LIVE = [0xff, 0x2d, 0x55];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // Each scanline is prefixed with its filter byte; filter 0 keeps it simple
  // and the payload compresses well anyway because the art is flat.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * The mark: a dark rounded tile, a live-red ring, and a white play triangle.
 * `padding` is the maskable safe-area inset — Android crops up to 10 % per
 * edge, so the maskable variant draws the glyph smaller.
 */
function draw(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const inset = maskable ? 0 : size * 0.06;
  const radius = maskable ? size : size * 0.22;
  const glyphScale = maskable ? 0.58 : 0.72;

  const ringOuter = (size * glyphScale) / 2;
  const ringInner = ringOuter - size * 0.055;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;

      // Rounded-rectangle mask for the non-maskable icon.
      const insideTile =
        maskable ||
        (() => {
          const left = inset;
          const right = size - inset;
          const dx = Math.max(left + radius - x, 0, x - (right - radius));
          const dy = Math.max(left + radius - y, 0, y - (right - radius));
          return (
            x >= left &&
            x <= right &&
            y >= left &&
            y <= right &&
            Math.hypot(dx, dy) <= radius
          );
        })();

      if (!insideTile) {
        rgba[index + 3] = 0;
        continue;
      }

      // Subtle vertical gradient so the tile is not a flat block.
      const base = mix(INK, [0x2a, 0x2a, 0x36], y / size);
      let [r, g, b] = base;

      const distance = Math.hypot(x - center, y - center);
      if (distance <= ringOuter && distance >= ringInner) {
        [r, g, b] = LIVE;
      }

      // Play triangle, pointing right, inscribed in the ring.
      const triangleHeight = ringInner * 1.05;
      const triangleX = x - (center - triangleHeight * 0.35);
      const triangleY = y - center;
      const halfSpan = (triangleHeight - triangleX) * 0.62;
      if (
        triangleX >= 0 &&
        triangleX <= triangleHeight &&
        Math.abs(triangleY) <= halfSpan &&
        distance < ringInner
      ) {
        [r, g, b] = WHITE;
      }

      rgba[index] = r;
      rgba[index + 1] = g;
      rgba[index + 2] = b;
      rgba[index + 3] = 255;
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
];

for (const target of targets) {
  writeFileSync(resolve(OUT_DIR, target.file), draw(target.size, { maskable: target.maskable }));
  console.log(`icons: wrote ${target.file}`);
}
