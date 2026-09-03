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

/**
 * Pide el enlace para restablecer la contraseña.
 *
 * Devuelve éxito **siempre**, exista o no la cuenta — la API hace lo mismo. Si
 * la pantalla distinguiera, el formulario sería un padrón de quién tiene cuenta
 * acá. El mensaje dice "si esa dirección tiene cuenta", que es cierto y no
 * revela nada.
 */
export async function requestPasswordReset(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const client = await api();
    await client.request('POST', '/auth/password/forgot', { email: text(form, 'email') });
  } catch (error) {
    return failure(error);
  }

  return success('Si esa dirección tiene una cuenta, te mandamos un correo con el enlace.');
}

/** Elige una contraseña nueva con el enlace del correo. */
export async function resetPassword(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const client = await api();
    await client.request('POST', '/auth/password/reset', {
      token: text(form, 'token'),
      password: text(form, 'password'),
    });
  } catch (error) {
    return failure(error);
  }

  return success('Listo. Ya podés ingresar con tu contraseña nueva.');
}

/**
 * Cambia la contraseña estando adentro.
 *
 * Después de cambiarla, **esta sesión también muere**: el servidor corta todas
 * las anteriores al cambio, y la que hizo el cambio se emitió antes. Así que se
 * borra la cookie y se manda a ingresar de nuevo, que es honesto —lo contrario
 * sería una pantalla que funciona hasta que deja de funcionar sin explicación—.
 */
export async function changePassword(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const current = text(form, 'currentPassword');

  try {
    const client = await api();
    await client.request('POST', '/auth/password/change', {
      ...(current ? { currentPassword: current } : {}),
      password: text(form, 'password'),
    });
  } catch (error) {
    return failure(error);
  }

  await clearToken();
  redirect('/ingresar?motivo=contrasena');
}

/**
 * Borra la cuenta.
 *
 * Termina igual que cambiar la contraseña —cookie borrada y redirección— y por
 * el mismo motivo técnico: anonimizar fecha el corte de sesiones, así que el
 * token que hizo la petición ya está muerto. Dejarlo en el navegador solo
 * lograría que la siguiente pantalla diera 401.
 */
export async function deleteAccount(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const client = await api();
    await client.request('POST', '/auth/account/delete', {
      confirmation: text(form, 'confirmation'),
    });
  } catch (error) {
    return failure(error);
  }

  await clearToken();
  redirect('/?cuenta=eliminada');
}
