import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO, failOnConsoleErrors, signIn } from './support';

/**
 * M04 end-to-end: tres personas, una puja.
 *
 * ```
 * Vendedora  abre el vivo, activa Modo Puja
 * Ana        oferta $1.000
 * Diego      oferta $1.100
 * Vendedora  ve $1.100 sin recargar, y acepta
 * Diego      ve "tu oferta fue aceptada" y paga
 * Ana        ve que la puja terminó
 * Vendedora  ve "venta confirmada"
 * ```
 *
 * Tres contextos de navegador distintos, con sus propias cookies: es la única
 * forma de probar que lo que ve cada persona es lo que le corresponde. Y sin
 * esperas arbitrarias — todo se afirma con `expect`, que reintenta hasta que
 * la aserción se cumple o vence el plazo.
 */

const OTHER_BUYER = { email: 'diego@vivo.uy', password: 'vivo1234' };

/** Un dispositivo más, con su propia sesión. */
async function asUser(
  browser: Browser,
  credentials: { email: string; password: string },
  destination: string,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, credentials, destination);
  return page;
}

/** Deja a la vendedora al aire y devuelve el id de la transmisión. */
async function startBroadcast(page: Page, title: string): Promise<string> {
  await signIn(page, DEMO.seller, '/vender');
  await page.goto('/vender/lives/nuevo?modo=ahora');
  await expect(page.getByRole('heading', { name: 'Nueva transmisión' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Título del vivo', exact: true }).fill(title);
  await page.getByRole('button', { name: /Campera Roma/ }).click();
  await page.getByRole('button', { name: 'Iniciar transmisión' }).click();

  await page.waitForURL(/\/transmitir\//);
  return new URL(page.url()).pathname.split('/').pop() as string;
}

/** Oferta desde el panel del vivo. */
async function bid(page: Page, amount: string): Promise<void> {
  await page.getByRole('button', { name: 'Hacer una oferta' }).click();
  const field = page.getByLabel('Monto de tu oferta');
  await expect(field).toBeVisible();
  await field.fill(amount);
  await page.getByRole('button', { name: 'Enviar oferta' }).click();
}

/**
 * Tres personas, tres navegadores, un pago. Es largo de verdad.
 *
 * El plazo por defecto alcanza para un recorrido de una persona; este tiene
 * tres inicios de sesion, una camara que arranca, cuatro ofertas y un cobro.
 * Subirlo es reconocer lo que el caso es, no tapar lentitud: cada paso sigue
 * afirmandose con `expect`, que reintenta y falla si algo no ocurre.
 */
test.describe.configure({ timeout: 180_000 });

test('una puja de punta a punta: ofertar, aceptar, pagar', async ({ page, browser }) => {
  const errors = failOnConsoleErrors(page);

  // --- La vendedora abre la puja ------------------------------------------
  const liveId = await startBroadcast(page, 'Puja E2E');

  await page.getByRole('button', { name: /Activar Modo Puja/ }).click();
  await expect(page.getByRole('heading', { name: 'Abrir una puja' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir la puja' }).click();

  await expect(page.getByText('Puja activa')).toBeVisible();

  // --- Ana oferta $1.000 ----------------------------------------------------
  const ana = await asUser(browser, DEMO.buyer, `/live/${liveId}`);
  await expect(ana.getByText('Modo puja')).toBeVisible();
  await bid(ana, '1000');
  await expect(ana.getByText(/Vas ganando con/)).toBeVisible();

  // --- Diego lo supera ------------------------------------------------------
  const diego = await asUser(browser, OTHER_BUYER, `/live/${liveId}`);
  await expect(diego.getByText('Modo puja')).toBeVisible();
  await bid(diego, '1100');
  await expect(diego.getByText(/Vas ganando con/)).toBeVisible();

  // Ana se entera sin recargar. Se afirma primero el hecho positivo —ve la
  // oferta nueva— porque una ausencia se cumple sola mientras el evento viaja
  // y no probaria nada; recien despues, que dejo de liderar.
  await expect(ana.getByText('$ 1.100,00').first()).toBeVisible({ timeout: 20_000 });
  await expect(ana.getByText(/Vas ganando con/)).toHaveCount(0);

  // --- La vendedora ve la mejor oferta en vivo -------------------------------
  // Sin recargar la consola: llegó por `bid.leading_changed`.
  await expect(page.getByText('$ 1.100,00').first()).toBeVisible({ timeout: 25_000 });

  // --- Acepta, con confirmación --------------------------------------------
  await page.getByRole('button', { name: /Aceptar \$ 1\.100,00/ }).click();
  // Un tap accidental no vende: hay que confirmar.
  await expect(page.getByRole('heading', { name: 'Confirmá la venta' })).toBeVisible();
  await page.getByRole('button', { name: 'Sí, aceptar la oferta' }).click();

  await expect(page.getByText('Reservado')).toBeVisible({ timeout: 25_000 });

  // --- Diego gana y paga ----------------------------------------------------
  await expect(diego.getByText('¡Tu oferta fue aceptada!')).toBeVisible({ timeout: 25_000 });
  await expect(diego.getByText(/Tenés \d+:\d\d para completar el pago/)).toBeVisible();

  await diego.getByRole('link', { name: 'Pagar ahora' }).click();
  await diego.waitForURL(/\/checkout/);

  // El checkout muestra el precio aceptado, no el de catálogo.
  await expect(diego.getByText('$ 1.100,00').first()).toBeVisible();

  await diego.getByText('Retiro en la tienda').click();
  await diego.getByLabel('Teléfono').fill('099 123 456');
  await diego.getByRole('button', { name: /^Pagar/ }).click();

  await diego.waitForURL(/\/compras\//, { timeout: 25_000 });
  await diego.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(diego.getByText('¡Compra confirmada!')).toBeVisible({ timeout: 25_000 });

  // --- Ana ve que terminó ----------------------------------------------------
  await expect(ana.getByText(/Vendido|Puja finalizada/)).toBeVisible({ timeout: 20_000 });

  // --- Y el pedido quedó con el precio de la oferta --------------------------
  await expect(diego.getByText('$ 1.100,00').first()).toBeVisible();

  await ana.close();
  await diego.close();
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('el vendedor puede cerrar una puja sin aceptar nada', async ({ page, browser }) => {
  test.slow();
  const liveId = await startBroadcast(page, 'Puja sin venta E2E');

  await page.getByRole('button', { name: /Activar Modo Puja/ }).click();
  await page.getByRole('button', { name: 'Abrir la puja' }).click();
  await expect(page.getByText('Puja activa')).toBeVisible();

  const ana = await asUser(browser, DEMO.buyer, `/live/${liveId}`);
  await bid(ana, '500');
  await expect(ana.getByText(/Vas ganando con/)).toBeVisible();

  // Cerrar tampoco es un tap suelto: se confirma.
  await page.getByRole('button', { name: 'Cerrar puja' }).click();
  await expect(page.getByText('¿Cerrar la puja sin vender?')).toBeVisible();
  await page.getByRole('button', { name: 'Sí, cerrar' }).click();

  // La oferta de Ana queda sin efecto, y se lo dice.
  await expect(ana.getByText('Puja finalizada')).toBeVisible({ timeout: 25_000 });

  await ana.close();
});
