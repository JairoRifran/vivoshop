import type { Browser, Page } from '@playwright/test';
import { expect, pushDeliveriesFor, test } from './fixtures';
import { DEMO, signIn } from './support';

/**
 * Avisos de vivo, de punta a punta.
 *
 * ## Qué se prueba y qué no
 *
 * **No** se prueba que una notificación aparezca en el centro de
 * notificaciones del sistema operativo. Playwright no lo puede leer, y una
 * prueba que dependiera de eso sería frágil sin probar nada nuestro: lo que
 * mostraría es que Chrome funciona.
 *
 * Lo que sí se prueba es todo lo que es nuestro y decide el resultado: que
 * seguir no pida permiso por su cuenta, que "Ahora no" deje la preferencia
 * apagada sin tocar el navegador, y —la condición que cierra el milestone— que
 * un vivo produzca **una sola** constancia de envío por dispositivo, y que un
 * vivo nuevo vuelva a producirla.
 *
 * El permiso del navegador se concede a nivel de contexto, que es el
 * equivalente honesto de que alguien lo acepte: la decisión ya está tomada y lo
 * que queda por probar es lo que hace la aplicación con ella.
 */
const STORE = '/tienda/plaza-moda';

/**
 * Deja a Ana **sin** seguir la tienda, y la sigue de nuevo.
 *
 * El conjunto sembrado la deja siguiendo a Plaza Moda —es lo que hace que la
 * aplicación se vea como un producto la primera vez que se abre— así que la
 * precondición se establece, no se hereda. Devuelve con el diálogo recién
 * disparado.
 */
async function followFresh(page: Page): Promise<void> {
  const siguiendo = page.getByRole('button', { name: /Siguiendo/ });
  if (await siguiendo.isVisible()) await siguiendo.click();

  await page.getByRole('button', { name: /^Seguir/ }).click();
}

/**
 * Fija el estado del permiso del navegador, y anota si se lo pidió.
 *
 * Chromium en pruebas deniega las notificaciones por defecto, así que sin esto
 * solo se podría ejercitar una de las cuatro ramas. Estos son los estados del
 * navegador —no lógica nuestra— y fijarlos es lo que permite probar qué hace la
 * aplicación con cada uno.
 *
 * `asked` existe para poder afirmar lo más importante del diseño: que **no** se
 * le pide permiso a nadie que no lo haya pedido primero.
 */
async function withPermission(page: Page, state: 'default' | 'denied' | 'granted'): Promise<void> {
  await page.addInitScript((value) => {
    (window as unknown as { __askedForPermission: boolean }).__askedForPermission = false;
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => value });
    Notification.requestPermission = async () => {
      (window as unknown as { __askedForPermission: boolean }).__askedForPermission = true;
      return value === 'default' ? 'denied' : value;
    };
  }, state);
}

/**
 * Un navegador que ya aceptó, con un destino de mentira.
 *
 * Suscribirse de verdad exige hablar con el servicio de push del fabricante, y
 * eso no existe en una suite: la prueba dependería de Google y probaría a
 * Google. Lo que se simula es **solo** la frontera del navegador —el permiso y
 * `pushManager`— y todo lo nuestro queda real: pedir la clave pública, mandar
 * la suscripción a la API, guardar la preferencia, arrancar el vivo y reservar
 * la entrega.
 *
 * Es la separación que evita un E2E frágil sin dejar de probar el recorrido.
 */
async function withFakePush(page: Page, endpoint: string): Promise<void> {
  await page.addInitScript((url) => {
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => 'granted',
    });
    Notification.requestPermission = async () => 'granted';

    const subscription = {
      endpoint: url,
      toJSON: () => ({ endpoint: url, keys: { p256dh: 'clave-de-prueba', auth: 'secreto' } }),
      unsubscribe: async () => true,
    };

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => subscription,
          },
        }),
        register: async () => undefined,
        addEventListener: () => undefined,
      }),
    });
  }, endpoint);
}

const wasAsked = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { __askedForPermission: boolean }).__askedForPermission);

async function asSeller(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, DEMO.seller, '/vender');
  return page;
}

