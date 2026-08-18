/**
 * Money-safe amount range matching for routing rules.
 *
 * Uses `@paykernel/core` `toMinorUnits` (bigint) — NEVER float compare.
 */

import { toMinorUnits } from "@paykernel/core";
import type { RouteMatchCriteria, RoutingInput } from "./types";

/**
 * Resolve the input payment amount to a major-unit decimal string + currency.
 * String amounts inherit {@link RoutingInput.currency} when `amountCurrency`
 * is omitted. Returns null when the input has no amount or no currency
 * (range criteria then fail-closed only if the rule requires a range; see
 * {@link amountInRange}).
 */
export function resolveInputAmount(
  input: RoutingInput,
): { amount: string; currency: string } | null {
  if (input.amount === undefined) {
    return null;
  }
  if (typeof input.amount === "object" && input.amount !== null) {
    const amount = String(input.amount.amount).trim();
    const currency = String(input.amount.currency).trim();
    if (!amount || !currency) return null;
    return { amount, currency };
  }
  const amount = String(input.amount).trim();
  // P21-AMOUNT-RESOLVE: amountCurrency wins; otherwise inherit input.currency.
  const fromAmountCurrency =
    input.amountCurrency !== undefined
      ? String(input.amountCurrency).trim()
      : "";
  const fromInputCurrency =
    input.currency !== undefined ? String(input.currency).trim() : "";
  const currency = fromAmountCurrency || fromInputCurrency;
  if (!amount || !currency) return null;
  return { amount, currency };
}

/**
 * Inclusive amount range check using bigint minor units.
 *
 * Semantics:
 * - If the rule has neither amountMin nor amountMax → wildcard (true).
 * - If the rule has a range but input has no resolvable amount → false.
 * - Cross-currency (rule amountCurrency vs input currency) → false (no match).
 * - Invalid / unparseable amounts → false (fail-closed; no throw from matcher).
 *
 * Comparison is always via `toMinorUnits` bigint — never `Number` float.
 */
