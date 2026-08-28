// file: packages/core/src/utils/idempotency.ts

/**
 * Application-level idempotency primitives.
 *
 * Some gateway endpoints (notably Moyasar refund/capture/void) have no native
 * idempotency. Without a guard, a caller retrying a failed mutation can apply
 * it twice (e.g. refund the customer twice). An injectable store lets callers
 * deduplicate those mutations across retries — and, with an atomic `reserve`
 * backed by Redis/SQL, across processes.
 */

import { sha256Hex } from "../runtime/crypto-portable";
import { stripAbortSignal } from "../runtime/abort";
import { redact } from "./logger";
import { isMoney, money } from "./money";

type MaybePromise<T> = T | Promise<T>;

export type IdempotencyStatus = "in_progress" | "completed" | "unknown";

export interface IdempotencyRecord {
  /** Lifecycle state of the guarded operation. */
  status: IdempotencyStatus;
  /** Hash of the request parameters, to detect key reuse with different input. */
  fingerprint: string;
  /** Epoch millis when the record was created. */
  createdAt: number;
  /** Cached successful result, present only when status is "completed". */
  result?: unknown;
}

export interface IdempotencyStore {
  get(key: string): MaybePromise<IdempotencyRecord | undefined>;
  set(key: string, record: IdempotencyRecord): MaybePromise<void>;
  delete(key: string): MaybePromise<void>;
  /**
   * Atomic reservation. Implement with Redis `SET NX`, a database
   * unique constraint, or equivalent to prevent duplicate cross-worker calls.
   * Store the supplied in-progress record and return undefined when the key is
   * free; return the existing record when it is already reserved.
   */
  reserve(
    key: string,
    record: IdempotencyRecord,
  ): MaybePromise<IdempotencyRecord | undefined>;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Deep-clone an idempotency record so callers and the store never share
 * mutable references (including nested `result` graphs).
 */
function cloneIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
  let result: unknown;
  if ("result" in record) {
    result = cloneUnknown(record.result);
  }

  const cloned: IdempotencyRecord = {
    status: record.status,
    fingerprint: record.fingerprint,
    createdAt: record.createdAt,
  };
  if ("result" in record) {
    cloned.result = result;
  }
  return cloned;
}

function cloneUnknown(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    // Non-cloneable values (functions, DOM nodes, etc.): best-effort JSON.
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      // MONEY-4: never fall back to a shared live reference — callers mutating
      // `result` would poison the in-memory fence / store entry.
      throw new Error(
        "Idempotency result is not cloneable (structuredClone and JSON both failed); " +
          "refusing to store or return a shared mutable reference",
      );
    }
  }
}

