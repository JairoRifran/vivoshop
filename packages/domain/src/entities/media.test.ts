import { describe, expect, it } from 'vitest';
import { asUserId } from '../value-objects/identifiers';
import {
  IMAGE_CONTENT_TYPES,
  assertOwnMediaKey,
  buildMediaKey,
  isImageContentType,
  parseMediaKey,
} from './media';

/**
 * Las reglas de una imagen subida.
 *
 * Lo que importa acá no es el formato de la clave sino lo que la clave impide:
 * que alguien se quede con la imagen de otro, o ponga una URL cualquiera de
 * internet en su perfil. Hoy el campo acepta cualquier cadena, y esto es lo que
 * lo cierra.
 */
const ANA = asUserId('usr_ana');
const DIEGO = asUserId('usr_diego');

const keyFor = (purpose: 'avatar' | 'store_logo' | 'store_cover', owner = ANA) =>
  buildMediaKey({ purpose, ownerId: owner, fileId: 'f3d9e1c8', contentType: 'image/webp' });

describe('la clave de un archivo', () => {
  it('lleva el propósito y el dueño en la ruta', () => {
    expect(keyFor('store_cover')).toBe('store_cover/usr_ana/f3d9e1c8.webp');
  });

  it('se puede volver a leer', () => {
    expect(parseMediaKey(keyFor('avatar'))).toEqual({ purpose: 'avatar', ownerId: 'usr_ana' });
  });

  it('rechaza lo que no emitimos nosotros', () => {
    for (const invalid of [
      'https://otro-sitio.com/foto.jpg',
      '../../../etc/passwd',
      'avatar/usr_ana/foto.svg',
      'inventado/usr_ana/f3d9e1c8.webp',
      'avatar/usr_ana/../otro/f3d9e1c8.webp',
      '',
    ]) {
      expect(parseMediaKey(invalid)).toBeNull();
    }
  });
});

describe('de quién es la imagen', () => {
  it('la propia pasa', () => {
    expect(() =>
      assertOwnMediaKey({ key: keyFor('avatar'), ownerId: ANA, purpose: 'avatar' }),
    ).not.toThrow();
  });

  it('la de otro no', () => {
    // Sin esto, alguien podría mandar la clave de Diego y quedarse con su foto.
    expect(() =>
      assertOwnMediaKey({ key: keyFor('avatar', DIEGO), ownerId: ANA, purpose: 'avatar' }),
    ).toThrow(/no es válida/);
  });

  it('una URL de internet tampoco', () => {
    // Es el agujero que esto cierra: el campo aceptaba cualquier cadena, así
    // que se podía apuntar a un servidor ajeno y usar el perfil de baliza.
    expect(() =>
      assertOwnMediaKey({
        key: 'https://rastreador.example/pixel.png',
        ownerId: ANA,
        purpose: 'avatar',
      }),
    ).toThrow(/no es válida/);
  });

  it('una imagen propia en el lugar equivocado no sirve', () => {
    // El propósito es parte de la identidad: un logo no entra donde va una
    // portada, ni al revés.
    expect(() =>
      assertOwnMediaKey({ key: keyFor('store_logo'), ownerId: ANA, purpose: 'store_cover' }),
    ).toThrow(/no es válida/);
  });

  it('no dice si la clave ajena existe', () => {
    // El mismo error para "no existe" y "no es tuya": distinguirlos le diría a
    // quien prueba claves ajenas cuáles existen.
    const ajena = (): unknown => {
      try {
        assertOwnMediaKey({ key: keyFor('avatar', DIEGO), ownerId: ANA, purpose: 'avatar' });
      } catch (error) {
        return (error as { message: string }).message;
      }
    };
    const inventada = (): unknown => {
      try {
        assertOwnMediaKey({ key: 'basura', ownerId: ANA, purpose: 'avatar' });
      } catch (error) {
        return (error as { message: string }).message;
      }
    };
    expect(ajena()).toBe(inventada());
  });
});

describe('los formatos', () => {
  it('acepta los tres que decodifica todo el mundo', () => {
    for (const type of IMAGE_CONTENT_TYPES) expect(isImageContentType(type)).toBe(true);
  });

  it('rechaza SVG', () => {
    // Un SVG puede llevar `<script>`, y servido desde nuestro dominio se
    // ejecuta con nuestros permisos. Ningún logo lo vale.
    expect(isImageContentType('image/svg+xml')).toBe(false);
  });

  it('rechaza cualquier otra cosa', () => {
    for (const type of ['application/pdf', 'text/html', 'video/mp4', '']) {
      expect(isImageContentType(type)).toBe(false);
    }
  });
});