/** Deja a la vendedora al aire y devuelve el id de la transmisión. */
async function startLive(page: Page, title: string): Promise<string> {
  await page.goto('/vender/lives/nuevo?modo=ahora');
  await expect(page.getByRole('heading', { name: 'Nueva transmisión' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Título del vivo', exact: true }).fill(title);
  await page.getByRole('button', { name: /Campera Roma/ }).click();
  await page.getByRole('button', { name: 'Iniciar transmisión' }).click();

  await page.waitForURL(/\/transmitir\//);
  return new URL(page.url()).pathname.split('/').pop() as string;
}

test('seguir no pide permiso: la pregunta es aparte', async ({ page }) => {
  // Son dos decisiones, y el navegador solo pregunta una vez. Gastarla en
  // alguien que apenas tocó "Seguir" es cómo se pierde el permiso para siempre.
  await withPermission(page, 'default');
  await signIn(page, DEMO.buyer, STORE);

  await followFresh(page);

  // Lo que más importa: nadie le preguntó nada al navegador todavía.
  expect(await wasAsked(page)).toBe(false);

  // Aparece el diálogo propio, no el del navegador.
  await expect(page.getByText(/¿Querés que te avisemos cuando/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sí, avisarme' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ahora no' })).toBeVisible();
});

test('"Ahora no" deja siguiendo la tienda, con el aviso apagado', async ({ page }) => {
  await withPermission(page, 'default');
  await signIn(page, DEMO.buyer, STORE);
  await followFresh(page);
  await page.getByRole('button', { name: 'Ahora no' }).click();
  // El diálogo se cierra recién cuando la preferencia quedó guardada, así que
  // su ausencia es la señal de que se puede seguir. Sin esto, la recarga de
  // abajo compite con la acción de servidor.
  await expect(page.getByText(/¿Querés que te avisemos cuando/)).toHaveCount(0);

  // Sigue siguiendo: rechazar el aviso no es dejar de seguir.
  await expect(page.getByRole('button', { name: /Siguiendo/ })).toBeVisible();
  // Y la pregunta del navegador queda intacta para cuando cambie de opinión.
  expect(await wasAsked(page)).toBe(false);

  // Y el interruptor queda apagado, accesible para cuando cambie de opinión.
  await page.reload();
  const toggle = page.getByRole('switch', { name: /Notificaciones de vivos/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('el diálogo no vuelve a aparecer después de un "Ahora no"', async ({ page }) => {
  // Insistir en cada visita es cómo un sitio se gana que le bloqueen los
  // avisos. La respuesta se recuerda en este navegador.
  await withPermission(page, 'default');
  await signIn(page, DEMO.buyer, STORE);
  await followFresh(page);
  await page.getByRole('button', { name: 'Ahora no' }).click();

  await followFresh(page);

  await expect(page.getByText(/¿Querés que te avisemos cuando/)).toHaveCount(0);
});

test('un vivo avisa una vez por dispositivo, y uno nuevo vuelve a avisar', async ({
  page,
  browser,
}) => {
  /**
   * La condición que cierra M05.
   *
   * Se afirma sobre las constancias de envío y no sobre notificaciones
   * visibles: es la garantía que sobrevive a un reinicio de la API y a dos
   * réplicas anunciando a la vez, y es lo único que se puede verificar sin
   * depender del sistema operativo.
   */
  await withFakePush(page, 'https://push.uy/e2e-telefono-de-ana');

  await signIn(page, DEMO.buyer, STORE);
  await followFresh(page);
  await page.getByRole('button', { name: 'Sí, avisarme' }).click();

  // El diálogo se va cuando la suscripción quedó registrada.
  await expect(page.getByText(/¿Querés que te avisemos cuando/)).toHaveCount(0);

  const seller = await asSeller(browser);
  const liveA = await startLive(seller, 'Aviso A');

  // Un dispositivo, un aviso.
  await expect.poll(() => pushDeliveriesFor(liveA), { timeout: 15_000 }).toBe(1);

  // Recargar la consola del vendedor no vuelve a anunciar: no es un vivo nuevo.
  await seller.reload();
  await expect.poll(() => pushDeliveriesFor(liveA), { timeout: 10_000 }).toBe(1);

  // Un vivo distinto sí es un aviso distinto.
  await seller.goto('/vender');
  const liveB = await startLive(seller, 'Aviso B');
  await expect.poll(() => pushDeliveriesFor(liveB), { timeout: 15_000 }).toBe(1);
  expect(await pushDeliveriesFor(liveA)).toBe(1);

  await seller.close();
});

test('con el aviso apagado, un vivo nuevo no genera ninguna entrega', async ({
  page,
  browser,
}) => {
  await withFakePush(page, 'https://push.uy/e2e-telefono-arrepentido');

  await signIn(page, DEMO.buyer, STORE);
  await followFresh(page);
  await page.getByRole('button', { name: 'Sí, avisarme' }).click();
  // El diálogo se cierra cuando el dispositivo quedó registrado; hasta
  // entonces tapa el interruptor de abajo.
  await expect(page.getByText(/¿Querés que te avisemos cuando/)).toHaveCount(0);

  // Y después se arrepiente: apaga el aviso sin dejar de seguir.
  const toggle = page.getByRole('switch', { name: /Notificaciones de vivos/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  const seller = await asSeller(browser);
  const live = await startLive(seller, 'Sin avisos');

  // Se espera un momento y se afirma la ausencia: sin la espera, "cero" se
  // cumpliría solo porque el anuncio todavía no ocurrió.
  await expect.poll(() => pushDeliveriesFor(live), { timeout: 8_000 }).toBe(0);
  await expect(page.getByRole('button', { name: /Siguiendo/ })).toBeVisible();

  await seller.close();
});

test('con el permiso bloqueado no se ofrece nada ni se vuelve a preguntar', async ({ page }) => {
  /**
   * El navegador ignora `requestPermission()` después de un rechazo, así que
   * insistir no consigue nada y además gasta la confianza de quien ya contestó.
   * La pantalla lo dice y sigue.
   */
  await withPermission(page, 'denied');
  await signIn(page, DEMO.buyer, STORE);
  await followFresh(page);

  await expect(page.getByText(/bloqueadas en este dispositivo/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sí, avisarme' })).toHaveCount(0);
  expect(await wasAsked(page)).toBe(false);

  // Y seguir la tienda funciona igual: son dos cosas distintas.
  await expect(page.getByRole('button', { name: /Siguiendo/ })).toBeVisible();
});