/**
 * Simple in-memory idempotency store with a bounded size.
 * Suitable for a single long-lived process; provide a shared store (Redis/SQL)
 * for multi-worker or serverless deployments.
 *
 * Memory is capped at `maxEntries`. **MONEY-2 (TTL honesty):** every
 * {@link IdempotencyStatus} (`in_progress`, `completed`, and `unknown` after
 * indeterminate mutations) is a **protected fence** — never TTL-evicted and never
 * dropped under capacity pressure. The constructor `ttlMs` is retained only for
 * diagnostics / future non-fence statuses and is **not** used for eviction today;
 * fences stay readable past any recorded `expiresAt` until explicit `delete`.
 * When the store is full, new keys are refused (throw) so double-refund/capture
 * guards cannot silently disappear. Records from `get`/`reserve` and stored by
 * `set` are cloned so callers cannot mutate the live cache.
 *
 * Prefer a shared store (Redis/SQL) for multi-worker or high-cardinality keys;
 * this in-memory store prioritizes fence integrity over automatic reclamation.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<
    string,
    { record: IdempotencyRecord; expiresAt: number }
  >();

  /**
   * @param ttlMs - Retained for API compatibility / diagnostics only (MONEY-2).
   *   Does **not** evict protected fences; records remain until `delete`.
   * @param maxEntries - Hard cap; new keys throw when full of fences.
   */
  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  get(key: string): IdempotencyRecord | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    // MONEY-2: all statuses are protected fences — return past TTL until delete.
    return cloneIdempotencyRecord(entry.record);
  }

  set(key: string, record: IdempotencyRecord): void {
    const isUpdate = this.entries.has(key);

    // Capacity only applies to new keys; updates replace in place.
    if (!isUpdate && this.entries.size >= this.maxEntries) {
      throw new Error(
        "InMemoryIdempotencyStore at capacity with protected fence keys " +
          "(in_progress/completed/unknown); refusing new key to preserve " +
          "mutation guards (raise maxEntries or use a shared store)",
      );
    }

    // Re-insert on update so Map iteration order reflects last write.
    if (isUpdate) {
      this.entries.delete(key);
    }

    const stored = Object.freeze(cloneIdempotencyRecord(record));
    this.entries.set(key, {
      record: stored,
      // retained for diagnostics / future non-fence statuses; not used for eviction
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  reserve(key: string, record: IdempotencyRecord): IdempotencyRecord | undefined {
    const existing = this.get(key);
    if (existing) {
      return existing;
    }
    this.set(key, record);
    return undefined;
  }

  /** Number of live entries. Exposed for diagnostics/tests. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Canonical stringify for fingerprint inputs (sorted keys, Money collapse,
 * distinct `undefined`/`null`/`Date`/`NaN` tags). Used by tests; persisted
 * store records must use {@link fingerprintParams} (SHA-256 digest).
 */
export function stableStringifyParams(value: unknown): string {
  return stableStringify(value);
}

/**
 * Produce a stable fingerprint for arbitrary request params, with object keys
 * sorted so equivalent payloads hash identically regardless of key order.
 *
 * Persisted value is `sha256Hex(stableStringify(redactForFingerprint(stripAbortSignal(value))))`
 * (S19-FINGERPRINT / S20-FINGERPRINT-REDACT) so stores never keep raw PII /
 * billing payloads. Sensitive leaves are hashed (not constant `[REDACTED]`) so
 * two OTPs / billing bags cannot collide. AbortSignal is omitted so live abort
 * objects are not part of business-params identity.
 *
 * `undefined` and `null` are encoded distinctly so omitting a field (or an
 * explicit `undefined`) does not collide with an explicit `null`.
 *
 * Money / AmountInput shapes are canonicalized so economically identical
 * amounts fingerprint the same way, e.g. `money("10.50","SAR")`,
 * `{ amount: "10.50", currency: "SAR" }`, and `{ amount: 10.5, currency: "SAR" }`.
 * Duck-typed bags with extra keys keep those siblings (orderId, etc.) so they
 * cannot collide after amount/currency normalization.
 *
 * Non-JSON primitives use unquoted type tags so they never equal the JSON
 * encoding of ordinary strings: `NaN`/`Infinity`/`undefined`/`bigint` do not
 * collide with `"NaN"` / `"Infinity"` / `"undefined"` / `"10n"`. `Date` uses
 * an unquoted `__date__:` tag so it never collides with the same ISO-8601
 * string (MONEY-2).
 */
export function fingerprintParams(value: unknown): string {
  return sha256Hex(
    stableStringify(
      redactForFingerprint(stripAbortSignalsForFingerprint(value)),
    ),
  );
}

function isAbortSignalValue(value: unknown): boolean {
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) {
    return true;
  }
  if (value == null || typeof value !== "object" || value instanceof Date) {
    return false;
  }
  const candidate = value as {
    aborted?: unknown;
    addEventListener?: unknown;
  };
  return (
    typeof candidate.aborted === "boolean" &&
    typeof candidate.addEventListener === "function"
  );
}

/**
 * Drop AbortSignal values (top-level `signal` via {@link stripAbortSignal},
 * plus nested instances) so caller abort controllers are not identity.
 */
function stripAbortSignalsForFingerprint(value: unknown): unknown {
  if (isAbortSignalValue(value)) {
    return undefined;
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripAbortSignalsForFingerprint);
  }

  const { rest } = stripAbortSignal(value);
  if (rest == null || typeof rest !== "object" || rest instanceof Date) {
    return rest;
  }
  if (Array.isArray(rest)) {
    return rest.map(stripAbortSignalsForFingerprint);
  }

  const record = rest as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    const nested = record[key];
    if (isAbortSignalValue(nested)) {
      continue;
    }
    cleaned[key] = stripAbortSignalsForFingerprint(nested);
  }
  return cleaned;
}

