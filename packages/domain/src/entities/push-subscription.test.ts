import { describe, expect, it } from 'vitest';
import {
  USER_AGENT_MAX_LENGTH,
  isPushSubscriptionGone,
  trimUserAgent,
} from './push-subscription';

describe('cuándo una suscripción se da de baja', () => {
  it('404 y 410 son definitivos', () => {
    // El navegador se desinstaló, la persona revocó el permiso, o el endpoint
    // rotó. Sin borrar, la tabla acumula destinos muertos para siempre y cada
    // vivo gasta envíos en gente que ya no está.
    expect(isPushSubscriptionGone(404)).toBe(true);
    expect(isPushSubscriptionGone(410)).toBe(true);
  });

  it('el resto es transitorio y no se borra nada', () => {
    // Un 429 o un 503 son el servicio de push teniendo un mal momento. Borrar
    // por eso sería desuscribir a alguien que no hizo nada.
    for (const status of [400, 401, 403, 413, 429, 500, 502, 503]) {
      expect(isPushSubscriptionGone(status)).toBe(false);
    }
  });
});

describe('el user agent que se guarda', () => {
  it('se recorta, para que la columna no sea un registro de qué usa cada uno', () => {
    const largo = 'Mozilla/5.0 '.repeat(40);
    expect(trimUserAgent(largo)?.length).toBe(USER_AGENT_MAX_LENGTH);
  });

  it('vacío y solo espacios son null, no cadenas vacías', () => {
    expect(trimUserAgent(null)).toBeNull();
    expect(trimUserAgent(undefined)).toBeNull();
    expect(trimUserAgent('   ')).toBeNull();
  });
});
