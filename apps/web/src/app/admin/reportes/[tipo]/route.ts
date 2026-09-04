import { isApiError } from '@vivo/shared';
import { NextResponse } from 'next/server';
import { api, getCurrentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

const TIPOS = { pedidos: 'pedidos', cobros: 'cobros' } as const;
type Tipo = keyof typeof TIPOS;

/**
 * Sirve el CSV que arma la API.
 *
 * Existe porque el archivo no lo puede pedir el navegador solo: la sesión vive
 * en una cookie `httpOnly` de este dominio y la API espera un `Authorization:
 * Bearer`. Un enlace directo a la API iría sin credencial y volvería 401.
 * Acá el servidor lee la cookie, pide el archivo con el token y lo entrega.
 *
 * La comprobación de rol está repetida —la API ya rechaza a quien no sea
 * `admin`— y está bien que lo esté: esta ruta reenvía un archivo con los
 * correos de todos los compradores, y es el tipo de lugar donde una defensa de
 * más cuesta cuatro líneas.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tipo: string }> },
): Promise<Response> {
  const { tipo } = await params;
  if (!(tipo in TIPOS)) return new NextResponse('No encontrado', { status: 404 });

  const user = await getCurrentUser();
  if (!user?.roles.includes('admin')) {
    return new NextResponse('No encontrado', { status: 404 });
  }

  const dias = new URL(request.url).searchParams.get('dias');

  try {
    const client = await api();
    const csv = await client.admin.reporte(TIPOS[tipo as Tipo], dias ? { dias } : undefined);

    const fecha = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // La fecha va en el nombre acá y no en la API: es el momento de la
        // descarga, y dos reportes del mismo día con ventanas distintas se
        // pisarían en la carpeta de descargas.
        'Content-Disposition': `attachment; filename="vivoshop-${tipo}-${fecha}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = isApiError(error) ? error.status : 502;
    return new NextResponse('No pudimos generar el reporte.', {
      status: status === 0 ? 502 : status,
    });
  }
}
