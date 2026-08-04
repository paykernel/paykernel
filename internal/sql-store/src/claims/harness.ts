/**
 * Claim contention harness for foundation + Phase 12 adapter equivalence.
 *
 * Callers supply a store adapter implementing the minimal claim surface.
 * The harness proves A3 behaviors:
 * - concurrent claim → exactly one acquired
 * - reclaim after expiry → higher generation + new token
 * - stale token complete rejected
 * - webhook payload_hash conflict under concurrent different hashes
 * - generation monotonic across reclaim chain
 *
 * Reference stores use process-local mutex or a single SQLite transaction.
 * Real SQL adapters must use engine-level single conditional writes
 * (see dialect templates) — never get-then-set.
 */

export type HarnessIdempotencyReserveResult =
  | { kind: "acquired"; generation: number; attempts: number; leaseToken: string }
  | { kind: "in_progress" }
  | { kind: "already_completed" }
  | { kind: "indeterminate" }
  | { kind: "fingerprint_conflict" };

export type HarnessWebhookClaimResult =
  | { kind: "acquired"; generation: number; attempts: number; leaseToken: string }
  | { kind: "in_progress" }
  | { kind: "already_completed" }
  | { kind: "payload_hash_conflict" }
  | { kind: "duplicate_failed" };

export type ClaimContentionAdapter = {
  /** Advance fake clock (ms epoch). Required for expiry reclaim tests. */
  setNowMs(ms: number): void;
  nowMs(): number;

  reserveIdempotency(input: {
    key: string;
    fingerprint: string;
    owner: string;
    leaseMs: number;
  }): Promise<HarnessIdempotencyReserveResult>;

  completeIdempotency(input: { key: string; leaseToken: string; result: unknown }): Promise<void>;

  claimWebhook(input: {
    key: string;
    payloadHash: string;
    owner: string;
    leaseMs: number;
  }): Promise<HarnessWebhookClaimResult>;

  completeWebhook(input: { key: string; leaseToken: string }): Promise<void>;

  /** True when error is lease_lost fencing rejection. */
  isLeaseLostError(error: unknown): boolean;
};

export type ContentionReport = {
  concurrentIdempotency: {
    workers: number;
    acquired: number;
    inProgress: number;
  };
  concurrentWebhook: {
    workers: number;
    acquired: number;
    inProgress: number;
  };
  reclaimGeneration: number;
  staleTokenRejected: boolean;
  concurrentHashConflict: {
    acquired: number;
    hashConflicts: number;
    inProgress: number;
  };
  generationChain: readonly number[];
  /** Documented atomicity note for the adapter under test. */
  atomicityNote: string;
};

export type RunClaimContentionOptions = {
  /** Concurrent workers for race tests (default 32). */
  workers?: number;
  /** Starting clock ms. */
  startMs?: number;
  /** Atomicity documentation string (required for audit trail). */
  atomicityNote: string;
};

/**
 * Run A3 contention scenarios against an adapter.
 * Throws AssertionError-like Error when invariants fail.
 */
