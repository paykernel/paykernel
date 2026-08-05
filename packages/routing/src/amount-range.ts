/**
 * Money-safe amount range matching for routing rules.
 *
 * Uses `@paykernel/core` `toMinorUnits` (bigint) — NEVER float compare.
 */

import { toMinorUnits } from "@paykernel/core";
import type { RouteMatchCriteria, RoutingInput } from "./types";

/**
 * Resolve the input payment amount to a major-unit decimal string + currency.
 * Returns null when the input has no amount (range criteria then fail-closed
 * only if the rule requires a range; see {@link amountInRange}).
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
  const currency =
    input.amountCurrency !== undefined
      ? String(input.amountCurrency).trim()
      : "";
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
 * bounds (ROUTE-1):
 * - Rule has amount min/max **without** `amountCurrency` (misconfigured bound)
 * - Or input amount is resolvable in the **same** currency and outside
 *   inclusive min/max
 *
 * Cross-currency, missing amount, or invalid decimals return false when the
 * rule currency is present (those are not amount-range honesty violations —
 * fallback may still apply for non-matching criteria).
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
    return false;
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
    return false;
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
      if (inputMinor > maxMinor) return true;
    } catch {
      return false;
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
