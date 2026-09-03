import { expect, test } from './fixtures';
import { DEMO, signIn } from './support';

/**
 * Borrar la cuenta, en un navegador de verdad.
 *
 * Lo que agrega sobre las pruebas de integración es el recorrido: que se llegue
 * desde el perfil, que la pantalla explique antes de dejar borrar, y que la
 * sesión efectivamente muera del lado del navegador —cookie incluida—, que es
 * donde vive y donde la API no llega.
 *
 * El mundo sembrado le deja pedidos abiertos a las cuentas de demostración, así
 * que **este recorrido termina en el bloqueo**, no en el borrado. Es el camino
 * más valioso para probar acá igual: es el que una persona real se encuentra
 * primero, y el que fallaría en silencio si la pantalla no consultara antes.
 */

test('el perfil lleva a borrar la cuenta', async ({ page }) => {
  await signIn(page, DEMO.buyer, '/perfil');

  await page.getByRole('link', { name: 'Eliminar cuenta' }).click();
  await page.waitForURL('**/perfil/eliminar');

  await expect(page.getByRole('heading', { name: 'Borrar la cuenta' })).toBeVisible();
});

test('la pantalla dice qué se borra y qué queda antes de dejar borrar', async ({ page }) => {
  await signIn(page, DEMO.buyer, '/perfil/eliminar');

  // Las dos cosas, y en ese orden: prometer un borrado total y que después
  // aparezcan los pedidos intactos es peor que decirlo de entrada.
  await expect(page.getByRole('heading', { name: 'Qué se borra' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Qué queda' })).toBeVisible();
  await expect(page.getByText(/pedidos y pagos/)).toBeVisible();
});

test('con pedidos abiertos explica por qué no se puede, en vez de dejar intentar', async ({
  page,
}) => {
  await signIn(page, DEMO.buyer, '/perfil/eliminar');

  await expect(page.getByRole('heading', { name: 'Todavía no se puede' })).toBeVisible();

  // Y no dibuja el formulario: hacerle escribir el correo para después fallar
  // sería hacerle perder el tiempo a alguien que ya decidió algo difícil.
  await expect(page.getByRole('button', { name: 'Borrar mi cuenta' })).toHaveCount(0);
});

test('la página pública de eliminación se abre sin cuenta', async ({ page }) => {
  // Google Play exige que esta URL sea alcanzable sin instalar la app ni
  // iniciar sesión. Si algún día queda detrás del guard, esto lo detecta.
  await page.goto('/eliminar-cuenta');
  await expect(page.getByRole('heading', { name: 'Eliminar tu cuenta' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Perfil → Eliminar cuenta/ })).toBeVisible();
});
