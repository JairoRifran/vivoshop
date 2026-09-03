import { ImageResponse } from 'next/og';

/**
 * La imagen que aparece cuando alguien comparte un enlace de VivoShop.
 *
 * Hasta ahora no existía: un enlace pegado en WhatsApp mostraba texto pelado.
 * En Uruguay, WhatsApp **es** el canal por el que un producto así circula, así
 * que era la superficie de marca más visible que teníamos vacía.
 *
 * Se genera con `next/og`, que usa Satori: no es un navegador, entiende un
 * subconjunto de CSS y no hereda estilos. Por eso cada `div` con más de un hijo
 * declara su `display` y los colores van literales en vez de por token.
 *
 * La marca va como `data:` URI y no como componente: Satori dibuja SVG, pero
 * una imagen embebida es lo que menos depende de qué versión soporta qué.
 *
 * ## La tipografía no es la nuestra, y es a propósito por ahora
 *
 * Satori solo usa la fuente que se le pasa como archivo, y no lee woff2 —que es
 * lo único que `next/font` deja en disco, además con nombre con hash—. Usar
 * Manrope acá exige vendorizar un `.ttf` en el repositorio.
 *
 * Mientras tanto la composición **no depende del peso**: la marca es la que
 * carga el reconocimiento y el texto acompaña. Con la fuente por defecto se ve
 * deliberado en vez de roto. Queda anotado en `docs/m09.md` §10.
 */
export const runtime = 'nodejs';
export const alt = 'VivoShop — comprá en vivo';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#14141a';
const MARCA = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
    <path d="M7.2 14a8.8 8.8 0 0 1 17.6 0" stroke="#ff2d55" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M11.8 14a4.2 4.2 0 0 1 8.4 0" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M4.4 14H27.6L26.3 24.6C26.05 26.45 24.4 27.8 22.5 27.8H9.5C7.6 27.8 5.95 26.45 5.7 24.6Z" fill="#ffffff"/>
  </svg>`,
)}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: INK,
          padding: '0 96px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <img src={MARCA} width={168} height={168} alt="" />
          <div
            style={{
              display: 'flex',
              fontSize: 92,
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '-0.03em',
            }}
          >
            VivoShop
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 42,
            color: '#b9b9c2',
          }}
        >
          Comprá y vendé en el vivo
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 44 }}>
          <div
            style={{
              display: 'flex',
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: '#ff2d55',
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              fontWeight: 700,
              color: '#ff2d55',
              letterSpacing: '0.12em',
            }}
          >
            EN VIVO
          </div>
        </div>
      </div>
    ),
    size,
  );
}
