'use client';

import type { UserDto } from '@vivo/shared';
import { Button, TextArea, TextInput } from '@vivo/ui';
import { useActionState } from 'react';
import { ImageField } from '@/components/image-field';
import { updateProfile } from '@/lib/actions/auth';
import { IDLE } from '@/lib/actions/state';

export function ProfileForm({ user }: { user: UserDto }) {
  const [state, action, pending] = useActionState(updateProfile, IDLE);

  return (
    <form action={action} className="flex flex-col gap-5 rounded-3xl bg-surface p-4 shadow-card">
      {state.status === 'success' && state.message ? (
        <p
          role="status"
          className="rounded-2xl bg-success/10 px-4 py-3 text-sm font-semibold text-success-ink"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger"
        >
          {state.message}
        </p>
      ) : null}

      <ImageField
        name="avatarKey"
        purpose="avatar"
        label="Foto de perfil"
        shape="circle"
        currentUrl={user.avatarUrl}
        hint="Cuadrada. La recortamos y achicamos acá mismo antes de subirla."
        fallback={
          <span className="text-[18px] font-extrabold text-subtle">{initials(user.name)}</span>
        }
      />

      <TextInput label="Nombre" name="name" defaultValue={user.name} required maxLength={80} />
      <TextInput
        label="Teléfono"
        name="phone"
        type="tel"
        inputMode="tel"
        defaultValue={user.phone ?? ''}
        hint="Para que quien te vende pueda coordinar una entrega."
      />
      <TextArea
        label="Sobre vos"
        name="bio"
        rows={3}
        maxLength={280}
        defaultValue={user.bio ?? ''}
        placeholder="Una línea sobre quién sos o qué vendés."
      />

      <Button type="submit" block loading={pending}>
        Guardar
      </Button>
    </form>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
