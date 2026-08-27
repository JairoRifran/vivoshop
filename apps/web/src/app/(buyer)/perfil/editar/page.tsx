import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ProfileForm } from '@/components/profile-form';
import { getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Editar perfil' };
export const dynamic = 'force-dynamic';

export default async function EditProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/ingresar?next=%2Fperfil%2Feditar');

  return (
    <div className="flex flex-col gap-5 px-4 pt-safe">
      <header className="pt-2">
        <h1 className="text-[24px] font-extrabold tracking-tight">Editar perfil</h1>
        <p className="text-[13px] text-subtle">Así te ven quienes te compran o te venden.</p>
      </header>

      <ProfileForm user={user} />
    </div>
  );
}
