import { NextResponse, type NextRequest } from 'next/server';
import { safeReturnPath } from '@vivo/domain';
import type { SessionDto } from '@vivo/shared';
import { api } from '@/lib/api';
import { writeToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * El último paso del ingreso social: canjear el vale por la sesión.
 *
 * ## Por qué existe
 *
 * La API terminó el ingreso y tiene una sesión, pero no puede escribirla: la
 * cookie vive en **este** dominio, que es otro origen. Así que manda de vuelta
 * un vale de un minuto por la URL, y esto lo canjea del lado del servidor y
 * escribe la cookie.
 *
 * Viaja el vale y no el JWT de sesión porque esta URL queda en el historial del
 * navegador y en el `Referer` de lo primero que cargue la página siguiente. Un
 * vale vencido no sirve para nada; una sesión de siete días, sí.
 *
 * ## Por qué es un Route Handler y no una página
 *
 * Porque escribe una cookie, y **una página no puede**: Next lo permite solo en
 * Server Actions y Route Handlers. Escrito como página, esto fallaba con
 * "Cookies can only be modified in a Server Action or Route Handler" y la
 * persona terminaba en el ingreso con un error genérico después de haber
 * autenticado correctamente. Lo encontró la prueba de punta a punta; ninguna
 * prueba de servidor lo habría visto, porque del lado de la API todo estaba bien.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const vale = request.nextUrl.searchParams.get('vale');
  // `safeReturnPath` otra vez, y no por desconfiar de la API: este parámetro
  // llega por la URL y cualquiera puede escribirlo a mano. Validar en los dos
  // extremos es lo que hace que un `?next=https://sitio-falso.uy` no convierta
  // nuestro ingreso en un trampolín.
  const destination = safeReturnPath(request.nextUrl.searchParams.get('next'));
  const origin = request.nextUrl.origin;

  if (!vale) return NextResponse.redirect(new URL('/ingresar?error=social', origin));

  try {
    const client = await api();
    const session = await client.request<SessionDto>('POST', '/auth/session/exchange', { vale });
    await writeToken(session.token, session.expiresAt);
  } catch {
    // Vencido, ya usado, o la API no está. No hay nada que la persona pueda
    // hacer con el detalle, y el detalle sí le sirve a quien prueba ataques.
    return NextResponse.redirect(new URL('/ingresar?error=social', origin));
  }

  return NextResponse.redirect(new URL(destination, origin));
}
