'use client';

import type { BlockedPersonDto } from '@vivo/shared';
import { Avatar, Button } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { unblockUser } from '@/lib/actions/moderation';

/**
 * Las cuentas bloqueadas, con su botón para deshacerlo.
 *
 * Existe porque bloquear sin poder desbloquear no es una herramienta, es una
 * trampa: alguien bloquea de más en el calor de un vivo y después no encuentra
 * cómo volver atrás. La política de contenido de usuarios de Play pide el
 * bloqueo; que se pueda revertir lo pide el sentido común.
 *
 * La lista no dice por qué se bloqueó a nadie. No se guarda: bloquear es una
 * preferencia, no una acusación, y no hace falta justificarla.
 */
export function BlockedList({ people }: { people: BlockedPersonDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (people.length === 0) {
    return (
      <p className="rounded-3xl bg-surface px-4 py-5 text-center text-[14px] text-subtle shadow-card">
        No bloqueaste a nadie.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-line rounded-3xl bg-surface px-4 shadow-card">
      {people.map((persona) => (
        <li key={persona.id} className="flex items-center gap-3 py-3">
          <Avatar src={persona.avatarUrl} name={persona.name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold">{persona.name}</p>
            <p className="text-[12px] text-subtle">
              Desde el {new Date(persona.since).toLocaleDateString('es-UY')}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                await unblockUser(persona.id);
                router.refresh();
              })
            }
          >
            Desbloquear
          </Button>
        </li>
      ))}
    </ul>
  );
}
