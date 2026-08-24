import { NextResponse } from 'next/server';

/**
 * Deterministic placeholder imagery.
 *
 * M01 ships no photography and no binary assets: every product, cover, avatar
 * and thumbnail is an SVG generated from its key. That keeps the repository
 * small, the demo consistent on any machine, and the pages fast on a poor
 * connection — an entire catalogue costs a few kilobytes.
 *
 * When `StorageProvider` starts returning real uploads, the stored URLs simply
 * stop pointing here and nothing else changes.
 */

type Kind = 'product' | 'cover' | 'store' | 'avatar' | 'live' | 'upload';

const SIZES: Record<Kind, { width: number; height: number }> = {
  product: { width: 800, height: 1000 },
  cover: { width: 1200, height: 560 },
  store: { width: 240, height: 240 },
  avatar: { width: 96, height: 96 },
  live: { width: 720, height: 1280 },
  upload: { width: 800, height: 1000 },
};

/** FNV-1a: small, stable across runs, and good enough to spread hues. */
function hash(seed: string): number {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

function initialsFrom(seed: string): string {
  return seed
    .split('-')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function svgFor(kind: Kind, seed: string): string {
  const { width, height } = SIZES[kind];
  const seedHash = hash(seed);

  // Two neighbouring hues keep every image duotone rather than rainbow, which
  // is what stops a generated catalogue from looking like a test fixture.
  const hue = seedHash % 360;
  const hue2 = (hue + 26 + (seedHash % 20)) % 360;
  const saturation = 32 + (seedHash % 18);
  const light = 62 + (seedHash % 10);

  const from = `hsl(${hue} ${saturation}% ${light}%)`;
  const to = `hsl(${hue2} ${saturation + 8}% ${light - 22}%)`;
  const accent = `hsl(${(hue + 180) % 360} 55% 92%)`;

  const gradient = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/>
        <stop offset="100%" stop-color="${to}"/>
      </linearGradient>
      <radialGradient id="glow" cx="30%" cy="24%" r="70%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.42)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>`;

  if (kind === 'avatar' || kind === 'store') {
    const initials = initialsFrom(seed) || '·';
    const fontSize = Math.round(width * 0.36);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  ${gradient}
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="ui-sans-serif, system-ui, sans-serif" font-size="${fontSize}" font-weight="700"
        fill="rgba(255,255,255,0.92)">${initials}</text>
</svg>`;
  }

  // A few overlapping shapes, positioned from the hash, so each product reads
  // as its own image instead of the same swatch repeated.
  const cx = width * (0.28 + ((seedHash >> 3) % 40) / 100);
  const cy = height * (0.34 + ((seedHash >> 7) % 30) / 100);
  const radius = Math.min(width, height) * (0.18 + ((seedHash >> 11) % 14) / 100);
  const rotate = seedHash % 45;
  const barWidth = width * 0.5;
  const barHeight = height * 0.06;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  ${gradient}
  <g opacity="0.5">
    <circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${radius.toFixed(0)}" fill="${accent}" opacity="0.35"/>
    <rect x="${(width * 0.12).toFixed(0)}" y="${(height * 0.68).toFixed(0)}"
          width="${barWidth.toFixed(0)}" height="${barHeight.toFixed(0)}" rx="${(barHeight / 2).toFixed(0)}"
          fill="rgba(255,255,255,0.30)" transform="rotate(${rotate} ${(width / 2).toFixed(0)} ${(height / 2).toFixed(0)})"/>
    <circle cx="${(width * 0.78).toFixed(0)}" cy="${(height * 0.8).toFixed(0)}"
            r="${(radius * 0.55).toFixed(0)}" fill="rgba(0,0,0,0.10)"/>
  </g>
</svg>`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string; seed: string }> },
): Promise<NextResponse> {
  const { kind, seed } = await context.params;
  const safeKind: Kind = (Object.keys(SIZES) as Kind[]).includes(kind as Kind)
    ? (kind as Kind)
    : 'product';

  const body = svgFor(safeKind, decodeURIComponent(seed).slice(0, 80));

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Deterministic output keyed by the URL, so it can be cached forever.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
