// file: packages/payments/src/utils/idempotency.ts

/**
 * Application-level idempotency primitives.
 *
 * Some gateway endpoints (notably Moyasar refund/capture/void) have no native
 * idempotency. Without a guard, a caller retrying a failed mutation can apply
 * it twice (e.g. refund the customer twice). An injectable store lets callers
 * deduplicate those mutations across retries — and, with an atomic `reserve`
 * backed by Redis/SQL, across processes.
 */

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
 * Simple in-memory idempotency store with TTL eviction and a bounded size.
 * Suitable for a single long-lived process; provide a shared store (Redis/SQL)
 * for multi-worker or serverless deployments.
 *
 * Memory is capped at `maxEntries`. Expired entries are evicted lazily on
 * read, and when the store reaches capacity a write first prunes expired
 * entries and then, if still full, evicts the oldest entry (insertion order).
 * This prevents unbounded growth under high request volume where keys are
 * written once and never read again. Under sustained pressure beyond
 * `maxEntries`, the oldest in-progress guards may be evicted, so size the cap
 * for your throughput or use a shared store for strict guarantees.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<
    string,
    { record: IdempotencyRecord; expiresAt: number }
  >();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  get(key: string): IdempotencyRecord | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.record;
  }

  set(key: string, record: IdempotencyRecord): void {
    // Only do the O(n) prune/evict work when at capacity for a new key, so the
    // common path (updating an existing key or writing below the cap) stays O(1).
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.pruneExpired();
      if (this.entries.size >= this.maxEntries) {
        this.evictOldest();
      }
    }
    this.entries.set(key, { record, expiresAt: Date.now() + this.ttlMs });
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

  /** Number of live (not yet evicted) entries. Exposed for diagnostics/tests. */
  get size(): number {
    return this.entries.size;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private evictOldest(): void {
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) {
      this.entries.delete(oldest);
    }
  }
}

/**
 * Produce a stable fingerprint for arbitrary request params, with object keys
 * sorted so equivalent payloads hash identically regardless of key order.
 *
 * `undefined` and `null` are encoded distinctly so omitting a field (or an
 * explicit `undefined`) does not collide with an explicit `null`.
 */
export function fingerprintParams(value: unknown): string {
  return stableStringify(value);
}

/** Sentinel so `undefined` does not collapse to the same encoding as `null`. */
const UNDEFINED_SENTINEL = '"__undefined__"';

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return UNDEFINED_SENTINEL;
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
