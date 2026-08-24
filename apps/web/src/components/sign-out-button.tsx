'use client';

import { Button } from '@vivo/ui';
import { useTransition } from 'react';
import { signOut } from '@/lib/actions/auth';

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      block
      loading={pending}
      onClick={() => startTransition(() => signOut())}
      className="mt-1 text-danger hover:bg-danger/8"
    >
      Cerrar sesión
    </Button>
  );
}
