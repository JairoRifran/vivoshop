'use client';

import type { BidSessionDto } from '@vivo/shared';
import { useCallback, useEffect, useState } from 'react';
import { bidsForLive } from './actions/bids';

/**
 * Cada cuánto se reconcilia el estado de las pujas contra el servidor.
 *
 * El socket es el camino principal y el que hace que la pantalla se sienta
 * viva. Esto es la red de abajo, y existe por una razón concreta: en la consola
 * del vendedor se decide dinero. Si un evento se pierde —el teléfono cambió de
 * celda, el socket se reconectó, la pestaña estuvo en segundo plano— el
 * vendedor estaría mirando "mejor oferta $1.000" cuando ya hay una de $1.100, y
 * podría aceptar la equivocada creyendo que es la mejor.
 *
 * Aceptar sigue siendo seguro —el servidor valida y la aceptación es atómica—
 * pero "seguro" no alcanza: habría vendido a un precio que no eligió.
 *
 * Diez segundos: lo bastante seguido como para que un evento perdido se note
 * enseguida, y lo bastante espaciado como para no convertir el vivo en una
 * consulta por segundo.
 */
const RECONCILE_MS = 10_000;

/**
 * El estado de las pujas de un vivo: por socket, con reconciliación periódica.
 *
 * Se vuelve a pedir el estado entero en vez de aplicar el evento como parche
 * porque el servidor ya calcula el mínimo siguiente, quién lidera y cuánto
 * queda de reserva. Recalcularlo en el navegador sería una segunda
 * implementación de las mismas reglas, y la que se equivocaría no sería la del
 * servidor.
 */
export function useBidSessions(
  liveSessionId: string,
  initial: BidSessionDto[],
): { sessions: BidSessionDto[]; refresh: () => void } {
  const [sessions, setSessions] = useState<BidSessionDto[]>(initial);

  const refresh = useCallback(() => {
    void bidsForLive(liveSessionId).then(setSessions);
  }, [liveSessionId]);

  useEffect(() => {
    const timer = setInterval(refresh, RECONCILE_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { sessions, refresh };
}
