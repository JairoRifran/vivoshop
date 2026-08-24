/**
 * Shared between Server Actions and the client components that render their
 * result, so it deliberately carries no `server-only` marker and no imports.
 */
export interface ActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
  readonly fieldErrors?: Record<string, string[]>;
  /** Set by actions whose caller needs the created resource. */
  readonly id?: string;
}

export const IDLE: ActionState = { status: 'idle' };
