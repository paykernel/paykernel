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
   * Optional atomic reservation. Implement with Redis `SET NX`, a database
   * unique constraint, or equivalent to prevent duplicate cross-worker calls.
   * Store the supplied in-progress record and return undefined when the key is
   * free; return the existing record when it is already reserved.
   */
  reserve?(
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
 * Produce a stable fingerprint for arbitrary request params, with object keys
 * sorted so equivalent payloads hash identically regardless of key order.
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
 * ISO-8601 rather than `{}`.
 */
export function fingerprintParams(value: unknown): string {
  return stableStringify(value);
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

  // Date → ISO string (default object walk yields "{}").
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
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
