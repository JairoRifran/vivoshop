import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO, failOnConsoleErrors, signIn } from './support';

/**
 * M02 end-to-end: two devices, one broadcast.
 *
 * ## Fake media, stated plainly
 *
 * These tests run Chromium with `--use-fake-device-for-media-stream`. The
 * camera is a synthetic rolling pattern and the microphone is a generated
 * tone. A green run here proves the pipeline is wired — permission handling,
 * `getUserMedia`, the preview element, the controls, the realtime fan-out —
 * and proves nothing at all about a real phone camera. Physical verification
 * is a manual procedure, written down in `docs/live-testing.md`.
 *
 * The streaming provider is the mock, which is what a fresh clone runs. So the
 * viewer's stage is the simulated one; what is being tested on the buyer side
 * is the *application* realtime layer, which is independent of video on
 * purpose.
 */

/** Puts the seller on air and returns the session id from the URL. */
async function startBroadcast(page: Page, title: string): Promise<string> {
  await signIn(page, DEMO.seller, '/vender');
  await page.goto('/vender/lives/nuevo?modo=ahora');
  await expect(page.getByRole('heading', { name: 'Nueva transmisión' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Título del vivo', exact: true }).fill(title);
  await page.getByRole('button', { name: /Campera Roma/ }).click();
  await page.getByRole('button', { name: 'Iniciar transmisión' }).click();

  await page.waitForURL(/\/transmitir\//);
  const id = new URL(page.url()).pathname.split('/').pop();
  expect(id, 'the console URL must carry the session id').toBeTruthy();
  return id!;
}

/** A second device: its own context, so it has its own cookies. */
async function openViewer(browser: Browser, liveSessionId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/live/${liveSessionId}`);
  return page;
}

// --- 1. Broadcaster ----------------------------------------------------------

test('the broadcaster gets a live camera preview and working device controls', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await startBroadcast(page, 'Vivo cámara E2E');

  // The preview is a real <video> fed by getUserMedia — the fake device, but
  // the same code path as a phone. Its presence is what distinguishes M02
  // from the M01 placeholder.
  const video = page.locator('video');
  await expect(video).toBeVisible();
  await expect
    .poll(async () => video.evaluate((element: HTMLVideoElement) => element.videoWidth), {
      timeout: 15_000,
      message: 'the camera never produced a frame',
    })
    .toBeGreaterThan(0);

  // Turning the camera off must actually release the picture, not just dim it.
  await page.getByRole('button', { name: 'Apagar cámara' }).click();
  await expect(page.getByText('Cámara apagada')).toBeVisible();
  await page.getByRole('button', { name: 'Encender cámara' }).click();
  await expect(page.locator('video')).toBeVisible();

  // The mic toggle is a state change, reported through aria-pressed.
  const mic = page.getByRole('button', { name: 'Silenciar micrófono' });
  await mic.click();
  await expect(page.getByRole('button', { name: 'Activar micrófono' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // Connection quality is words, never milliseconds or percentages.
  const status = page.getByText(/Conexión/);
  await expect(status).toBeVisible();
  await expect(status).not.toContainText(/\d+\s*ms/);
  await expect(status).not.toContainText('%');

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

// --- 2. Anonymous viewer -----------------------------------------------------

test('anyone can watch without an account, and is asked to sign in only to comment', async ({
  page,
  browser,
}) => {
  const id = await startBroadcast(page, 'Vivo anónimo E2E');

  const viewer = await openViewer(browser, id);
  await expect(viewer.getByText('En vivo').first()).toBeVisible();
  // The overlay is present even with nothing in it — an empty chat has no
  // height, which is the intended look, so presence is the right assertion.
  await expect(viewer.getByRole('list', { name: 'Comentarios en vivo' })).toBeAttached();

  // No login wall in front of the video: the distribution model is a link
  // pasted into WhatsApp.
  await expect(viewer).toHaveURL(new RegExp(`/live/${id}`));

  const composer = viewer.getByRole('textbox', { name: 'Escribir un comentario' });
  await expect(composer).toHaveAttribute('placeholder', 'Ingresá para comentar');

  await composer.fill('Quiero comentar');
  await viewer.getByRole('button', { name: 'Enviar comentario' }).click();
  await viewer.waitForURL(/\/ingresar/);

  await viewer.context().close();
});

// --- 3. Realtime chat between two devices ------------------------------------

test('a comment typed on one device appears on the other without a reload', async ({
  page,
  browser,
}) => {
  const id = await startBroadcast(page, 'Vivo chat E2E');

  const buyer = await browser.newContext();
  const buyerPage = await buyer.newPage();
  await signIn(buyerPage, DEMO.buyer, `/live/${id}`);
  await buyerPage.waitForURL(new RegExp(`/live/${id}`));

  const comment = `¿Queda en talle M? ${Date.now()}`;
  await buyerPage.getByRole('textbox', { name: 'Escribir un comentario' }).fill(comment);

  // The send button stays disabled until the realtime channel is up, so this
  // is a wait on the product's own signal rather than an arbitrary sleep.
  const send = buyerPage.getByRole('button', { name: 'Enviar comentario' });
  await expect(send).toBeEnabled();
  await send.click();

  // It appears for the author...
  await expect(buyerPage.getByText(comment)).toBeVisible();

  // ...and on the seller's console, which never reloaded.
  await page.getByRole('button', { name: 'Ver comentarios' }).click();
  await expect(page.getByRole('dialog').getByText(comment)).toBeVisible();

  await buyer.close();
});

// --- 4. Featured product, pushed live ----------------------------------------

test('the product the seller highlights changes on the buyer screen in place', async ({
  page,
  browser,
}) => {
  const id = await startBroadcast(page, 'Vivo destacado E2E');

  const viewer = await openViewer(browser, id);
  await expect(viewer.getByText('En vivo').first()).toBeVisible();

  await page.getByRole('button', { name: /Campera Roma/ }).click();
  await expect(page.getByText('En pantalla')).toBeVisible();

  // The buyer sees the product bar appear without navigating.
  await expect(viewer.getByRole('button', { name: /Campera Roma/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(viewer.getByText('Comprar')).toBeVisible();

  await viewer.context().close();
});

// --- 5. Ending the broadcast -------------------------------------------------

test('ending the broadcast needs a confirmation and closes the buyer screen too', async ({
  page,
  browser,
}) => {
  const id = await startBroadcast(page, 'Vivo final E2E');

  const viewer = await openViewer(browser, id);
  await expect(viewer.getByText('En vivo').first()).toBeVisible();

  // One tap must not end a broadcast in front of an audience.
  await page.getByRole('button', { name: 'Finalizar transmisión' }).click();
  await expect(page.getByText('¿Finalizar la transmisión?')).toBeVisible();
  await page.getByRole('button', { name: 'Sí, finalizar' }).click();
  await page.waitForURL(/\/vender$/);

  // The viewer learns about it over the socket, not by reloading.
  await expect(viewer.getByText('Esta transmisión terminó')).toBeVisible({ timeout: 15_000 });
  await expect(viewer.getByRole('button', { name: 'Ver la tienda' })).toBeVisible();

  await viewer.context().close();
});
