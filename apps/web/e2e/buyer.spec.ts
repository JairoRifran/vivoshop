import { expect, test } from '@playwright/test';
import { DEMO, expectNoHorizontalScroll, failOnConsoleErrors, signIn } from './support';

/**
 * The buyer journey the product exists for:
 *
 *   home → live → featured product → variant → checkout → payment → order
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

  // --- Confirmation ---------------------------------------------------------------
  await page.waitForURL(/\/compras\//, { timeout: 20_000 });
  await expect(page.getByText('¡Compra confirmada!')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Pedido VV-/ })).toBeVisible();
  await expect(page.getByText('Pagado').first()).toBeVisible();

  // --- And it is listed under "Mis compras" ------------------------------------------
  await page.goto('/compras');
  await expect(page.getByRole('heading', { name: 'Mis compras' })).toBeVisible();
  await expect(page.getByText('En curso')).toBeVisible();

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
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
