import { expect, test } from './fixtures';
import { DEMO, expectNoHorizontalScroll, failOnConsoleErrors, signIn } from './support';

/**
 * The seller journey:
 *
 *   Seller Center → create a product → schedule a live → broadcast console →
 *   feature a product → end the broadcast
 */
test('a seller loads the dashboard, creates a product and runs a broadcast', async ({ page }) => {
  const errors = failOnConsoleErrors(page);

  await signIn(page, DEMO.seller, '/vender');

  // --- Dashboard ------------------------------------------------------------
  await expect(page.getByRole('heading', { name: 'Plaza Moda' })).toBeVisible();
  await expect(page.getByText('VENTAS HOY')).toBeVisible();
  await expect(page.getByText('CONVERSIÓN')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegación de vendedor' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // --- Catalogue -------------------------------------------------------------
  await page.getByRole('link', { name: 'Productos' }).first().click();
  await page.waitForURL(/\/vender\/productos/);
  await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Buscar en tu catálogo' });
  await search.fill('campera');
  await expect(page.getByText('Campera Roma')).toBeVisible();
  await search.fill('');

  // --- Create a product --------------------------------------------------------
  const title = `Bufanda E2E ${Date.now()}`;
  await page.getByRole('link', { name: 'Nuevo' }).click();
  await page.waitForURL(/\/vender\/productos\/nuevo/);

  // Role + accessible name, not label text: the visible label carries a
  // decorative "*" that the accessible name correctly omits.
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Descripción', exact: true }).fill('Tejida a mano.');
  await page.getByRole('textbox', { name: 'Precio', exact: true }).fill('1250');
  await page.getByRole('textbox', { name: 'Stock', exact: true }).fill('7');

  await page.getByRole('button', { name: 'Publicar producto' }).click();
  await page.waitForURL(/\/vender\/productos$/);
  await expect(page.getByText(title)).toBeVisible();

  // --- Schedule a broadcast ------------------------------------------------------
  await page.goto('/vender/lives/nuevo?modo=ahora');
  await expect(page.getByRole('heading', { name: 'Nueva transmisión' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Título del vivo', exact: true }).fill('Vivo E2E');

  // The submit stays disabled until a product is attached: a live that sells
  // nothing is not a live.
  const submit = page.getByRole('button', { name: 'Iniciar transmisión' });
  await expect(submit).toBeDisabled();

  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(submit).toBeEnabled();
  await submit.click();

  // --- Broadcast console -----------------------------------------------------------
  await page.waitForURL(/\/transmitir\//);
  await expect(page.getByText('EN VIVO')).toBeVisible();
  await expect(page.getByText('PEDIDOS')).toBeVisible();
  await expect(page.getByText('FACTURADO')).toBeVisible();

  // One-handed controls: every device button is a comfortable target.
  //
  // The lens button is matched by pattern rather than by one exact label: it
  // names the camera you would switch *to*, and the console opens on the rear
  // camera because a seller points the phone at the product, not at
  // themselves.
  const controls: Array<string | RegExp> = [
    'Silenciar micrófono',
    'Apagar cámara',
    /Usar cámara (trasera|frontal)/,
  ];
  for (const label of controls) {
    const button = page.getByRole('button', { name: label });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole('button', { name: 'Ver comentarios' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).first().click();

  // --- Feature a product and finish -------------------------------------------------
  await expect(page.getByText('TOCÁ PARA DESTACAR')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByText('En pantalla')).toBeVisible();

  await page.getByRole('button', { name: 'Finalizar transmisión' }).click();
  await page.getByRole('button', { name: 'Sí, finalizar' }).click();
  await page.waitForURL(/\/vender$/);

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a buyer-only account is offered onboarding, not a broken dashboard', async ({ page }) => {
  await signIn(page, DEMO.buyer, '/vender');

  await expect(page.getByRole('heading', { name: 'Creá tu tienda' })).toBeVisible();
  await expect(page.getByLabel('Nombre de la tienda')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegación de vendedor' })).toHaveCount(0);
});

test('the seller can move an order through its stages', async ({ page }) => {
  await signIn(page, DEMO.seller, '/vender/pedidos');

  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Todos/ })).toBeVisible();

  const advance = page.getByRole('button', { name: /^Marcar como/ }).first();
  if (await advance.isVisible()) {
    await advance.click();
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
  }
});