/**
 * Payment/ops identifier keys (logger allow-list). 13–19 digit values here are
 * gateway ids, not PANs — do not hash them as card numbers (S20-FINGERPRINT-REDACT).
 */
const FINGERPRINT_IDENTITY_KEYS = new Set([
  "gatewaypaymentid",
  "orderid",
  "paymentid",
  "gatewayid",
  "captureid",
  "refundid",
  "voidid",
  "customerid",
  "merchantid",
  "sessionid",
  "requestid",
  "correlationid",
  "traceid",
  "spanid",
  "idempotencykey",
  "authorizationid",
  "operationid",
  "providerrequestid",
  "providerobjectid",
  "internalreference",
  "inboxeventkey",
  "eventkey",
]);

function isFingerprintIdentityKey(key: string): boolean {
  return FINGERPRINT_IDENTITY_KEYS.has(key.toLowerCase());
}

function isDigitRunId(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  return digits.length >= 13 && digits.length <= 19 && /^\d+$/.test(digits);
}

function isSensitiveFingerprintKey(key: string): boolean {
  const probe = redact({ [key]: 0 }) as Record<string, unknown>;
  return probe[key] === "[REDACTED]";
}

function isOpaqueSensitiveFingerprintString(value: string): boolean {
  return redact(value) === "[REDACTED]";
}

/**
 * Replace a sensitive leaf with a typed hash so PII is not in the digest
 * plaintext, but distinct values still produce distinct fingerprints.
 */
function hashedFingerprintLeaf(value: unknown): string {
  return `[REDACTED:${sha256Hex(stableStringify(value))}]`;
}

/**
 * Money majors can be 13–19 digits (JPY 1e12). Value-level PAN hashing
 * before {@link stableStringify} canonicalize would split number vs string
 * vs trailing-zero bags of the same economic amount (C-R8-FINGERPRINT-MONEY-PAN).
 */
function isFingerprintMoneyAmountLeaf(
  key: string,
  parent: Record<string, unknown>,
): boolean {
  return key === "amount" && typeof parent.currency === "string";
}

/**
 * Logger {@link redact} is correct for logs (constant `[REDACTED]`) but wrong
 * for idempotency identity: two OTPs / billing bags would collide. Preserve
 * Date, hash sensitive leaves, skip PAN-hashing allow-listed ids, and leave
 * Money `amount` strings intact so money-canonicalization can still run.
 */
function redactForFingerprint(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[REDACTED]";
  }
  if (value instanceof Date) {
    return value;
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && isOpaqueSensitiveFingerprintString(value)) {
      return hashedFingerprintLeaf(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForFingerprint(item, depth + 1));
  }

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    if (isSensitiveFingerprintKey(key)) {
      out[key] = hashedFingerprintLeaf(val);
      continue;
    }
    if (typeof val === "string" && isOpaqueSensitiveFingerprintString(val)) {
      // Allow-listed ids: 13–19 digit values are gateway ids, not PANs.
      // Money amount leaves: let stringify collapse number / string / trailing-zero.
      out[key] =
        (isFingerprintIdentityKey(key) && isDigitRunId(val)) ||
        isFingerprintMoneyAmountLeaf(key, record)
          ? val
          : hashedFingerprintLeaf(val);
      continue;
    }
    out[key] = redactForFingerprint(val, depth + 1);
  }
  return out;
}

