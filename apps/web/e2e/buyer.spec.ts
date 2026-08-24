import { expect, test } from '@playwright/test';
import { DEMO, expectNoHorizontalScroll, failOnConsoleErrors, signIn } from './support';

/**
 * The buyer journey the product exists for:
 *
 *   home → live → featured product → variant → checkout → provider → order
 *
 * It is one test on purpose. Splitting it would let a broken middle step pass
 * because a later test seeded its own state; here every step depends on the
 * one before it, exactly as a person experiences it.
 */
test('a buyer discovers a live, buys from it and finds the order', async ({ page }) => {
  const errors = failOnConsoleErrors(page);

  await signIn(page, DEMO.buyer, '/');

  // --- Discovery -----------------------------------------------------------
  await expect(page.getByRole('heading', { name: 'Vivo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'En vivo ahora' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // --- Enter the live -------------------------------------------------------
  await page.getByRole('link', { name: /Plaza Moda/ }).first().click();
  await page.waitForURL(/\/live\//);

  await expect(page.getByText('En vivo').first()).toBeVisible();
  await expect(page.getByLabel(/personas mirando/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Comentarios en vivo' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // --- Reactions and the product sheet ---------------------------------------
  await page.getByRole('button', { name: 'Enviar un corazón' }).click();

  await page.getByRole('button', { name: /Comprar/ }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/cuotas de/)).toBeVisible();

  // --- Pick a variant ---------------------------------------------------------
  const variant = sheet.getByRole('button', { name: 'Negro · M' });
  if (await variant.isVisible()) await variant.click();

  await sheet.getByRole('button', { name: 'Comprar ahora' }).click();
  await page.waitForURL(/\/checkout/);

  await expect(page.getByRole('heading', { name: 'Finalizar compra' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // --- Delivery without an address, to keep the form short ----------------------
  await page.getByText('Retiro en la tienda').click();
  const pay = page.getByRole('button', { name: /^Pagar/ });
  await expect(pay).toBeVisible();

  await page.getByLabel('Teléfono').fill('099 123 456');
  await pay.click();

  // --- Fuera de la app, con el proveedor -------------------------------------------
  // Pagar sale de VivoShop. En desarrollo el proveedor simulado devuelve al
  // pedido con una pantalla que pregunta el desenlace; con Mercado Pago sería
  // su checkout. En los dos casos, quien marca el pedido como pago es el
  // webhook, no esta pantalla.
  await page.waitForURL(/\/compras\//, { timeout: 20_000 });
  await expect(page.getByText('Pago de prueba')).toBeVisible();
  await expect(page.getByText('¡Compra confirmada!')).toHaveCount(0);

  await page.getByRole('button', { name: 'Pagar', exact: true }).click();

  // --- Confirmation ---------------------------------------------------------------
  await expect(page.getByText('¡Compra confirmada!')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Pedido VV-/ })).toBeVisible();
  await expect(page.getByText('Pagado').first()).toBeVisible();

  // --- And it is listed under "Mis compras" ------------------------------------------
  await page.goto('/compras');
  await expect(page.getByRole('heading', { name: 'Mis compras' })).toBeVisible();
  await expect(page.getByText('En curso')).toBeVisible();

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

/**
 * El camino con envío a domicilio, que es el que viene por defecto.
 *
 * La prueba de arriba elige retiro en tienda para acortar el formulario, y ese
 * atajo escondió un fallo real: con envío a domicilio la dirección es
 * obligatoria, sus campos quedan debajo del pliegue, y el navegador bloqueaba
 * el envío sin que se viera nada. Desde el teléfono parecía que el botón no
 * funcionaba — y después del primer toque dejaba de funcionar de verdad.
 */
test('con envío a domicilio, el formulario avisa qué falta en vez de no hacer nada', async ({
  page,
}) => {
  await signIn(page, DEMO.buyer, '/');

  // Directo a la ficha del producto: es el camino más corto y no depende de
  // qué esté transmitiendo en ese momento.
  await page.goto('/producto/campera-roma');
  await page.getByRole('button', { name: 'Comprar ahora' }).click();
  await page.waitForURL(/\/checkout/);
  await expect(page.getByRole('heading', { name: 'Finalizar compra' })).toBeVisible();

  // Envío a domicilio: la dirección pasa a ser obligatoria.
  await page.getByText('Envío a domicilio').click();
  const pay = page.getByRole('button', { name: /^Pagar/ });

  // Primer intento con la dirección vacía: no compra, y el botón NO queda
  // muerto — que era el segundo defecto.
  await pay.click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(pay).toBeEnabled();

  // Completar y volver a intentar tiene que funcionar con el mismo botón.
  await page.getByLabel('Nombre y apellido').fill('Ana Pérez');
  await page.getByLabel('Teléfono').fill('099 123 456');
  await page.getByLabel('Localidad').fill('Pocitos');
  await page.getByLabel('Dirección').fill('Av. Brasil 2500 apto 301');

  await pay.click();
  await page.waitForURL(/\/compras\//, { timeout: 25_000 });
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Compra confirmada!')).toBeVisible({ timeout: 20_000 });
});

/**
 * Un pago rechazado cancela el pedido y lo explica sin tecnicismos.
 *
 * Es el caso que M03 hace posible por primera vez: antes el pago simulado
 * siempre salía bien, así que el camino de "no se pudo cobrar" nunca se
 * ejercitaba desde el navegador. Que el stock vuelva a la góndola lo prueban
 * los tests de contrato, contra los dos drivers.
 */
test('un pago rechazado cancela el pedido y lo explica', async ({ page }) => {
  await signIn(page, DEMO.buyer, '/');

  await page.goto('/producto/campera-roma');
  await page.getByRole('button', { name: 'Comprar ahora' }).click();
  await page.waitForURL(/\/checkout/);
  await page.getByText('Retiro en la tienda').click();
  await page.getByLabel('Teléfono').fill('099 123 456');
  await page.getByRole('button', { name: /^Pagar/ }).click();

  await page.waitForURL(/\/compras\//, { timeout: 25_000 });
  await page.getByRole('button', { name: 'Rechazar el pago' }).click();

  // Nada de "PAYMENT_REJECTED" ni de códigos del proveedor.
  await expect(page.getByText('No se pudo completar el pago')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('¡Compra confirmada!')).toHaveCount(0);
  // Ni el código del proveedor ni el nuestro llegan a la pantalla.
  await expect(page.getByText(/PAYMENT_|simulated_rejection/)).toHaveCount(0);
});

test('buying while signed out asks to sign in and keeps the intent', async ({ page }) => {
  await page.goto('/producto/campera-roma');

  await page.getByRole('button', { name: 'Comprar ahora' }).click();
  await page.waitForURL(/\/ingresar/);

  // The checkout the buyer wanted survives the detour, encoded in `next`.
  const next = new URL(page.url()).searchParams.get('next') ?? '';
  expect(next).toContain('/checkout');
  expect(next).toContain('producto=campera-roma');
});

test('signed-out browsing works and never dead-ends', async ({ page }) => {
  await page.goto('/explorar');
  await expect(page.getByRole('heading', { name: 'Explorar' })).toBeVisible();

  await page.getByLabel('Buscar tiendas y productos').fill('campera');
  await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();

  await page.goto('/en-vivo');
  await expect(page.getByRole('heading', { name: 'En vivo', exact: true })).toBeVisible();

  // Protected screens redirect instead of erroring.
  await page.goto('/compras');
  await page.waitForURL(/\/ingresar/);
  await expect(page.getByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeVisible();
});

test('a store page shows its catalogue and follow state', async ({ page }) => {
  await signIn(page, DEMO.buyer, '/tienda/rambla-beauty');

  await expect(page.getByRole('heading', { name: 'Rambla Beauty' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Productos/ })).toBeVisible();

  const follow = page.getByRole('button', { name: /Seguir|Siguiendo/ }).first();
  await expect(follow).toBeVisible();
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', /true|false/);
});

test('an unknown route shows a real 404, not a crash', async ({ page }) => {
  const response = await page.goto('/no-existe-esta-ruta');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
});