export function amountInRange(
  input: RoutingInput,
  match: RouteMatchCriteria,
): boolean {
  const hasMin = match.amountMin !== undefined;
  const hasMax = match.amountMax !== undefined;
  if (!hasMin && !hasMax) {
    return true;
  }

  const ruleCurrency =
    match.amountCurrency !== undefined
      ? String(match.amountCurrency).trim()
      : "";
  if (!ruleCurrency) {
    // Range specified without currency — cannot safely compare.
    return false;
  }

  const resolved = resolveInputAmount(input);
  if (!resolved) {
    return false;
  }

  if (
    normalizeCurrency(resolved.currency) !== normalizeCurrency(ruleCurrency)
  ) {
    return false;
  }

  // ROUTE-1: zero / setup / trial amounts must match rules with min/max 0.
  // Core money defaults reject zero; routing intentionally allows it here.
  const zeroOk = { allowZero: true as const };

  let inputMinor: bigint;
  try {
    inputMinor = toMinorUnits(resolved.amount, ruleCurrency, zeroOk);
  } catch {
    return false;
  }

  if (hasMin && match.amountMin !== undefined) {
    try {
      const minMinor = toMinorUnits(
        String(match.amountMin).trim(),
        ruleCurrency,
        zeroOk,
      );
      if (inputMinor < minMinor) return false;
    } catch {
      return false;
    }
  }

  if (hasMax && match.amountMax !== undefined) {
    try {
      const maxMinor = toMinorUnits(
        String(match.amountMax).trim(),
        ruleCurrency,
        zeroOk,
      );
      if (inputMinor > maxMinor) return false;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * True when select-time fallback would dishonestly bypass configured amount
 * bounds (ROUTE-1 / P21-AMOUNT-RESOLVE):
 * - Rule has amount min/max **without** `amountCurrency` (misconfigured bound)
 * - Input amount is missing, unparseable, or invalid against a range whose
 *   currency is present (or inherited onto the input via {@link resolveInputAmount})
 * - Input amount is resolvable in the **same** currency and outside inclusive min/max
 *
 * Cross-currency with a **resolvable** different currency is **not** an
 * amount-range honesty violation (other criteria; fallback may still apply).
 */
export function amountOutsideConfiguredRange(
  input: RoutingInput,
  match: RouteMatchCriteria,
): boolean {
  const hasMin = match.amountMin !== undefined;
  const hasMax = match.amountMax !== undefined;
  if (!hasMin && !hasMax) {
    return false;
  }

  const ruleCurrency =
    match.amountCurrency !== undefined
      ? String(match.amountCurrency).trim()
      : "";
  if (!ruleCurrency) {
    // ROUTE-1: amount min/max without amountCurrency is a misconfigured money
    // bound. Treat as an honesty violation so select-time fallback cannot
    // silently accept amounts the rule intended to constrain.
    return true;
  }

  const resolved = resolveInputAmount(input);
  if (!resolved) {
    // P21-AMOUNT-RESOLVE: configured range + missing/unresolvable amount must
    // not be silently accepted by unconstrained select-time fallback.
    return true;
  }

  if (
    normalizeCurrency(resolved.currency) !== normalizeCurrency(ruleCurrency)
  ) {
    return false;
  }

  const zeroOk = { allowZero: true as const };

  let inputMinor: bigint;
  try {
    inputMinor = toMinorUnits(resolved.amount, ruleCurrency, zeroOk);
  } catch {
    // Invalid / unparseable input amount (e.g. JPY "10.50") is an honesty
    // violation — fallback must not treat "cannot compare" as unconstrained.
    return true;
  }

  if (hasMin && match.amountMin !== undefined) {
    try {
      const minMinor = toMinorUnits(
        String(match.amountMin).trim(),
        ruleCurrency,
        zeroOk,
      );
      if (inputMinor < minMinor) return true;
    } catch {
      return true;
    }
  }

  if (hasMax && match.amountMax !== undefined) {
    try {
      const maxMinor = toMinorUnits(
        String(match.amountMax).trim(),
        ruleCurrency,
        zeroOk,
      );
      if (inputMinor > maxMinor) return true;
    } catch {
      return true;
    }
  }

  return false;
}

/**
 * Compare two major-unit decimal strings in the same currency using bigint.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Throws if either amount is invalid.
 */
export function compareDecimalAmounts(
  a: string,
  b: string,
  currency: string,
): number {
  const aMinor = toMinorUnits(a.trim(), currency);
  const bMinor = toMinorUnits(b.trim(), currency);
  if (aMinor < bMinor) return -1;
  if (aMinor > bMinor) return 1;
  return 0;
}

function normalizeCurrency(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Currency declared on the payment amount itself — Money.currency or
 * {@link RoutingInput.amountCurrency}. Does **not** inherit
 * {@link RoutingInput.currency} (inheritance cannot conflict).
 */
export function resolveDeclaredAmountCurrency(
  input: RoutingInput,
): string | undefined {
  if (typeof input.amount === "object" && input.amount !== null) {
    const currency = String(input.amount.currency).trim();
    return currency.length > 0 ? currency : undefined;
  }
  if (input.amountCurrency !== undefined) {
    const currency = String(input.amountCurrency).trim();
    return currency.length > 0 ? currency : undefined;
  }
  return undefined;
}

/**
 * NEW-ROUTE-CCY-1: `input.currency` and the declared amount currency are
 * both present and differ (case-insensitive after trim). Incomplete money
 * (missing either side) is not a conflict.
 */
export function inputCurrenciesConflict(input: RoutingInput): boolean {
  if (input.currency === undefined) return false;
  const declared = input.currency.trim();
  if (!declared) return false;
  const amountCurrency = resolveDeclaredAmountCurrency(input);
  if (amountCurrency === undefined) return false;
  return normalizeCurrency(declared) !== normalizeCurrency(amountCurrency);
}
