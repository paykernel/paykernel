/**
 * PCI fence for the customer / stored-method surface (Phase 22.1).
 *
 * Walks the params tree and rejects raw cardholder data:
 * - Card-like keys (`number`, `pan`, `cardNumber`, …) reject 13–19 digit
 *   PAN-shaped values without a Luhn check; CVC keys also reject 3–4 digits.
 *   `number` nested under `account` (Moyasar AFT `sender.account.number`) is
 *   not a card key — bank-account digits use the other-key rule.
 * - Other keys reject a bare 13–19 digit integer only when it is Luhn-valid
 *   and length 15 or 16, or when the original string is grouped with spaces
 *   or dashes (e.g. `4242-4242-4242-4242`). Millisecond timestamps pass.
 * - Every string leaf is scanned for embedded 15–16 digit Luhn PANs and
 *   track data (`%B` / leading `;` + 13–19 digits).
 * Tokenized gateway ids (`pm_`, `tok_`, `cus_`, `pi_`, `cs_`, `dp_`, `ch_`,
 * `sk_`, `pk_`) are not treated as PAN. Raw `source.type === "creditcard"`
 * and Moyasar `moyasarSource.type === "creditcard"` stay rejected; other
 * Moyasar sources (applepay DPAN / token CVC) are skipped.
 */

import { InvalidRequestError } from "../errors";

const PAN_DIGITS = /^\d{13,19}$/;
const CVC_DIGITS = /^\d{3,4}$/;
const GATEWAY_ID_PREFIX = /^(pm_|tok_|cus_|pi_|cs_|dp_|ch_|sk_|pk_)/i;
/** Digit run that may be an embedded PAN (13–19 digits, optional spaces/dashes). */
const EMBEDDED_PAN_RUN = /\d[\d\s-]{11,21}\d/g;
/** Maximal 13–19 digit token; greedy so 17–19 digit ids are not sliced to 15–16. */
const CONTIGUOUS_DIGIT_RUN = /\d{13,19}/g;
/** Track1 `%B`+PAN or Track2 `;PAN=`. Leading `;`+digits is matched separately. */
const TRACK_DATA = /(?:%B\d{13,19}|;\d{13,19}=)/i;
const TRACK_LEADING = /^;\d{13,19}/;

const CARD_PAN_KEYS = new Set([
  "number",
  "pan",
  "cardnumber",
  "card_number",
]);

/** Moyasar backend-safe source types (skip DPAN / token CVC). Missing type is walked. */
const MOYASAR_BACKEND_SAFE_SOURCE_TYPES = new Set([
  "token",
  "applepay",
  "samsungpay",
  "stcpay",
]);

const CVC_KEYS = new Set([
  "cvc",
  "cvv",
  "cid",
  "securitycode",
  "security_code",
  "cvc2",
  "cvv2",
  "cardcvc",
  "card_cvc",
  "cardcvv",
  "card_cvv",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGatewayIdLeaf(value: string): boolean {
  return GATEWAY_ID_PREFIX.test(value.trim());
}

function isCvcKey(key: string): boolean {
  return CVC_KEYS.has(key);
}

function isAftAccountNumberKey(
  key: string,
  parentKey: string | undefined,
): boolean {
  return key === "number" && parentKey === "account";
}

function isCardPanKey(key: string, parentKey: string | undefined): boolean {
  // AFT / bank `account.number` is not a card PAN field.
  if (isAftAccountNumberKey(key, parentKey)) {
    return false;
  }
  return CARD_PAN_KEYS.has(key);
}

function isCardLikeKey(key: string, parentKey: string | undefined): boolean {
  return isCardPanKey(key, parentKey) || CVC_KEYS.has(key);
}

/** Luhn checksum; `4242424242424242` is valid. Empty / non-digit strings are not. */
function luhnValid(digits: string): boolean {
  if (digits.length === 0 || !/^\d+$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (doubleIt) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}

function isCvcLike(value: unknown): boolean {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return false;
    }
    return CVC_DIGITS.test(String(Math.abs(value)));
  }
  if (typeof value !== "string") {
    return false;
  }
  const digits = value.replace(/[\s-]/g, "");
  return CVC_DIGITS.test(digits);
}

function panDigitsFrom(value: unknown): string | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return undefined;
    }
    const digits = String(Math.abs(value));
    return PAN_DIGITS.test(digits) ? digits : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const digits = value.replace(/[\s-]/g, "");
  return PAN_DIGITS.test(digits) ? digits : undefined;
}

