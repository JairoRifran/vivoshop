import {
  resolveTaxRuleFromConfig,
  type TaxConfig,
  type TaxRule,
  type TaxTreatment,
} from '@vivo/config';
import type { Product } from '../entities/catalog';
import { money, taxPortionOfGross, type Money } from '../value-objects/money';

/**
 * Tax resolution and calculation.
 *
 * The rule that matters: **nothing downstream may assume a country has one
 * rate**. A rate is always resolved from a category, and the category comes
 * from the product when it declares one, otherwise from the market default.
 *
 * That single indirection is what lets a reduced-rate product, an exempt
 * product, or a per-store override arrive later without touching `Order`,
 * because every order already stores the rule it was charged under.
 */
export function resolveTaxRule(config: TaxConfig, product?: Pick<Product, 'taxCategory'>): TaxRule {
  return resolveTaxRuleFromConfig(config, product?.taxCategory ?? null);
}

/**
 * What an order records about the tax it was charged.
 *
 * Persisted as a snapshot, never recomputed on read: a rate change next year
 * must not silently rewrite the history of what a buyer actually paid.
 */
export interface TaxSnapshot {
  readonly treatment: TaxTreatment;
  readonly rateBps: number;
  readonly amountMinor: number;
  readonly label: string;
  readonly category: string;
}

/**
 * Tax contained in, or added to, a gross amount under a given rule.
 *
 * `included` extracts (Uruguay quotes IVA inside the price), `added` computes
 * on top, `exempt` is zero. The caller decides what to do with the number;
 * this function never guesses.
 */
export function taxForAmount(gross: Money, rule: TaxRule): Money {
  if (rule.treatment === 'exempt' || rule.rateBps <= 0) return money(0, gross.currency);
  if (rule.treatment === 'included') return taxPortionOfGross(gross, rule.rateBps);
  return money(Math.round((gross.amountMinor * rule.rateBps) / 10_000), gross.currency);
}

/** True when the rule means the quoted price already contains the tax. */
export function isInclusive(rule: Pick<TaxRule, 'treatment'>): boolean {
  return rule.treatment === 'included' || rule.treatment === 'exempt';
}

/**
 * Collapses per-line rules into the single snapshot an order stores.
 *
 * When every line shares a rule — the overwhelmingly common case — the
 * snapshot keeps that rule verbatim. When an order mixes rates, the category
 * becomes `mixed` and the rate is the effective one, so a reader can still see
 * what was charged without re-deriving it from the lines.
 */
export function summarizeTax(
  parts: ReadonlyArray<{ rule: TaxRule; amountMinor: number; baseMinor: number }>,
): TaxSnapshot {
  const amountMinor = parts.reduce((total, part) => total + part.amountMinor, 0);
  const baseMinor = parts.reduce((total, part) => total + part.baseMinor, 0);

  const distinct = new Set(parts.map((part) => part.rule.category));
  const first = parts[0]?.rule;

  if (distinct.size <= 1 && first) {
    return {
      treatment: first.treatment,
      rateBps: first.rateBps,
      amountMinor,
      label: first.label,
      category: first.category,
    };
  }

  return {
    treatment: 'included',
    rateBps: baseMinor > 0 ? Math.round((amountMinor / baseMinor) * 10_000) : 0,
    amountMinor,
    label: first?.label ?? 'Impuestos',
    category: 'mixed',
  };
}
