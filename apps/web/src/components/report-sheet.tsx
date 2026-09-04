'use client';

import { REPORT_REASONS, type ReportReason, type ReportTarget } from '@vivo/domain';
import { REPORT_REASON_LABEL } from '@vivo/shared';
import { Button, Sheet } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { blockUser, reportContent } from '@/lib/actions/moderation';

/**
 * Denunciar y, si querés, bloquear.
 *
 * Las dos juntas porque quien denuncia casi siempre además quiere dejar de ver
 * a esa persona, pero **son acciones separadas**: denunciar no bloquea y
 * bloquear no denuncia. La hoja lo dice con todas las letras, porque la
 * diferencia importa —una es privada e inmediata, la otra es una cola que mira
 * la administración— y confundirlas hace que la gente crea que denunciar
 * silencia al otro al instante.
 *
 * El texto de confirmación no promete que el contenido se baje. No se baja
 * solo: alguien lo tiene que mirar. Prometerlo y que siga ahí es peor que no
 * ofrecer el botón.
 */
export function ReportSheet({
  open,
  onClose,
  target,
  targetId,
  /** A quién se bloquea. Ausente cuando no hay una persona detrás. */
  authorId,
  authorName,
}: {
  open: boolean;
  onClose: () => void;
  target: ReportTarget;
  targetId: string;
  authorId?: string | null;
  authorName?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState<ReportReason | null>(null);
  const [detalle, setDetalle] = useState('');
  const [resultado, setResultado] = useState<{ ok: boolean; message: string } | null>(null);

  const cerrar = () => {
    setMotivo(null);
    setDetalle('');
    setResultado(null);
    onClose();
  };

  const enviar = () => {
    if (!motivo) return;
    startTransition(async () => {
      const r = await reportContent({ target, targetId, reason: motivo, detail: detalle });
      if (r.requiresAuth) {
        router.push(`/ingresar?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setResultado(r);
    });
  };

  const bloquear = () => {
    if (!authorId) return;
    startTransition(async () => {
      const r = await blockUser(authorId);
      if (r.requiresAuth) {
        router.push(`/ingresar?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setResultado(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <Sheet open={open} onClose={cerrar} title={authorName ? `Sobre ${authorName}` : 'Denunciar'}>
      <div className="flex flex-col gap-4 pb-2">
        {resultado ? (
          <div className="flex flex-col gap-3">
            <p
              role="status"
              className={
                resultado.ok
                  ? 'rounded-2xl bg-success/10 px-4 py-3 text-sm font-semibold text-success-ink'
                  : 'rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger'
              }
            >
              {resultado.message}
            </p>
            <Button variant="secondary" block onClick={cerrar}>
              Cerrar
            </Button>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-bold text-ink-soft">
                ¿Qué está pasando?
              </legend>
              {REPORT_REASONS.map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card has-[:checked]:ring-2 has-[:checked]:ring-brand"
                >
                  <input
                    type="radio"
                    name="motivo"
                    value={r}
                    checked={motivo === r}
                    onChange={() => setMotivo(r)}
                    className="size-4 accent-brand"
                  />
                  <span className="text-[15px] font-semibold">{REPORT_REASON_LABEL[r]}</span>
                </label>
              ))}
            </fieldset>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-bold text-ink-soft">
                Contanos más <span className="font-normal text-subtle">(opcional)</span>
              </span>
              <textarea
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                rows={3}
                maxLength={500}
                className="rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                placeholder="Qué pasó, si querés agregarlo."
              />
            </label>

            <Button block loading={pending} disabled={!motivo} onClick={enviar}>
              Enviar denuncia
            </Button>

            {authorId ? (
              <div className="flex flex-col gap-2 border-t border-line pt-4">
                {/* Separado del bloque de denuncia a propósito: son dos cosas
                    distintas y la persona tiene que poder hacer una sin la otra. */}
                <p className="text-[13px] text-subtle">
                  Bloquear es aparte y es inmediato: dejás de ver lo que escribe
                  {authorName ? ` ${authorName}` : ''}. No se entera.
                </p>
                <Button variant="secondary" block loading={pending} onClick={bloquear}>
                  Bloquear
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