function hasInternalGrouping(value: string): boolean {
  return /[\s-]/.test(value.trim());
}

function containsTrackData(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "");
  return TRACK_LEADING.test(compact) || TRACK_DATA.test(compact);
}

function isClassicPanDigits(digits: string): boolean {
  return (
    (digits.length === 15 || digits.length === 16) && luhnValid(digits)
  );
}

function containsEmbeddedClassicPan(value: string): boolean {
  CONTIGUOUS_DIGIT_RUN.lastIndex = 0;
  const contiguous = value.match(CONTIGUOUS_DIGIT_RUN);
  if (contiguous?.some((run) => isClassicPanDigits(run))) {
    return true;
  }
  EMBEDDED_PAN_RUN.lastIndex = 0;
  const runs = value.match(EMBEDDED_PAN_RUN);
  if (!runs) {
    return false;
  }
  return runs.some((run) => isClassicPanDigits(run.replace(/[\s-]/g, "")));
}

function leafLooksLikeRawCard(
  key: string | undefined,
  value: unknown,
  parentKey: string | undefined,
): boolean {
  const normalizedKey = key?.toLowerCase() ?? "";
  const normalizedParent =
    parentKey !== undefined ? parentKey.toLowerCase() : undefined;
  const gatewayId = typeof value === "string" && isGatewayIdLeaf(value);

  if (isCvcKey(normalizedKey) && isCvcLike(value)) {
    return true;
  }

  if (!gatewayId) {
    const digits = panDigitsFrom(value);
    if (digits !== undefined) {
      if (isCardLikeKey(normalizedKey, normalizedParent)) {
        return true;
      }
      // Grouped 13–19 digit strings look like PAN (4242-4242-…). Bank
      // `account.number` may be grouped too — only Luhn 15–16 / track/embed.
      if (
        !isAftAccountNumberKey(normalizedKey, normalizedParent) &&
        typeof value === "string" &&
        hasInternalGrouping(value)
      ) {
        return true;
      }
      if (
        (digits.length === 15 || digits.length === 16) &&
        luhnValid(digits)
      ) {
        return true;
      }
    }
  }

  if (typeof value === "string") {
    return containsTrackData(value) || containsEmbeddedClassicPan(value);
  }
  return false;
}

/**
 * True when `params` carries raw cardholder data this SDK must never persist.
 * Deep-walks records and arrays; inspects string/number leaves with key-aware
 * PAN/CVC rules plus an embedded-PAN / track-data scan. Also rejects
 * `source.type === "creditcard"`.
 */
function containsRawCardMaterial(params: unknown): boolean {
  return walkRawCardMaterial(params, new WeakSet());
}

function walkRawCardMaterial(
  value: unknown,
  seen: WeakSet<object>,
  key?: string,
  parentKey?: string,
): boolean {
  if (value === null || typeof value !== "object") {
    return leafLooksLikeRawCard(key, value, parentKey);
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (walkRawCardMaterial(item, seen, key, parentKey)) {
        return true;
      }
    }
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (isRecord(rec.source) && rec.source.type === "creditcard") {
    return true;
  }
  // Moyasar backend-safe sources (token / applepay DPAN / samsungpay / stcpay)
  // carry network-token material that is PAN-shaped. Reject only raw creditcard.
  if (isRecord(rec.moyasarSource) && rec.moyasarSource.type === "creditcard") {
    return true;
  }
  for (const [childKey, child] of Object.entries(rec)) {
    if (
      childKey === "moyasarSource" &&
      isRecord(child) &&
      typeof child.type === "string" &&
      MOYASAR_BACKEND_SAFE_SOURCE_TYPES.has(child.type)
    ) {
      continue;
    }
    if (walkRawCardMaterial(child, seen, childKey, key)) {
      return true;
    }
  }
  return false;
}

/** Throw {@link InvalidRequestError} when params carry PAN-like cardholder data. */
export function assertNoRawCardMaterial(params: unknown): void {
  if (containsRawCardMaterial(params)) {
    throw new InvalidRequestError(
      "Raw card details (PAN/CVC) are not accepted. Use a tokenized payment method; this SDK does not store PCI card data.",
    );
  }
}
