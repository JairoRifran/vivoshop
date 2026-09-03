import { describe, expect, it } from 'vitest';
import {
  anonymizedEmailFor,
  assertCanDeleteAccount,
  assertConfirmationMatches,
  confirmationMatches,
  DELETED_ACCOUNT_NAME,
  isOrderInFlight,
} from './account';
import { ORDER_STATUSES } from './order';
import type { DomainError } from '../errors';
import type { UserId } from '../value-objects/identifiers';

const USUARIO = 'usr_9f2c' as UserId;

describe('cuándo un pedido está en vuelo', () => {
  it('solo completado y cancelado dejan de estarlo', () => {
    const enVuelo = ORDER_STATUSES.filter(isOrderInFlight);
    expect(enVuelo).toEqual(['pending_payment', 'paid', 'preparing', 'shipped', 'delivered']);
  });

  it('entregado sigue en vuelo, por los cinco días de arrepentimiento', () => {
    // Ley N.º 17.250: el comprador puede arrepentirse dentro de los cinco días
    // de recibido. Durante esa ventana el vendedor tiene que seguir existiendo.
    expect(isOrderInFlight('delivered')).toBe(true);
  });

  it('cubre todos los estados: si aparece uno nuevo, esta prueba lo obliga a decidir', () => {
    for (const estado of ORDER_STATUSES) {
      expect(typeof isOrderInFlight(estado)).toBe('boolean');
    }
    expect(ORDER_STATUSES).toHaveLength(7);
  });
});

describe('si se puede borrar la cuenta', () => {
  it('sin nada pendiente, se puede', () => {
    expect(() => assertCanDeleteAccount({ comoComprador: 0, comoVendedor: 0 })).not.toThrow();
  });

  it('con una compra sin cerrar, no', () => {
    expect(() => assertCanDeleteAccount({ comoComprador: 1, comoVendedor: 0 })).toThrowError(
      expect.objectContaining({ code: 'ACCOUNT_HAS_PENDING_ORDERS' }),
    );
  });

  it('con una venta sin cerrar, tampoco', () => {
    // Es el caso que más importa: del otro lado hay alguien que pagó.
    expect(() => assertCanDeleteAccount({ comoComprador: 0, comoVendedor: 1 })).toThrowError(
      expect.objectContaining({ code: 'ACCOUNT_HAS_PENDING_SALES' }),
    );
  });

  it('con las dos cosas, gana el mensaje de vendedor', () => {
    // Deliberado: la obligación con un tercero pesa más que la propia, y el
    // mensaje tiene que empujar a resolver esa primero.
    try {
      assertCanDeleteAccount({ comoComprador: 3, comoVendedor: 2 });
      expect.unreachable('tenía que tirar');
    } catch (error) {
      expect((error as DomainError).code).toBe('ACCOUNT_HAS_PENDING_SALES');
      expect((error as DomainError).details).toEqual({ pendientes: 2 });
    }
  });
});

describe('el correo anonimizado', () => {
  it('no es entregable', () => {
    // `.invalid` está reservado por el RFC 2606: ningún servidor lo resuelve,
    // así que un error de programación no le escribe a nadie.
    expect(anonymizedEmailFor(USUARIO)).toMatch(/\.invalid$/);
  });

  it('es distinto para cada usuario, así no choca con la columna única', () => {
    expect(anonymizedEmailFor('usr_a' as UserId)).not.toBe(anonymizedEmailFor('usr_b' as UserId));
  });

  it('no conserva el correo original en ninguna forma', () => {
    expect(anonymizedEmailFor(USUARIO)).not.toContain('@gmail');
    expect(anonymizedEmailFor(USUARIO)).toContain(USUARIO);
  });
});

describe('la confirmación escribiendo el correo', () => {
  const EMAIL = 'ana@vivo.uy';

  it('acepta el correo exacto', () => {
    expect(confirmationMatches(EMAIL, EMAIL)).toBe(true);
  });

  it('perdona mayúsculas y espacios de los bordes', () => {
    // El requisito es demostrar intención, no tipear con precisión.
    expect(confirmationMatches('  Ana@Vivo.UY  ', EMAIL)).toBe(true);
  });

  it('rechaza otra cosa', () => {
    expect(confirmationMatches('eliminar', EMAIL)).toBe(false);
    expect(confirmationMatches('', EMAIL)).toBe(false);
    expect(confirmationMatches('ana@vivo.com', EMAIL)).toBe(false);
  });

  it('la versión que tira lo hace con su propio código', () => {
    expect(() => assertConfirmationMatches('no', EMAIL)).toThrowError(
      expect.objectContaining({ code: 'ACCOUNT_CONFIRMATION_MISMATCH' }),
    );
    expect(() => assertConfirmationMatches(EMAIL, EMAIL)).not.toThrow();
  });
});

describe('el nombre que queda', () => {
  it('no es una cadena vacía', () => {
    // Una lista con un hueco donde iba un nombre se lee como un error de la
    // aplicación. "Cuenta eliminada" se lee como lo que es.
    expect(DELETED_ACCOUNT_NAME.length).toBeGreaterThan(0);
  });
});