/**
 * Unquoted type tags for values JSON cannot represent faithfully.
 * Ordinary strings are always `JSON.stringify`'d (quoted), so these never
 * collide with string forms like `"NaN"` or `"10n"`.
 */
const UNDEFINED_TAG = "undefined";
const NAN_TAG = "NaN";
const POS_INFINITY_TAG = "Infinity";
const NEG_INFINITY_TAG = "-Infinity";
const DATE_TAG = "__date__:";

/** Parse options that never reject zero/negative amounts during fingerprinting. */
const FINGERPRINT_MONEY_OPTS = {
  allowZero: true,
  allowNegative: true,
} as const;

/**
 * True when `value` has only Money-shaped own keys (`amount` / `currency` /
 * optional `exponent`). Bags with extra siblings must not be reduced to
 * amount+currency alone.
 */
function isPureMoneyKeys(value: object): boolean {
  for (const key of Object.keys(value)) {
    if (key !== "amount" && key !== "currency" && key !== "exponent") {
      return false;
    }
  }
  return true;
}

/**
 * Fingerprint parse options for a nested/top-level {@link Money}, preserving
 * stored {@link Money.exponent} so scale overrides cannot false-match ISO
 * re-parses (MONEY-1).
 */
function fingerprintOptsForMoney(m: {
  exponent?: number;
}): typeof FINGERPRINT_MONEY_OPTS & { exponent?: number } {
  if (typeof m.exponent === "number" && Number.isInteger(m.exponent) && m.exponent >= 0) {
    return { ...FINGERPRINT_MONEY_OPTS, exponent: m.exponent };
  }
  return FINGERPRINT_MONEY_OPTS;
}

/**
 * Canonical fingerprint shape for a Money value (includes `exponent` when the
 * resolved scale is non-ISO so economically different scales never collide).
 */
function canonicalMoneyFingerprintShape(m: {
  amount: string;
  currency: string;
  exponent?: number;
}): { amount: string; currency: string; exponent?: number } {
  if (typeof m.exponent === "number") {
    return { amount: m.amount, currency: m.currency, exponent: m.exponent };
  }
  return { amount: m.amount, currency: m.currency };
}

/**
 * Terminal encode for a canonical Money fingerprint shape.
 * Must not re-enter {@link stableStringify} as a whole object — that would
 * recurse through the pure-Money path and stack-overflow (caught → fallthrough
 * that drops `exponent`).
 */
function encodeCanonicalMoneyFingerprint(m: {
  amount: string;
  currency: string;
  exponent?: number;
}): string {
  const shape = canonicalMoneyFingerprintShape(m);
  const keys = Object.keys(shape).sort() as Array<keyof typeof shape>;
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(shape[key])}`)
    .join(",")}}`;
}

/**
 * Fingerprint parse options for number/string amount bags that carry a sibling
 * `exponent` (MONEY-1). Without this, `{ amount: 10, currency: "USD", exponent: 0 }`
 * (10 minors) collides with ISO-scale `{ amount: 10, currency: "USD" }` (1000).
 */
function fingerprintOptsForSiblingExponent(
  exponent: unknown,
): typeof FINGERPRINT_MONEY_OPTS & { exponent?: number } {
  if (typeof exponent === "number" && Number.isInteger(exponent) && exponent >= 0) {
    return { ...FINGERPRINT_MONEY_OPTS, exponent };
  }
  return FINGERPRINT_MONEY_OPTS;
}

