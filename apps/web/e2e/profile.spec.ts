import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DEMO, signIn } from './support';

/**
 * Perfil e identidad de tienda, de punta a punta.
 *
 * ## Qué prueba y qué no
 *
 * **No** prueba Supabase. La corrida usa el driver local —bytes en memoria— y
 * lo que se verifica es el recorrido completo del navegador: elegir un archivo,
 * achicarlo y recortarlo en el canvas, pedir la firma por acción de servidor,
 * escribir los bytes contra la URL firmada, y guardar la **clave** en el perfil.
 * Lo único que cambia con Supabase es a qué host apunta esa URL.
 *
 * La condición que cierra M06 es la última afirmación de cada prueba: después
 * de recargar, la imagen que se muestra es una URL de nuestro almacenamiento y
 * responde con bytes de verdad. Sin eso, "se subió" sería una promesa del
 * cliente.
 */

/**
 * Un PNG de 8x8 rojo, válido de verdad.
 *
 * Tiene que decodificar: `ImageField` lo pasa por `createImageBitmap`, así que
 * unos bytes inventados harían fallar la prueba antes de tocar nada nuestro.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mM4oaGB' +
    'FTEMLQkAgl1GARdiiXUAAAAASUVORK5CYII=',
  'base64',
);

/** Espera a que el campo termine: la clave viaja en un input oculto. */
async function pickImage(page: Page, label: string): Promise<void> {
  const field = page.getByText(label, { exact: true }).locator('..');
  await field.locator('input[type="file"]').setInputFiles({
    name: 'foto.png',
    mimeType: 'image/png',
    buffer: PNG,
  });

  // La subida terminó cuando el campo oculto tiene una clave nuestra. Afirmar
  // sobre la vista previa no serviría: aparece con un `blob:` local que existiría
  // igual si la subida hubiera fallado.
  await expect
    .poll(async () => field.locator('input[type="hidden"]').inputValue(), { timeout: 20_000 })
    .toMatch(/^[a-z_]+\/[A-Za-z0-9_-]+\//);
}

test('una compradora se pone foto de perfil y una línea sobre ella', async ({ page, request }) => {
  await signIn(page, DEMO.buyer, '/perfil/editar');
  await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible();

  await pickImage(page, 'Foto de perfil');
  await page.getByLabel('Sobre vos').fill('Compro ropa y pregunto todo.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('status')).toHaveText(/Guardamos tu perfil/);

  // Y sobrevive a la recarga, que es la diferencia entre guardar y parecer que
  // guardó.
  await page.goto('/perfil');
  await expect(page.getByText('Compro ropa y pregunto todo.')).toBeVisible();

  const avatar = page.locator('header img').first();
  await expect(avatar).toBeVisible();
  const src = await avatar.getAttribute('src');
  expect(src).toContain('/media/dev/file/avatar/');

  // La imagen existe de verdad: se pide y responde con bytes de imagen.
  const stored = await request.get(src as string);
  expect(stored.status()).toBe(200);
  expect(stored.headers()['content-type']).toContain('image');
});

test('una vendedora le pone logo y portada a su tienda', async ({ page, request }) => {
  await signIn(page, DEMO.seller, '/vender/mas');
  await expect(page.getByRole('heading', { name: 'Datos de la tienda' })).toBeVisible();

  await pickImage(page, 'Logo');
  await pickImage(page, 'Portada');
  await page.getByLabel('WhatsApp').fill('+598 99 123 456');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('status')).toHaveText(/Guardamos los cambios/);

  // La tienda pública es donde esto tiene sentido: es lo que ve quien compra.
  await page.goto('/tienda/plaza-moda');
  const cover = page.locator('header img').first();
  await expect(cover).toBeVisible();
  expect(await cover.getAttribute('src')).toContain('/media/dev/file/store_cover/');

  const contact = page.getByRole('link', { name: 'Escribir por WhatsApp' });
  await expect(contact).toBeVisible();
  // Sin espacios ni signos: `wa.me` no los acepta.
  expect(await contact.getAttribute('href')).toBe('https://wa.me/59899123456');

  const stored = await request.get((await cover.getAttribute('src')) as string);
  expect(stored.status()).toBe(200);
});
