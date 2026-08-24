import type { StoreId } from '../value-objects/identifiers';

/**
 * La cuenta con la que un vendedor cobra.
 *
 * Modelo marketplace: el dinero va a la cuenta del vendedor, no a la de
 * VivoShop, y la plataforma retiene su comisión en el mismo movimiento. Eso
 * evita que VivoShop sea depositario de plata ajena, que es un problema legal
 * antes que técnico.
 *
 * ## Sobre los tokens
 *
 * `accessToken` y `refreshToken` **nunca salen del servidor**. No van en un
 * DTO, no van en un log, no van al navegador. Lo que el frontend puede saber es
 * si la cuenta está conectada y a nombre de quién — nada más. Están declarados
 * acá porque el dominio necesita razonar sobre su vencimiento; leerlos es
 * privilegio de la capa de infraestructura.
 */

export const SELLER_ACCOUNT_STATUSES = ['disconnected', 'connected', 'expired', 'revoked'] as const;
export type SellerAccountStatus = (typeof SELLER_ACCOUNT_STATUSES)[number];

export interface SellerPaymentAccount {
  readonly storeId: StoreId;
  /** Clave del `PaymentProvider`, p. ej. `mercadopago`. */
  readonly provider: string;
  readonly status: SellerAccountStatus;
  /**
   * Id de la cuenta del vendedor **en el proveedor**. Es lo único de esta
   * entidad que puede viajar a otro sistema, y aun así no se muestra al público.
   */
  readonly externalAccountId: string | null;
  /** Nombre o correo con el que quedó conectada, para que el vendedor confirme
   *  que es la cuenta que quería. */
  readonly externalAccountLabel: string | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
  readonly connectedAt: Date | null;
  readonly updatedAt: Date;
}

/**
 * Margen para refrescar antes de que venza.
 *
 * Cinco minutos: suficiente para que un token no expire en medio de un cobro,
 * y no tanto como para renovar sin necesidad en cada consulta.
 */
export const TOKEN_REFRESH_SKEW_SECONDS = 300;

export function needsRefresh(
  account: Pick<SellerPaymentAccount, 'expiresAt' | 'refreshToken'>,
  now: Date = new Date(),
): boolean {
  if (!account.refreshToken || !account.expiresAt) return false;
  return account.expiresAt.getTime() - now.getTime() <= TOKEN_REFRESH_SKEW_SECONDS * 1000;
}

/** Si esta cuenta puede recibir un cobro ahora mismo. */
export function canCollect(
  account: Pick<SellerPaymentAccount, 'status' | 'accessToken'>,
): boolean {
  return account.status === 'connected' && Boolean(account.accessToken);
}

/**
 * Lo único que puede ver el navegador.
 *
 * Existe como tipo aparte —y no como un `Omit<>`— para que agregar un campo
 * secreto a la cuenta no lo filtre por descuido a la vista pública.
 */
export interface SellerPaymentAccountView {
  readonly provider: string;
  readonly status: SellerAccountStatus;
  readonly accountLabel: string | null;
  readonly connectedAt: Date | null;
}

export function toAccountView(account: SellerPaymentAccount): SellerPaymentAccountView {
  return {
    provider: account.provider,
    status: account.status,
    accountLabel: account.externalAccountLabel,
    connectedAt: account.connectedAt,
  };
}

/**
 * El `state` anti-CSRF del OAuth.
 *
 * Sin esto, cualquiera puede inducir a un vendedor a conectar la cuenta de otro
 * a su tienda. Se emite antes de mandar a la persona al proveedor, se guarda
 * del lado del servidor y se consume **una sola vez** al volver.
 */
export interface OAuthState {
  readonly state: string;
  readonly storeId: StoreId;
  readonly provider: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/** Diez minutos: alcanza para autorizar sin dejar la ventana abierta. */
export const OAUTH_STATE_TTL_SECONDS = 600;

export function isOAuthStateUsable(state: OAuthState, now: Date = new Date()): boolean {
  return state.consumedAt === null && state.expiresAt.getTime() > now.getTime();
}
