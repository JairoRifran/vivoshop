import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { DEMO, signIn } from './support';

/**
 * Contraseñas, en un navegador de verdad.
 *
 * ## El problema de probar esto de punta a punta
 *
 * El enlace llega por correo, y en la suite no hay buzón. Con
 * `EMAIL_PROVIDER=log` el correo se escribe en la consola de la API, que
 * Playwright no lee.
 *
 * Así que el token se pide por la API —la misma ruta que usa la pantalla— y el
 * enlace se arma acá. Lo que queda simulado es **solo el buzón**: el token es
 * real, sale de la base, es de un solo uso y vence. Todo el resto del recorrido
 * ocurre en el navegador.
 *
 * La alternativa —levantar un servidor SMTP de mentira— probaría que sabemos
 * leer correo, no que nuestro flujo funcione.
 */

const NUEVA = 'contrasena-nueva-larga';

/**
 * Pide el enlace y devuelve el token, leyéndolo del correo escrito al log.
 *
 * La API de pruebas expone el último correo justamente para esto: sin un buzón,
 * es la única forma de que el token que usa el navegador sea el real y no uno
 * inventado por la prueba.
 */
async function requestResetToken(request: APIRequestContext, email: string) {
  const { apiUrl, resetToken } = await import('../playwright.config').then((m) => m.E2E);

  await request.post(`${apiUrl}/auth/password/forgot`, { data: { email } });

  const response = await request.get(`${apiUrl}/testing/last-email`, {
    headers: { 'x-e2e-reset': resetToken },
  });
  expect(response.ok(), 'la API de pruebas tenía que devolver el último correo').toBe(true);

  const body = (await response.json()) as { text: string };
  const match = /token=([^\s&]+)/.exec(body.text);
  expect(match, 'el correo no traía un enlace con token').toBeTruthy();
  return decodeURIComponent(match?.[1] ?? '');
}

test('la pantalla de ingreso ofrece recuperar', async ({ page }) => {
  await page.goto('/ingresar');
  await expect(page.getByRole('link', { name: /Olvidaste tu contraseña/ })).toBeVisible();
});

test('pedir el enlace responde lo mismo exista o no la cuenta', async ({ page }) => {
  /**
   * La regla que atraviesa el milestone: si la pantalla distinguiera, el
   * formulario sería un padrón de quién tiene cuenta acá.
   */
  await page.goto('/ingresar/olvide');
  await page.getByRole('textbox', { name: 'Email' }).fill('no-existe-nadie@vivo.uy');
  await page.getByRole('button', { name: 'Mandame el enlace' }).click();

  const mensaje = page.getByText(/Si esa dirección tiene una cuenta/);
  await expect(mensaje).toBeVisible();

  // Y con una que sí existe, exactamente el mismo texto.
  await page.goto('/ingresar/olvide');
  await page.getByRole('textbox', { name: 'Email' }).fill(DEMO.buyer.email);
  await page.getByRole('button', { name: 'Mandame el enlace' }).click();
  await expect(page.getByText(/Si esa dirección tiene una cuenta/)).toBeVisible();
});

test('el recorrido completo: pedir, elegir una nueva, y entrar con ella', async ({
  page,
  request,
}) => {
  const token = await requestResetToken(request, DEMO.buyer.email);

  await page.goto(`/ingresar/restablecer?token=${encodeURIComponent(token)}`);
  await page.getByLabel('Contraseña nueva').fill(NUEVA);
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText(/Ya podés ingresar con tu contraseña nueva/)).toBeVisible();

  // La nueva entra.
  await page.getByRole('link', { name: 'Ingresar' }).click();
  await page.waitForURL('**/ingresar');
  await page.getByRole('textbox', { name: 'Email' }).fill(DEMO.buyer.email);
  await page.getByLabel('Contraseña').fill(NUEVA);
  await page.getByRole('button', { name: 'Ingresar' }).click();

  await page.waitForURL('http://localhost:3100/');
  await page.goto('/perfil');
  await expect(page.getByRole('heading', { name: 'Ana Pérez' })).toBeVisible();
});

test('el mismo enlace no sirve dos veces', async ({ page, request }) => {
  // Sin esto, quien consigue el enlace puede volver a cambiar la contraseña
  // después de que su dueño ya la cambió, y quedarse con la cuenta.
  const token = await requestResetToken(request, DEMO.buyer.email);
  const url = `/ingresar/restablecer?token=${encodeURIComponent(token)}`;

  await page.goto(url);
  await page.getByLabel('Contraseña nueva').fill(NUEVA);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/Ya podés ingresar/)).toBeVisible();

  await page.goto(url);
  await page.getByLabel('Contraseña nueva').fill('otra-mas-larga');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText(/venció o ya se usó/)).toBeVisible();
});

test('un enlace sin token lo dice, en vez de fallar al enviar', async ({ page }) => {
  await page.goto('/ingresar/restablecer');
  await expect(page.getByRole('heading', { name: 'Enlace incompleto' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pedir un enlace nuevo' })).toBeVisible();
});

test('cambiar la contraseña adentro cierra la sesión y lo dice', async ({ page }) => {
  /**
   * Es el comportamiento correcto —cambiar la contraseña cierra **todas** las
   * sesiones, incluida la que hizo el cambio— y sería desconcertante sin
   * explicación. La pantalla lo avisa antes y el aviso al volver lo confirma.
   */
  await signIn(page, DEMO.buyer, '/perfil/seguridad');

  await expect(page.getByText(/se cierran todas tus sesiones/)).toBeVisible();

  await page.getByLabel('Contraseña actual').fill(DEMO.buyer.password);
  await page.getByLabel('Contraseña nueva').fill(NUEVA);
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();

  await page.waitForURL('**/ingresar**');
  await expect(page.getByText(/cerramos todas las sesiones/)).toBeVisible();

  // Y la vieja ya no entra.
  await page.getByRole('textbox', { name: 'Email' }).fill(DEMO.buyer.email);
  // En la pantalla de ingreso hay un solo campo de contraseña, así que no hace
  // falta desambiguar. El nombre accesible lleva el asterisco de obligatorio,
  // por eso no se pide coincidencia exacta.
  await page.getByLabel('Contraseña').fill(DEMO.buyer.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
