import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmSecretBox, SECRET_CONTEXT, loadEncryptionKeys } from './secret-box';

/**
 * El cifrado de credenciales.
 *
 * Lo que se prueba no es AES —eso lo prueba Node— sino las decisiones de
 * alrededor, que son las que se pueden equivocar: que el contexto ate el valor
 * a su columna, que un texto alterado falle en vez de descifrar a cualquier
 * cosa, que la rotación pueda leer lo viejo, y que producción sin clave no
 * arranque.
 */
function keyOf(seed: string): string {
  return Buffer.alloc(32, seed).toString('base64');
}

function boxWith(current: string, previous?: string) {
  return new AesGcmSecretBox(
    loadEncryptionKeys({
      ENCRYPTION_KEY: current,
      ...(previous ? { ENCRYPTION_KEY_PREVIOUS: previous } : {}),
      isProduction: true,
    }),
  );
}

const TOKEN = 'APP_USR-1234567890-abcdef-un-token-que-cobra-plata';

describe('cifrar y descifrar', () => {
  const box = boxWith(keyOf('a'));

  it('lo que entra es lo que sale', () => {
    const sealed = box.seal(TOKEN, SECRET_CONTEXT.accessToken);
    expect(box.open(sealed, SECRET_CONTEXT.accessToken)).toBe(TOKEN);
  });

  it('el texto cifrado no contiene el token', () => {
    const sealed = box.seal(TOKEN, SECRET_CONTEXT.accessToken) ?? '';
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain('APP_USR');
    expect(sealed.startsWith('v1.')).toBe(true);
  });

  it('cifrar dos veces el mismo valor da resultados distintos', () => {
    // El IV es aleatorio por operación. Si esto fallara, dos tiendas con el
    // mismo token se verían iguales en la base, y reusar un IV en GCM rompe la
    // garantía entera.
    expect(box.seal(TOKEN, SECRET_CONTEXT.accessToken)).not.toBe(
      box.seal(TOKEN, SECRET_CONTEXT.accessToken),
    );
  });

  it('null y vacío pasan sin tocarse', () => {
    // Una cuenta desconectada no tiene tokens, y eso no es un error.
    expect(box.seal(null, SECRET_CONTEXT.accessToken)).toBeNull();
    expect(box.open(null, SECRET_CONTEXT.accessToken)).toBeNull();
    expect(box.seal('', SECRET_CONTEXT.accessToken)).toBe('');
  });
});

describe('el contexto ata el valor a su columna', () => {
  const box = boxWith(keyOf('a'));

  it('un refresh token no descifra como access token', () => {
    // Sin esto, alguien con escritura en la base podría copiar el refresh
    // token a la columna del access token y el sistema lo usaría como tal.
    const sealed = box.seal(TOKEN, SECRET_CONTEXT.refreshToken);
    expect(() => box.open(sealed, SECRET_CONTEXT.accessToken)).toThrow();
  });
});

describe('autenticación: lo alterado no descifra', () => {
  const box = boxWith(keyOf('a'));

  it('un texto cifrado modificado falla en vez de devolver cualquier cosa', () => {
    const sealed = box.seal(TOKEN, SECRET_CONTEXT.accessToken) ?? '';
    const [version, keyId, payload] = sealed.split('.');
    const bytes = Buffer.from(payload ?? '', 'base64url');
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 1) ^ 0xff, bytes.length - 1);
    const tampered = `${version}.${keyId}.${bytes.toString('base64url')}`;

    expect(() => box.open(tampered, SECRET_CONTEXT.accessToken)).toThrow();
  });

  it('otra clave no descifra', () => {
    const sealed = boxWith(keyOf('a')).seal(TOKEN, SECRET_CONTEXT.accessToken);
    expect(() => boxWith(keyOf('b')).open(sealed, SECRET_CONTEXT.accessToken)).toThrow(
      /No hay clave de descifrado/,
    );
  });
});

describe('rotación', () => {
  it('la clave anterior sigue leyendo lo que ya estaba escrito', () => {
    const viejo = boxWith(keyOf('vieja')).seal(TOKEN, SECRET_CONTEXT.accessToken);

    // El día de la rotación: la nueva cifra, la vieja todavía descifra.
    const rotado = boxWith(keyOf('nueva'), keyOf('vieja'));
    expect(rotado.open(viejo, SECRET_CONTEXT.accessToken)).toBe(TOKEN);

    // Y lo nuevo se escribe con la nueva.
    const nuevo = rotado.seal(TOKEN, SECRET_CONTEXT.accessToken) ?? '';
    expect(nuevo.split('.')[1]).not.toBe((viejo ?? '').split('.')[1]);
  });

  it('sin la anterior configurada, lo viejo falla con un mensaje que dice qué hacer', () => {
    const viejo = boxWith(keyOf('vieja')).seal(TOKEN, SECRET_CONTEXT.accessToken);
    expect(() => boxWith(keyOf('nueva')).open(viejo, SECRET_CONTEXT.accessToken)).toThrow(
      /ENCRYPTION_KEY_PREVIOUS/,
    );
  });
});

describe('valores de antes del cifrado', () => {
  it('se devuelven tal cual, para no romper una tienda ya conectada', () => {
    // Migración: lo que quedó en claro se sigue leyendo hasta que la migración
    // lo reescriba. Que esto exista es deuda, y el proveedor lo avisa por log.
    const box = boxWith(keyOf('a'));
    expect(box.open(TOKEN, SECRET_CONTEXT.accessToken)).toBe(TOKEN);
  });
});

describe('la clave', () => {
  it('en producción es obligatoria', () => {
    expect(() => loadEncryptionKeys({ isProduction: true })).toThrow(/Falta ENCRYPTION_KEY/);
  });

  it('fuera de producción hay una de desarrollo, para que el camino se ejecute igual', () => {
    // La alternativa —no cifrar cuando falta la clave— deja el código de
    // producción sin ejercitar hasta el despliegue.
    const keys = loadEncryptionKeys({ isProduction: false });
    const box = new AesGcmSecretBox(keys);
    const sealed = box.seal(TOKEN, SECRET_CONTEXT.accessToken) ?? '';
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(box.open(sealed, SECRET_CONTEXT.accessToken)).toBe(TOKEN);
  });

  it('una clave de largo equivocado se rechaza al arrancar, no al primer cobro', () => {
    expect(() =>
      loadEncryptionKeys({ ENCRYPTION_KEY: randomBytes(16).toString('base64'), isProduction: true }),
    ).toThrow(/32 bytes/);
  });
});
