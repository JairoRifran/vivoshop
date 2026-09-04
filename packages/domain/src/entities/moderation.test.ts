import { describe, expect, it } from 'vitest';
import {
  REPORT_DETAIL_MAX,
  REPORT_REASONS,
  REPORT_STATUSES,
  assertCanBlock,
  assertCanReportUser,
  assertNotResolved,
  assertValidDetail,
  hideFromBlocked,
  isResolved,
} from './moderation';
import type { UserId } from '../value-objects/identifiers';

const ANA = 'usr_ana' as UserId;
const BRUNO = 'usr_bruno' as UserId;

describe('bloquear', () => {
  it('a otra persona, se puede', () => {
    expect(() => assertCanBlock(ANA, BRUNO)).not.toThrow();
  });

  it('a uno mismo, no', () => {
    // Pasa de verdad: el vendedor toca "bloquear" sobre su propio mensaje en su
    // propio vivo y deja de ver su chat sin entender por qué.
    expect(() => assertCanBlock(ANA, ANA)).toThrowError(
      expect.objectContaining({ code: 'CANNOT_BLOCK_SELF' }),
    );
  });

  it('tampoco denunciarse a uno mismo', () => {
    expect(() => assertCanReportUser(ANA, ANA)).toThrowError(
      expect.objectContaining({ code: 'CANNOT_REPORT_SELF' }),
    );
  });
});

describe('esconder lo que escribió alguien bloqueado', () => {
  const mensajes = [
    { id: '1', authorId: ANA },
    { id: '2', authorId: BRUNO },
    { id: '3', authorId: ANA },
    { id: '4', authorId: null },
  ];

  it('sin nadie bloqueado, no toca nada', () => {
    expect(hideFromBlocked(mensajes, new Set())).toEqual(mensajes);
  });

  it('saca los del bloqueado y deja el resto', () => {
    const visible = hideFromBlocked(mensajes, new Set([String(BRUNO)]));
    expect(visible.map((m) => m.id)).toEqual(['1', '3', '4']);
  });

  it('los mensajes del sistema no tienen autor y nunca se esconden', () => {
    // `authorId: null` es un aviso de la aplicación —"se agotó el stock"—, no
    // algo que escribió una persona. Esconderlo dejaría al comprador sin saber
    // qué pasó por haber bloqueado a alguien que no tiene nada que ver.
    const visible = hideFromBlocked(mensajes, new Set([String(ANA), String(BRUNO)]));
    expect(visible.map((m) => m.id)).toEqual(['4']);
  });

  it('devuelve una copia: no muta la lista original', () => {
    const copia = hideFromBlocked(mensajes, new Set());
    copia.push({ id: '5', authorId: ANA });
    expect(mensajes).toHaveLength(4);
  });
});

describe('el detalle de la denuncia', () => {
  it('acepta un texto normal', () => {
    expect(() => assertValidDetail('Me insultó en el chat')).not.toThrow();
  });

  it('acepta el vacío: el motivo ya dice bastante', () => {
    expect(() => assertValidDetail('')).not.toThrow();
  });

  it('rechaza uno que no se puede leer', () => {
    expect(() => assertValidDetail('x'.repeat(REPORT_DETAIL_MAX + 1))).toThrowError(
      expect.objectContaining({ code: 'REPORT_DETAIL_TOO_LONG' }),
    );
  });

  it('el límite exacto entra', () => {
    expect(() => assertValidDetail('x'.repeat(REPORT_DETAIL_MAX))).not.toThrow();
  });
});

describe('el estado de una denuncia', () => {
  it('abierta es la única sin resolver', () => {
    const sinResolver = REPORT_STATUSES.filter((s) => !isResolved(s));
    expect(sinResolver).toEqual(['open']);
  });

  it('una resuelta no se vuelve a resolver', () => {
    expect(() => assertNotResolved('open')).not.toThrow();
    expect(() => assertNotResolved('actioned')).toThrowError(
      expect.objectContaining({ code: 'REPORT_ALREADY_RESOLVED' }),
    );
    expect(() => assertNotResolved('dismissed')).toThrowError(
      expect.objectContaining({ code: 'REPORT_ALREADY_RESOLVED' }),
    );
  });
});

describe('los motivos', () => {
  it('cubren lo que exige la política de contenido de Play', () => {
    // Play pide que quien denuncia pueda decir *qué* pasa, no solo que algo
    // pasa. Estos son los que la política nombra.
    for (const motivo of ['spam', 'ofensivo', 'sexual', 'violencia'] as const) {
      expect(REPORT_REASONS).toContain(motivo);
    }
  });

  it('incluye estafa, que es el que más importa en una app de compras', () => {
    expect(REPORT_REASONS).toContain('estafa');
  });
});