/**
 * Try to normalize an amount+currency pair to canonical Money major-unit form.
 * Returns undefined when the value cannot be parsed as money (caller falls back
 * to structural encoding).
 *
 * - `number` / decimal `string` amounts use the sibling `currency` **and**
 *   sibling bag `exponent` when present (MONEY-1) so scale overrides do not
 *   false-match ISO re-parses.
 * - Nested {@link Money} under `amount` is re-validated via its own currency
 *   **and stored `exponent`** (MONEY-1) so
 *   `money(10,"USD",{exponent:0})` (10 minors) does not collide with
 *   `{ amount: 10, currency: "USD" }` (1000 minors). Nested Money.exponent wins
 *   over a sibling bag exponent.
 * - Only when the sibling currency matches (case-insensitive) do we collapse.
 * - On currency mismatch, returns undefined so structural encoding keeps the
 *   nested Money currency distinct from the sibling.
 */
function tryCanonicalAmountCurrency(
  amount: unknown,
  currency: string,
  siblingExponent?: unknown,
): { amount: string; currency: string; exponent?: number } | undefined {
  try {
    if (typeof amount === "number" || typeof amount === "string") {
      const m = money(
        amount,
        currency,
        fingerprintOptsForSiblingExponent(siblingExponent),
      );
      return canonicalMoneyFingerprintShape(m);
    }
    if (isMoney(amount)) {
      const m = money(
        amount.amount,
        amount.currency,
        fingerprintOptsForMoney(amount),
      );
      const sibling = currency.trim().toUpperCase();
      // Matching sibling (case-insensitive): fully canonical pair.
      if (sibling === m.currency) {
        return canonicalMoneyFingerprintShape(m);
      }
      // Mismatched sibling: do not overwrite nested Money.currency.
      return undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return UNDEFINED_TAG;
  }

  if (typeof value === "number") {
    // JSON.stringify(NaN/±Infinity) is "null" — unquoted tags ≠ string forms.
    if (Number.isNaN(value)) {
      return NAN_TAG;
    }
    if (value === Number.POSITIVE_INFINITY) {
      return POS_INFINITY_TAG;
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return NEG_INFINITY_TAG;
    }
    return JSON.stringify(value);
  }

  if (typeof value === "bigint") {
    // Unquoted `${n}n` so it never equals JSON string `"10n"`.
    return `${value.toString()}n`;
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  // Date → tagged ISO (default object walk yields "{}"). Unquoted tag so
  // `{ at: Date }` never collides with `{ at: isoString }` (MONEY-2).
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) {
      return `${DATE_TAG}Invalid`;
    }
    return `${DATE_TAG}${value.toISOString()}`;
  }

  // Pure Money only (no extra siblings) — canonicalize amount+currency,
  // preserving Money.exponent so scale overrides fingerprint distinctly (MONEY-1).
  // Bags like `{ amount, currency, orderId }` fall through so siblings survive.
  if (isMoney(value) && isPureMoneyKeys(value)) {
    try {
      const m = money(
        value.amount,
        value.currency,
        fingerprintOptsForMoney(value),
      );
      return encodeCanonicalMoneyFingerprint(m);
    } catch {
      // Fall through to structural encoding of the raw object.
    }
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;

  // Canonicalize AmountInput+currency siblings so number | Money | decimal
  // string amounts with the same economic value share a fingerprint, while
  // preserving any other keys on the object.
  let source: Record<string, unknown> = record;
  if (
    Object.prototype.hasOwnProperty.call(record, "amount") &&
    typeof record.currency === "string"
  ) {
    const canonical = tryCanonicalAmountCurrency(
      record.amount,
      record.currency,
      // MONEY-1: number/string bags may carry sibling exponent for scale override.
      record.exponent,
    );
    if (canonical) {
      source = {
        ...record,
        amount: canonical.amount,
        currency: canonical.currency,
      };
      // MONEY-1: surface non-ISO exponent on the bag so scale overrides remain
      // part of the fingerprint (and drop stale exponent when ISO-default).
      if (canonical.exponent !== undefined) {
        source = { ...source, exponent: canonical.exponent };
      } else if (Object.prototype.hasOwnProperty.call(source, "exponent")) {
        const { exponent: _drop, ...rest } = source;
        source = rest;
      }
    }
  }

  const keys = Object.keys(source).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(source[key])}`)
    .join(",")}}`;
}
