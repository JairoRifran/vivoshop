import { expect, test } from './fixtures';

/**
 * Ingresar con Google, en un navegador de verdad.
 *
 * ## Qué prueba esto que no prueba la suite de integración
 *
 * La de integración habla HTTP con la API y ya cubre los cuatro desenlaces.
 * Lo que **no** puede cubrir es la parte que solo existe en un navegador: que
 * el botón sea un enlace que navega de verdad a otro origen, que la cadena de
 * redirecciones —web → API → proveedor → API → web— llegue entera, y que al
 * final quede una cookie de sesión escrita en el dominio correcto.
 *
 * Esa cadena cruza dos orígenes y tres redirecciones. Es exactamente el tipo de
 * cosa que pasa en las pruebas de servidor y se rompe en la pantalla.
 *
 * El proveedor está simulado y se monta bajo el nombre `google`, así que las
 * rutas, el `state`, el PKCE y el vale son los de producción. Lo único que no
 * ocurre es la pantalla de Google, que no es nuestra.
 */

test('el botón entra, y deja una sesión de verdad', async ({ page }) => {
  await page.goto('/ingresar');

  const boton = page.getByRole('link', { name: /Continuar con Google/ });
  await expect(boton).toBeVisible();

  await boton.click();

  // Termina en la portada, ya adentro. Que la navegación complete es la mitad
  // de la prueba: son tres redirecciones a través de dos orígenes.
  await page.waitForURL('http://localhost:3100/');

  // Y la sesión es real: el perfil carga y muestra a la persona que volvió del
  // proveedor. Sin la cookie escrita, esta pantalla ofrecería "Ingresar".
  await page.goto('/perfil');
  await expect(page.getByRole('heading', { name: 'Persona Demo' })).toBeVisible();
  await expect(page.getByText('demo@vivo.uy')).toBeVisible();
});

test('vuelve a donde estaba, no a la portada', async ({ page }) => {
  // Alguien que tocó "Seguir" en una tienda y tuvo que ingresar espera volver a
  // esa tienda. Perder el destino es la forma más común de que alguien
  // abandone justo después de haberse tomado el trabajo de entrar.
  await page.goto('/ingresar?next=%2Fperfil');
  await page.getByRole('link', { name: /Continuar con Google/ }).click();

  await page.waitForURL('**/perfil');
  await expect(page.getByRole('heading', { name: 'Persona Demo' })).toBeVisible();
});

test('un destino externo no se respeta', async ({ page }) => {
  /**
   * `?next=https://sitio-falso.uy` convertiría nuestro ingreso en un
   * trampolín: el enlace sale de nuestro dominio —con nuestro candado y nuestro
   * nombre— y aterriza en una pantalla ajena que pide la contraseña otra vez.
   *
   * Se valida en los dos extremos, y esta prueba recorre los dos.
   */
  await page.goto('/ingresar?next=https%3A%2F%2Fsitio-falso.uy');
  await page.getByRole('link', { name: /Continuar con Google/ }).click();

  await page.waitForURL('http://localhost:3100/**');
  expect(page.url()).toContain('localhost:3100');
  expect(page.url()).not.toContain('sitio-falso');
});

test('volver a entrar cae en la misma cuenta', async ({ page, context }) => {
  /**
   * Que no se cree una segunda cuenta lo prueba la suite de integración
   * comparando ids, que es donde se puede afirmar de verdad. Acá se prueba lo
   * que solo se ve en un navegador: que cerrar sesión y volver a tocar el mismo
   * botón devuelva a la misma persona, sin pasar por ningún registro.
   */
  await page.goto('/ingresar');
  await page.getByRole('link', { name: /Continuar con Google/ }).click();
  await page.waitForURL('http://localhost:3100/');
  await page.goto('/perfil');
  await expect(page.getByRole('heading', { name: 'Persona Demo' })).toBeVisible();

  await context.clearCookies();

  // Sin cookie, el perfil vuelve a ofrecer entrar. Es la precondición de lo de
  // abajo, y establecerla explícitamente evita que esta prueba pase por
  // heredar la sesión anterior.
  await page.goto('/perfil');
  await expect(page.getByRole('heading', { name: 'Perfil' })).toBeVisible();

  await page.goto('/ingresar');
  await page.getByRole('link', { name: /Continuar con Google/ }).click();
  await page.waitForURL('http://localhost:3100/');

  await page.goto('/perfil');
  await expect(page.getByRole('heading', { name: 'Persona Demo' })).toBeVisible();
  await expect(page.getByText('demo@vivo.uy')).toBeVisible();
});

test('el ingreso con contraseña sigue funcionando al lado del social', async ({ page }) => {
  // Agregar una puerta no puede cerrar la que ya estaba.
  await page.goto('/ingresar');
  await page.getByRole('textbox', { name: 'Email' }).fill('ana@vivo.uy');
  await page.getByLabel('Contraseña').fill('vivo1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();

  await page.waitForURL('http://localhost:3100/');
  await page.goto('/perfil');
  await expect(page.getByRole('heading', { name: 'Ana Pérez' })).toBeVisible();
});
