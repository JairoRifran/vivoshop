'use server';

import { loginRequestSchema, registerRequestSchema } from '@vivo/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '../api';
import { clearToken, writeToken } from '../session';
import { failure, mediaKey, optionalText, success, text, type ActionState } from './shared';

function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

export async function signIn(_previous: ActionState, form: FormData): Promise<ActionState> {
  const parsed = loginRequestSchema.safeParse({
    email: text(form, 'email'),
    password: text(form, 'password'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Revisá los datos ingresados.',
      fieldErrors: zodFieldErrors(parsed.error.issues),
    };
  }

  try {
    const client = await api();
    const session = await client.auth.login(parsed.data);
    await writeToken(session.token, session.expiresAt);
  } catch (error) {
    return failure(error);
  }

  // Outside the try: `redirect` throws a control-flow signal that must not be
  // caught and reported as a failed sign-in.
  const next = text(form, 'next') || '/';
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signUp(_previous: ActionState, form: FormData): Promise<ActionState> {
  const phone = text(form, 'phone');
  const parsed = registerRequestSchema.safeParse({
    name: text(form, 'name'),
    email: text(form, 'email'),
    password: text(form, 'password'),
    ...(phone ? { phone } : {}),
    country: 'UY',
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Revisá los datos ingresados.',
      fieldErrors: zodFieldErrors(parsed.error.issues),
    };
  }

  try {
    const client = await api();
    const session = await client.auth.register(parsed.data);
    await writeToken(session.token, session.expiresAt);
  } catch (error) {
    return failure(error);
  }

  const next = text(form, 'next') || '/';
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signOut(): Promise<void> {
  await clearToken();
  revalidatePath('/', 'layout');
  redirect('/');
}

/**
 * Guarda el perfil: nombre, teléfono, una línea sobre quién es, y la foto.
 *
 * La foto llega como clave —no como URL— y el servidor comprueba que sea de
 * quien está en sesión antes de guardarla. Ver `ImageField` y `MediaService`.
 */
export async function updateProfile(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const client = await api();
    await client.auth.updateProfile({
      name: text(form, 'name'),
      phone: optionalText(form, 'phone'),
      bio: optionalText(form, 'bio'),
      avatarKey: mediaKey(form, 'avatarKey'),
    });
  } catch (error) {
    return failure(error);
  }

  // El avatar y el nombre se dibujan en el encabezado del perfil y en cada
  // mensaje del chat, así que no alcanza con revalidar esta pantalla.
  revalidatePath('/', 'layout');
  return success('Guardamos tu perfil.');
}
