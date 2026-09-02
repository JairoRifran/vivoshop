/**
 * Genera los íconos de la aplicación a partir de la marca.
 *
 * La marca vive en `apps/web/src/components/brand.tsx` como componente React.
 * Acá se repiten sus trazos porque un PNG no puede importar JSX, y ese es el
 * único motivo: si la marca cambia, se cambian los dos.
 *
 * Uso:  node scripts/generar-iconos.mjs
 */
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * `sharp` no es dependencia declarada de la raíz: llega arrastrada por Next.
 * Se busca primero por el nombre y, si no aparece, dentro del almacén de pnpm.
 * Es una herramienta que se corre a mano cuando cambia la marca, no parte del
 * build, así que no justifica sumarla al `package.json`.
 */
function cargarSharp() {
  try {
    return require('sharp');
  } catch {
    const almacen = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/.pnpm');
    const carpeta = readdirSync(almacen).find((n) => n.startsWith('sharp@'));
    if (!carpeta) {
      throw new Error('No encontré sharp. Corré `pnpm install` primero.');
    }
    return require(join(almacen, carpeta, 'node_modules/sharp'));
  }
}

const sharp = cargarSharp();

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'apps/web/public/icons');

const INK = '#14141a';
const BLANCO = '#ffffff';
const VIVO = '#ff2d55';

/** Los trazos de la marca, en la grilla de 32×32 en la que fue dibujada. */
const TRAZOS = (fg, sig) => `
  <path d="M7.2 14a8.8 8.8 0 0 1 17.6 0" stroke="${sig}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M11.8 14a4.2 4.2 0 0 1 8.4 0" stroke="${fg}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M4.4 14H27.6L26.3 24.6C26.05 26.45 24.4 27.8 22.5 27.8H9.5C7.6 27.8 5.95 26.45 5.7 24.6Z" fill="${fg}"/>
`;

/**
 * @param size   lado del PNG
 * @param parte  fracción del lado que ocupa la marca. Para el enmascarable baja
 *               a 0,52: Android recorta el ícono con una forma que no elegimos
 *               nosotros, y solo el 80 % central está garantizado.
 * @param radio  radio de las esquinas. El enmascarable va en 0: la máscara del
 *               sistema pone la forma, y redondear antes deja un halo.
 */
function svg({ size, fondo, fg, sig, parte, radio }) {
  const k = (size * parte) / 32;
  const t = (size - 32 * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radio}" fill="${fondo}"/>
  <g transform="translate(${t} ${t}) scale(${k})">${TRAZOS(fg, sig)}</g>
</svg>`;
}

const png = async (nombre, contenido) => {
  await writeFile(join(destino, nombre), await sharp(Buffer.from(contenido)).png().toBuffer());
  console.log('  ✓', nombre);
};

await mkdir(destino, { recursive: true });

const comun = { fondo: INK, fg: BLANCO, sig: VIVO };

console.log('Íconos:');
await png('icon-192.png', svg({ ...comun, size: 192, parte: 0.62, radio: 42 }));
await png('icon-512.png', svg({ ...comun, size: 512, parte: 0.62, radio: 112 }));
await png('apple-touch-icon.png', svg({ ...comun, size: 180, parte: 0.62, radio: 0 }));
await png('icon-maskable-512.png', svg({ ...comun, size: 512, parte: 0.52, radio: 0 }));

// Favicon de escritorio, en SVG: una pestaña es chica y clara, y un cuadrado
// oscuro ahí pesa de más. Va a `public/` y no a `app/icon.svg` a propósito: la
// convención de archivo de Next y el `metadata.icons` explícito del layout se
// pisan entre sí, y una de las dos gana sin avisar. Se declaran todos juntos.
await writeFile(
  join(destino, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${TRAZOS('#2f6b4f', VIVO)}</svg>\n`,
);
console.log('  ✓ icon.svg (favicon)');
