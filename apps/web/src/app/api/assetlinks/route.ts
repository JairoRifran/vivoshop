import { NextResponse } from 'next/server';

/**
 * Digital Asset Links: la prueba de que la app de Android y este dominio son
 * de la misma persona.
 *
 * ## Por qué existe
 *
 * La aplicación de Google Play va a ser un **TWA** (Trusted Web Activity): una
 * cáscara Android que abre `vivoshop.live` a pantalla completa usando Chrome
 * por debajo. Para que Chrome acepte esconder la barra de direcciones, tiene
 * que comprobar que quien firmó el APK controla el dominio. Esa comprobación
 * es este archivo.
 *
 * **Sin él la app abre igual, pero con la barra del navegador arriba**, con la
 * URL a la vista. Deja de parecer una aplicación y parece un navegador con un
 * sitio adentro, que es exactamente lo que no queremos.
 *
 * ## Por qué una ruta y no un archivo estático
 *
 * La huella de la firma no existe hasta que se genera el almacén de claves, y
 * cambia si alguna vez se rota. Como ruta, sale de variables de entorno: el día
 * que exista la clave se cargan dos variables en Vercel y esto empieza a
 * responder, sin tocar código ni volver a desplegar el repositorio.
 *
 * Mientras no estén, devuelve 404 a propósito. Un `assetlinks.json` con una
 * huella inventada es peor que ninguno: Chrome lo lee, no coincide, y el
 * resultado es el mismo que no tenerlo pero con un archivo mintiendo.
 *
 * ## Cómo se completa
 *
 * 1. Generar el paquete firmado (PWABuilder o `bubblewrap`), que entrega la
 *    huella SHA-256 del certificado.
 * 2. En Vercel: `ANDROID_PACKAGE_NAME` y `ANDROID_SHA256_FINGERPRINT`.
 * 3. Comprobar que `https://vivoshop.live/.well-known/assetlinks.json`
 *    devuelva 200.
 *
 * Ojo con el paso 1: si se publica con **Play App Signing** —lo habitual, y lo
 * recomendado—, la huella que vale es la del certificado que genera Google, no
 * la del almacén local. Está en Play Console, en Configuración → Integridad de
 * la app. Usar la equivocada es el error clásico de este archivo.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const paquete = process.env.ANDROID_PACKAGE_NAME;
  const huella = process.env.ANDROID_SHA256_FINGERPRINT;

  if (!paquete || !huella) {
    return new NextResponse(null, { status: 404 });
  }

  // Google acepta varias huellas: sirve para rotar la clave sin romper la app
  // instalada. Se separan por coma.
  const huellas = huella
    .split(',')
    .map((h) => h.trim().toUpperCase())
    .filter(Boolean);

  return NextResponse.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: paquete,
          sha256_cert_fingerprints: huellas,
        },
      },
    ],
    {
      headers: {
        'Content-Type': 'application/json',
        // Chrome lo consulta al abrir la app. Una hora es suficiente para no
        // castigar el arranque y corto para que una rotación se propague.
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
