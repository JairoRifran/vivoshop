/**
 * Tax rules.
 *
 * Deliberately not a tax engine. What it does provide is the shape a tax
 * engine would need: a rate is never assumed to be "the country's rate", it is
 * always resolved from a named category that a product, and later a store, can
 * point at. Adding a reduced rate or an exempt category is data, not a
 * refactor of `Order`.
 */
export type TaxTreatment = 'included' | 'added' | 'exempt';

export interface TaxRule {
  /** `included` means the displayed price already contains the tax. */
  readonly treatment: TaxTreatment;
  /** Basis points, so 2200 = 22%. Keeps tax maths in integers. */
  readonly rateBps: number;
  readonly label: string;
  /** Stable key persisted on every order line for auditability. */
  readonly category: string;
}

export const DEFAULT_TAX_CATEGORY = 'standard';

/**
 * Uruguay: IVA is quoted inside the price. The reduced and exempt categories
 * are real Uruguayan rates and exist so the model is exercised by more than
 * one value from day one.
 */
export const UY_TAX_RULES: Readonly<Record<string, TaxRule>> = {
  standard: { treatment: 'included', rateBps: 2200, label: 'IVA', category: 'standard' },
  reduced: { treatment: 'included', rateBps: 1000, label: 'IVA mínimo', category: 'reduced' },
  exempt: { treatment: 'exempt', rateBps: 0, label: 'Exento de IVA', category: 'exempt' },
};

export const AR_TAX_RULES: Readonly<Record<string, TaxRule>> = {
  standard: { treatment: 'included', rateBps: 2100, label: 'IVA', category: 'standard' },
  reduced: { treatment: 'included', rateBps: 1050, label: 'IVA reducido', category: 'reduced' },
  exempt: { treatment: 'exempt', rateBps: 0, label: 'Exento de IVA', category: 'exempt' },
};

export interface TaxConfig {
  readonly defaultCategory: string;
  readonly rules: Readonly<Record<string, TaxRule>>;
}

/** Falls back to the market default rather than throwing on an unknown key. */
export function resolveTaxRuleFromConfig(config: TaxConfig, category?: string | null): TaxRule {
  const requested = category ? config.rules[category] : undefined;
  const fallback = config.rules[config.defaultCategory];

  /* c8 ignore next */
  if (!fallback) throw new Error(`Market tax config has no "${config.defaultCategory}" rule`);
  return requested ?? fallback;
}