export async function runClaimContentionHarness(
  adapter: ClaimContentionAdapter,
  options: RunClaimContentionOptions,
): Promise<ContentionReport> {
  const workers = options.workers ?? 32;
  const startMs = options.startMs ?? Date.parse("2026-01-15T12:00:00.000Z");
  adapter.setNowMs(startMs);

  // ── concurrent idempotency reserve ─────────────────────────────────────────
  const idempResults = await Promise.all(
    Array.from({ length: workers }, (_, i) =>
      adapter.reserveIdempotency({
        key: "harness-idem-key",
        fingerprint: "fp-h",
        owner: `w-${i}`,
        leaseMs: 60_000,
      }),
    ),
  );
  const idempAcquired = idempResults.filter((r) => r.kind === "acquired");
  const idempInProgress = idempResults.filter((r) => r.kind === "in_progress");
  if (idempAcquired.length !== 1) {
    throw new Error(`idempotency concurrent: expected 1 acquired, got ${idempAcquired.length}`);
  }
  if (idempInProgress.length !== workers - 1) {
    throw new Error(
      `idempotency concurrent: expected ${workers - 1} in_progress, got ${idempInProgress.length}`,
    );
  }
  const firstToken = idempAcquired[0]!.leaseToken;
  const firstGen = idempAcquired[0]!.generation;
  if (firstGen !== 1) {
    throw new Error(`idempotency first generation expected 1, got ${firstGen}`);
  }

  // ── concurrent webhook claim ───────────────────────────────────────────────
  const whResults = await Promise.all(
    Array.from({ length: workers }, (_, i) =>
      adapter.claimWebhook({
        key: "harness-wh-key",
        payloadHash: "hash-same",
        owner: `w-${i}`,
        leaseMs: 60_000,
      }),
    ),
  );
  const whAcquired = whResults.filter((r) => r.kind === "acquired");
  const whInProgress = whResults.filter((r) => r.kind === "in_progress");
  if (whAcquired.length !== 1) {
    throw new Error(`webhook concurrent: expected 1 acquired, got ${whAcquired.length}`);
  }
  if (whInProgress.length !== workers - 1) {
    throw new Error(
      `webhook concurrent: expected ${workers - 1} in_progress, got ${whInProgress.length}`,
    );
  }

  // ── reclaim after expiry ───────────────────────────────────────────────────
  adapter.setNowMs(startMs + 120_000);
  const reclaim = await adapter.reserveIdempotency({
    key: "harness-idem-key",
    fingerprint: "fp-h",
    owner: "reclaimer",
    leaseMs: 60_000,
  });
  if (reclaim.kind !== "acquired") {
    throw new Error(`reclaim expected acquired, got ${reclaim.kind}`);
  }
  if (reclaim.generation !== 2) {
    throw new Error(`reclaim generation expected 2, got ${reclaim.generation}`);
  }
  if (reclaim.leaseToken === firstToken) {
    throw new Error("reclaim must issue a new leaseToken");
  }

  // ── stale token complete rejected ──────────────────────────────────────────
  let staleTokenRejected = false;
  try {
    await adapter.completeIdempotency({
      key: "harness-idem-key",
      leaseToken: firstToken,
      result: { ok: true },
    });
  } catch (err) {
    if (adapter.isLeaseLostError(err)) {
      staleTokenRejected = true;
    } else {
      throw err;
    }
  }
  if (!staleTokenRejected) {
    throw new Error("stale token complete must be rejected as lease_lost");
  }

  // active token still works
  await adapter.completeIdempotency({
    key: "harness-idem-key",
    leaseToken: reclaim.leaseToken,
    result: { ok: true },
  });

  // ── concurrent different payload hashes ────────────────────────────────────
  // Start from empty key with racing different hashes.
  const hashKey = "harness-hash-race";
  adapter.setNowMs(startMs);
  const half = Math.floor(workers / 2);
  const hashResults = await Promise.all(
    Array.from({ length: workers }, (_, i) =>
      adapter.claimWebhook({
        key: hashKey,
        payloadHash: i < half ? "hash-A" : "hash-B",
        owner: `h-${i}`,
        leaseMs: 60_000,
      }),
    ),
  );
  const hashAcquired = hashResults.filter((r) => r.kind === "acquired");
  const hashConflicts = hashResults.filter((r) => r.kind === "payload_hash_conflict");
  const hashInProgress = hashResults.filter((r) => r.kind === "in_progress");
  if (hashAcquired.length !== 1) {
    throw new Error(`hash race: expected 1 acquired, got ${hashAcquired.length}`);
  }
  // Losers: either same-hash in_progress or other-hash payload_hash_conflict
  if (hashConflicts.length + hashInProgress.length !== workers - 1) {
    throw new Error(
      `hash race: expected conflicts+in_progress = ${workers - 1}, ` +
        `got conflicts=${hashConflicts.length} in_progress=${hashInProgress.length}`,
    );
  }
  // Both hashes are always present among workers (split half/half), so at least
  // one loser must observe payload_hash_conflict once a winner is chosen.
  if (hashConflicts.length < 1) {
    throw new Error("hash race: expected at least one payload_hash_conflict");
  }

  // ── generation monotonic reclaim chain ─────────────────────────────────────
  const chainKey = "harness-gen-chain";
  adapter.setNowMs(startMs);
  const gens: number[] = [];
  let lastToken = "";
  for (let step = 0; step < 5; step++) {
    adapter.setNowMs(startMs + step * 120_000);
    const r = await adapter.reserveIdempotency({
      key: chainKey,
      fingerprint: "fp-chain",
      owner: `chain-${step}`,
      leaseMs: 30_000,
    });
    if (r.kind !== "acquired") {
      throw new Error(`gen chain step ${step}: expected acquired, got ${r.kind}`);
    }
    gens.push(r.generation);
    if (step > 0 && r.leaseToken === lastToken) {
      throw new Error(`gen chain step ${step}: leaseToken must rotate`);
    }
    lastToken = r.leaseToken;
  }
  for (let i = 1; i < gens.length; i++) {
    if (gens[i]! !== gens[i - 1]! + 1) {
      throw new Error(`generation not monotonic: ${gens.join(",")} at index ${i}`);
    }
  }
  if (gens[0] !== 1) {
    throw new Error(`generation chain must start at 1, got ${gens[0]}`);
  }

  return {
    concurrentIdempotency: {
      workers,
      acquired: idempAcquired.length,
      inProgress: idempInProgress.length,
    },
    concurrentWebhook: {
      workers,
      acquired: whAcquired.length,
      inProgress: whInProgress.length,
    },
    reclaimGeneration: reclaim.generation,
    staleTokenRejected,
    concurrentHashConflict: {
      acquired: hashAcquired.length,
      hashConflicts: hashConflicts.length,
      inProgress: hashInProgress.length,
    },
    generationChain: gens,
    atomicityNote: options.atomicityNote,
  };
}

