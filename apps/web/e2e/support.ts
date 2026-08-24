import { expect, type Page } from '@playwright/test';

export const DEMO = {
  buyer: { email: 'ana@vivo.uy', password: 'vivo1234' },
  seller: { email: 'martina@vivo.uy', password: 'vivo1234' },
};

/**
 * Submits a form and waits for the navigation it should cause, retrying if it
 * did not happen.
 *
 * A form driven by a Server Action inside a Client Component only works once
 * React has hydrated, and Playwright's auto-waiting has no notion of
 * hydration: a click that lands a few milliseconds early is simply swallowed.
 * Rather than sprinkle arbitrary sleeps, this refills and retries until the
 * app actually responds.
 */
export async function submitUntilNavigated(
  page: Page,
  fill: () => Promise<void>,
  submit: () => Promise<void>,
  target: RegExp,
  attempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await fill();
    await submit();
    try {
      await page.waitForURL(target, { timeout: 10_000 });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
  }
}

/** Signs in through the real form, so the cookie path is exercised too. */
export async function signIn(
  page: Page,
  credentials: { email: string; password: string },
  next = '/',
): Promise<void> {
  await page.goto(`/ingresar?next=${encodeURIComponent(next)}`);
  await expect(page.getByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeVisible();

  await submitUntilNavigated(
    page,
    async () => {
      await page.getByLabel('Email').fill(credentials.email);
      await page.getByLabel('Contraseña').fill(credentials.password);
    },
    async () => page.getByRole('button', { name: 'Ingresar' }).click(),
    (url) => !url.pathname.startsWith('/ingresar'),
  );
}

/**
 * Fails the test on any console error. A screen that renders but logs a
 * hydration mismatch or a failed fetch is not a passing screen.
 */
export function failOnConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Dev-server plumbing, not application errors.
    if (text.includes('_next/hmr')) return;
    if (text.includes('Download the React DevTools')) return;
    errors.push(text);
  });
  return errors;
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows, 'the page must never scroll sideways on a phone').toBe(false);
}
