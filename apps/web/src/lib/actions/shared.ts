import 'server-only';
import { humanizeError, isApiError } from '@vivo/shared';
import type { ActionState } from './state';

export type { ActionState } from './state';
export { IDLE } from './state';

export function failure(error: unknown): ActionState {
  if (isApiError(error)) {
    return {
      status: 'error',
      message: humanizeError(error),
      ...(Object.keys(error.fieldErrors).length > 0 ? { fieldErrors: error.fieldErrors } : {}),
    };
  }
  return { status: 'error', message: 'Algo salió mal. Intentá de nuevo.' };
}

export function success(message?: string, id?: string): ActionState {
  return { status: 'success', ...(message ? { message } : {}), ...(id ? { id } : {}) };
}

/** Reads a trimmed string from FormData, or an empty string. */
export function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalText(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value.length > 0 ? value : null;
}

export function number(form: FormData, key: string, fallback = 0): number {
  const value = Number(text(form, key));
  return Number.isFinite(value) ? value : fallback;
}

export function checkbox(form: FormData, key: string): boolean {
  return form.get(key) === 'on' || form.get(key) === 'true';
}

/**
 * Lee la clave de una imagen de `ImageField`, con sus tres estados.
 *
 * `undefined` cuando el campo vino vacío —nadie tocó la imagen— y el servidor
 * deja la actual. `null` cuando dice `null`, que es "sacala". Y la clave
 * cuando se subió una nueva. Los tres son distintos y el del medio es el que
 * se pierde si esto se escribe con un `|| null`.
 */
export function mediaKey(form: FormData, key: string): string | null | undefined {
  const value = text(form, key);
  if (value.length === 0) return undefined;
  return value === 'null' ? null : value;
}