/**
 * Wrap memory-relational (or compatible) store as a harness adapter.
 */
export function memoryRelationalAsHarnessAdapter(store: {
  setNowMs(ms: number): void;
  nowMs(): number;
  reserveIdempotency(input: {
    key: string;
    fingerprint: string;
    owner: string;
    leaseMs: number;
  }): Promise<
    | { kind: "acquired"; record: { generation: number; attempts: number }; leaseToken: string }
    | { kind: "already_completed"; record: unknown }
    | { kind: "in_progress"; record: unknown }
    | { kind: "indeterminate"; record: unknown }
    | { kind: "fingerprint_conflict"; record: unknown }
  >;
  completeIdempotency(input: { key: string; leaseToken: string; result: unknown }): Promise<void>;
  claimWebhook(input: {
    key: string;
    payloadHash: string;
    owner: string;
    leaseMs: number;
  }): Promise<
    | { kind: "acquired"; record: { generation: number; attempts: number }; leaseToken: string }
    | { kind: "already_completed"; record: unknown }
    | { kind: "in_progress"; record: unknown }
    | { kind: "payload_hash_conflict"; record: unknown }
    | { kind: "duplicate_failed"; record: unknown }
  >;
  completeWebhook(input: { key: string; leaseToken: string }): Promise<void>;
}): ClaimContentionAdapter {
  return {
    setNowMs: (ms) => store.setNowMs(ms),
    nowMs: () => store.nowMs(),
    async reserveIdempotency(input) {
      const r = await store.reserveIdempotency(input);
      if (r.kind === "acquired") {
        return {
          kind: "acquired",
          generation: r.record.generation,
          attempts: r.record.attempts,
          leaseToken: r.leaseToken,
        };
      }
      return { kind: r.kind };
    },
    completeIdempotency: (input) => store.completeIdempotency(input),
    async claimWebhook(input) {
      const r = await store.claimWebhook(input);
      if (r.kind === "acquired") {
        return {
          kind: "acquired",
          generation: r.record.generation,
          attempts: r.record.attempts,
          leaseToken: r.leaseToken,
        };
      }
      return { kind: r.kind };
    },
    completeWebhook: (input) => store.completeWebhook(input),
    isLeaseLostError(error) {
      return (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "lease_lost"
      );
    },
  };
}
