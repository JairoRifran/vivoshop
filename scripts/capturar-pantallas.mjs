/**
 * Saca las capturas de pantalla para la ficha de Google Play.
 *
 * Usa el Chromium que ya instaló Playwright para las pruebas de punta a punta,
 * así que no hace falta instalar nada nuevo.
 *
 * ## Por qué un script y no capturas a mano
 *
 * Play pide un mínimo de 320 px de lado, pero una captura tomada del navegador
 * de escritorio sale a 1× y se ve blanda en una pantalla moderna. Acá el
 * viewport son 390×844 **puntos** —un teléfono real— con
 * `deviceScaleFactor: 3`, así que el PNG sale de 1170×2532 píxeles: nítido, y
 * con el mismo diseño que ve alguien desde el celular.
 *
 * Ese detalle importa: si se abriera el sitio en una ventana de 1170 px de
 * ancho, el CSS respondería con el diseño de tablet. Lo que se quiere es el
 * diseño de teléfono, renderizado en alta densidad.
 *
 * Uso:  node scripts/capturar-pantallas.mjs [url-base]
 *       node scripts/capturar-pantallas.mjs https://vivoshop.live
 */
import { readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * `playwright-core` no cuelga de la raíz: pnpm lo deja en su almacén, así que
 * se lo busca ahí igual que a `sharp` en los otros scripts.
 */
function cargarChromium() {
  try {
    return require('playwright-core').chromium;
  } catch {
    const almacen = join(raiz, 'node_modules/.pnpm');
    const carpeta = readdirSync(almacen).find((n) => n.startsWith('playwright-core@'));
    if (!carpeta) throw new Error('No encontré playwright-core. Corré `pnpm install`.');
    return require(join(almacen, carpeta, 'node_modules/playwright-core')).chromium;
  }
}

const chromium = cargarChromium();

const BASE = process.argv[2] ?? 'https://vivoshop.live';
const destino = join(raiz, 'assets/play/capturas');

/** Las pantallas que cuentan la historia del producto, en ese orden. */
const PANTALLAS = [
  { archivo: '1-inicio.png', ruta: '/', espera: 'Ventas en vivo' },
  { archivo: '2-explorar.png', ruta: '/explorar', espera: 'Explorar' },
  { archivo: '3-tienda.png', ruta: '/tienda/jairo-store', espera: 'Productos' },
  { archivo: '4-ingresar.png', ruta: '/ingresar', espera: 'Ingresá a tu cuenta' },
];

await mkdir(destino, { recursive: true });

const navegador = await chromium.launch();
const contexto = await navegador.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'es-UY',
});
const pagina = await contexto.newPage();

console.log(`Capturas desde ${BASE} → assets/play/capturas/`);

for (const { archivo, ruta, espera } of PANTALLAS) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
  try {
    await pagina.getByText(espera, { exact: false }).first().waitFor({ timeout: 10_000 });
  } catch {
    // Que no aparezca el texto esperado no justifica abortar toda la tanda: se
    // avisa y se saca igual, para poder mirar qué salió.
    console.warn(`  ! "${espera}" no apareció en ${ruta}; capturo igual`);
  }
  await pagina.screenshot({ path: join(destino, archivo) });
  console.log('  ✓', archivo);
}

await navegador.close();
