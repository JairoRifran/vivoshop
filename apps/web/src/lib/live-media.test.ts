import { describe, expect, it } from 'vitest';
import { BROADCASTER_ROOM_OPTIONS, VIEWER_ROOM_OPTIONS } from './live-media';

/**
 * Configuración que sostiene el video, con una prueba que explica por qué.
 *
 * Normalmente un test que compara una constante contra su propio valor no vale
 * nada. Este sí, y la razón está en cómo falla el error que previene: **no
 * falla**. No hay excepción, no hay desconexión, no hay una línea en la
 * consola. El video anda unos segundos, se queda en negro, y el vivo sigue
 * abierto como si todo estuviera bien. Estuvo así en producción.
 *
 * Ningún test de integración lo agarra —haría falta un SFU de verdad y esperar
 * a que la heurística de visibilidad actúe— y el E2E corre con el proveedor
 * simulado, así que este código ni se ejecuta. Lo único que queda es dejar el
 * motivo pegado al valor, de modo que quien lo cambie lea por qué está así
 * antes de romperlo otra vez.
 */
describe('la sala del comprador', () => {
  it('no usa adaptiveStream, porque nadie adjunta la pista', () => {
    // `useViewerStream` arma su propio MediaStream y `VideoStage` lo asigna a
    // `srcObject`. LiveKit nunca ve un elemento adjunto, concluye que nadie
    // mira y pausa el flujo. Ver el comentario sobre `VIEWER_ROOM_OPTIONS`.
    expect(
      VIEWER_ROOM_OPTIONS.adaptiveStream,
      'Encender adaptiveStream sin llamar a track.attach() deja el video en negro ' +
        'a los pocos segundos, sin ningún error. Si querés la optimización, primero ' +
        'hay que adjuntar la pista al <video>.',
    ).toBe(false);
  });
});

describe('la sala del vendedor', () => {
  it('mantiene dynacast: ahorra batería y datos en un teléfono', () => {
    expect(BROADCASTER_ROOM_OPTIONS.dynacast).toBe(true);
  });

  it('no declara adaptiveStream: esta sala no se suscribe a nada', () => {
    // Es una opción de quien se suscribe. El vendedor solo publica, así que
    // acá era configuración muerta — y estaba invitando a copiarla al otro
    // lado, donde sí hace daño.
    expect('adaptiveStream' in BROADCASTER_ROOM_OPTIONS).toBe(false);
  });
});
