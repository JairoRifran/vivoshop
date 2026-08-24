import type { ProtectionStatus } from '@vivo/domain';
import type { PaymentCapabilitiesDto } from '@vivo/shared';

/**
 * Lo que se le promete al comprador, y ni una palabra más.
 *
 * El texto sale del nivel que declara el proveedor de pagos, no de una
 * constante escrita a mano. Es la diferencia entre "tu dinero queda retenido
 * hasta que recibas el producto" —cierto solo si el proveedor retiene de
 * verdad— y "si algo sale mal, te devolvemos el dinero", que es lo que se
 * puede sostener con Checkout Pro.
 *
 * Con `level: 'none'` no se dibuja nada. Un escudo vacío sería peor que la
 * ausencia: promete sin decir qué.
 */
export function ProtectionNotice({
  capabilities,
  status,
  className,
}: {
  capabilities: PaymentCapabilitiesDto;
  /** Estado de esta compra. Ausente en pantallas previas a la compra. */
  status?: ProtectionStatus;
  className?: string;
}) {
  if (capabilities.level === 'none') return null;

  if (status === 'disputed') {
    return (
      <Frame className={className} tone="warning" icon="⏳">
        <p className="text-[14px] font-extrabold text-ink">Reclamo en curso</p>
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Estamos revisando lo que pasó con tu compra. Te escribimos apenas tengamos novedades.
        </p>
      </Frame>
    );
  }

  if (capabilities.level === 'full') {
    return (
      <Frame className={className} tone="success" icon="🛡️">
        <p className="text-[14px] font-extrabold text-ink">Compra Protegida</p>
        <p className="text-[13px] leading-relaxed text-ink-soft">
          {status === 'protected'
            ? 'Tu dinero queda retenido hasta que confirmes que recibiste el producto.'
            : 'Si comprás acá, tu dinero queda retenido hasta que confirmes que recibiste el producto.'}
        </p>
      </Frame>
    );
  }

  return (
    <Frame className={className} tone="success" icon="🛡️">
      <p className="text-[14px] font-extrabold text-ink">Compra protegida</p>
      <p className="text-[13px] leading-relaxed text-ink-soft">
        {/* Sin retención no se dice "retenido". Se dice lo que sí ocurre. */}
        Si algo sale mal con tu compra, podés pedir la devolución del dinero
        {capabilities.supportsDisputes ? ' y abrir un reclamo' : ''}.
      </p>
    </Frame>
  );
}

function Frame({
  children,
  tone,
  icon,
  className,
}: {
  children: React.ReactNode;
  tone: 'success' | 'warning';
  icon: string;
  className?: string;
}) {
  const background = tone === 'success' ? 'bg-success/8' : 'bg-warning/10';
  return (
    <div className={`flex items-start gap-3 rounded-3xl ${background} px-4 py-3 ${className ?? ''}`}>
      <span aria-hidden className="text-lg leading-none">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
