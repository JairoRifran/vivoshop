import { test as base, request } from '@playwright/test';
import { E2E } from '../playwright.config';

/**
 * `test` con el mundo en su estado sembrado.
 *
 * ## Qué problema resuelve
 *
 * Todos los specs corrían contra una misma API en memoria, así que cada uno
 * heredaba lo que el anterior había dejado: una puja ya vendida, stock
 * consumido, un pedido a medio pagar. El resultado dependía del orden en que
 * Playwright decidiera correrlos, y un fallo no distinguía entre "esto está
 * roto" y "esto encontró basura".
 *
 * Ahora cada prueba arranca del mismo mundo: Ana, Martina, sus tiendas y su
 * catálogo, sin una venta encima. Cualquier spec puede correrse solo, en
 * cualquier orden, y da lo mismo.
 *
 * ## Por qué un `beforeEach` y no un `beforeAll`
 *
 * Dos pruebas del mismo archivo se contaminan igual que dos archivos. El
 * `bids.spec` lo probaba: la primera vendía el producto y la segunda lo
 * encontraba sin stock.
 *
 * ## Por qué es un fixture y no una llamada en cada spec
 *
 * Porque olvidarse no puede ser una opción. Un spec que importa `test` de acá
 * ya está aislado; uno que lo importe de `@playwright/test` se nota en la
 * revisión, y el lint lo prohíbe.
 *
 * ## Por qué no hay esperas
 *
 * El reinicio es una llamada HTTP que devuelve cuando terminó. No hay nada que
 * esperar después, y un `waitForTimeout` acá sería exactamente el parche que
 * esconde una carrera en vez de resolverla.
 */
export const test = base.extend<{ freshWorld: void }>({
  freshWorld: [
    async ({}, use) => {
      const api = await request.newContext({ baseURL: E2E.apiUrl });
      try {
        const response = await api.post('/testing/reset', {
          headers: { 'x-e2e-reset': E2E.resetToken },
        });
        if (!response.ok()) {
          // Sin mundo limpio no tiene sentido seguir: lo que fallara después
          // sería imposible de atribuir, que es justamente lo que esto viene a
          // terminar.
          throw new Error(
            `No se pudo reiniciar el estado (HTTP ${response.status()}). ` +
              'La API de pruebas necesita NODE_ENV=test, DATA_DRIVER=memory y E2E_RESET_TOKEN.',
          );
        }
      } finally {
        await api.dispose();
      }

      await use();
    },
    // `auto` lo corre para toda prueba que use este `test`, sin que ninguna
    // tenga que pedirlo. Aislarse no es opcional.
    { auto: true },
  ],
});

/**
 * Herramientas de la API de pruebas, para lo que el navegador no puede ver.
 *
 * El stock no está en ninguna pantalla salvo cuando ya es bajo —"Quedan 3"—,
 * así que afirmar sobre él desde la UI probaría el umbral de escasez y no la
 * reserva. Se lee de la API, que es donde vive la verdad.
 */
export async function stockOf(productId: string): Promise<number> {
  const api = await request.newContext({ baseURL: E2E.apiUrl });
  try {
    const response = await api.get(`/products/${productId}`);
    const product = (await response.json()) as { variants: Array<{ stock: number }> };
    return product.variants.reduce((total, variant) => total + variant.stock, 0);
  } finally {
    await api.dispose();
  }
}

/** Corre el barrido de reservas vencidas ya mismo. Ver `testing.controller.ts`. */
export async function sweepReservations(): Promise<number> {
  const api = await request.newContext({ baseURL: E2E.apiUrl });
  try {
    const response = await api.post('/testing/sweep-reservations', {
      headers: { 'x-e2e-reset': E2E.resetToken },
    });
    const body = (await response.json()) as { resolved: number };
    return body.resolved;
  } finally {
    await api.dispose();
  }
}

export { expect } from '@playwright/test';
