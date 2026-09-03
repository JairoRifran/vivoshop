/**
 * Genera los assets gráficos que pide la ficha de Google Play.
 *
 * Son distintos de los íconos de la PWA (`generar-iconos.mjs`) y conviene no
 * confundirlos:
 *
 * - El **ícono de la tienda** va a **sangre**, sin esquinas redondeadas. Play
 *   aplica su propia máscara; si le mandamos uno ya redondeado, el resultado es
 *   una esquina redondeada dentro de otra. El de la PWA sí va redondeado porque
 *   ahí nadie enmascara nada.
 * - El **gráfico destacado** (1024×500) solo existe en Play. Encabeza la ficha
 *   y aparece recortado en varias superficies, así que el contenido va lejos
 *   de los bordes.
 *
 * Uso:  node scripts/generar-assets-play.mjs
 */
import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function cargarSharp() {
  try {
    return require('sharp');
  } catch {
    const almacen = join(raiz, 'node_modules/.pnpm');
    const carpeta = readdirSync(almacen).find((n) => n.startsWith('sharp@'));
    if (!carpeta) throw new Error('No encontré sharp. Corré `pnpm install` primero.');
    return require(join(almacen, carpeta, 'node_modules/sharp'));
  }
}

const sharp = cargarSharp();
const destino = join(raiz, 'assets/play');

const INK = '#14141a';
const BLANCO = '#ffffff';
const VIVO = '#ff2d55';
const GRIS = '#b9b9c2';

/** Los mismos trazos que `brand.tsx`, en la grilla de 32×32 en que se dibujó. */
const MARCA = (fg, sig) => `
  <path d="M7.2 14a8.8 8.8 0 0 1 17.6 0" stroke="${sig}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M11.8 14a4.2 4.2 0 0 1 8.4 0" stroke="${fg}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M4.4 14H27.6L26.3 24.6C26.05 26.45 24.4 27.8 22.5 27.8H9.5C7.6 27.8 5.95 26.45 5.7 24.6Z" fill="${fg}"/>
`;

/** Coloca la marca dentro de un lienzo, escalada y centrada en (cx, cy). */
const marcaEn = (lado, cx, cy) => {
  const k = lado / 32;
  return `<g transform="translate(${cx - lado / 2} ${cy - lado / 2}) scale(${k})">${MARCA(BLANCO, VIVO)}</g>`;
};

const png = async (nombre, svg) => {
  await writeFile(
    join(destino, nombre),
    await sharp(Buffer.from(svg)).png().toBuffer(),
  );
  console.log('  ✓', nombre);
};

await mkdir(destino, { recursive: true });
console.log('Assets de Google Play → assets/play/');

// --- Ícono de la ficha: 512×512, a sangre --------------------------------
await png(
  'icono-tienda-512.png',
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
     <rect width="512" height="512" fill="${INK}"/>
     ${marcaEn(512 * 0.6, 256, 256)}
   </svg>`,
);

// --- Gráfico destacado: 1024×500 -----------------------------------------
//
// Sin transparencia: Play la rechaza. El contenido queda dentro del 80 %
// central porque en varias superficies este gráfico aparece recortado.
await png(
  'grafico-destacado-1024x500.png',
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
     <rect width="1024" height="500" fill="${INK}"/>
     ${marcaEn(150, 310, 258)}
     <text x="420" y="246" font-family="Arial, Helvetica, sans-serif" font-size="76" font-weight="bold" fill="${BLANCO}" letter-spacing="-2">VivoShop</text>
     <text x="423" y="300" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="${GRIS}">Comprá y vendé en el vivo</text>
     <circle cx="433" cy="344" r="7" fill="${VIVO}"/>
     <text x="450" y="353" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="${VIVO}" letter-spacing="3">EN VIVO</text>
   </svg>`,
);
