import type { Metadata } from 'next';
import { VerificationForm } from '@/components/seller/verification-form';
import { api, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Verificación' };
export const dynamic = 'force-dynamic';

/**
 * Verificación comercial.
 *
 * Una pantalla aparte y no un paso del alta: mezclarla con la creación de la
 * tienda la haría parecer obligatoria, que es exactamente lo contrario de lo
 * que es.
 */
export default async function SellerVerificationPage() {
  const client = await api();
  const current = await safe(client.verification.business(), null);

  return (
    <div className="flex flex-col gap-6 pt-safe">
      <header className="px-4 pt-3">
        <h1 className="text-[24px] font-extrabold tracking-tight">Verificación</h1>
        <p className="text-[13px] text-subtle">Opcional. Tu tienda funciona igual sin esto.</p>
      </header>

      <div className="px-4 pb-4">
        <VerificationForm current={current} />
      </div>
    </div>
  );
}
