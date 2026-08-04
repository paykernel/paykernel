let meta = #{
    name: "phase-9-store-contracts",
    description: "Phase 9 Store Contracts and Adapter Manifests: critic, implement lease-aware contracts + fencing + error taxonomy + StorageAdapterManifest + docs + conformance proof, integrate, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 9 roadmap 9.1-9.5 and acceptance criteria" },
        #{ title: "Implement", detail: "contracts polish, StorageAdapterManifest, memory manifests, docs, tests" },
        #{ title: "Integrate", detail: "unify streams, public API, dual-compat, keep green" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, boundaries, Phase 9 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 9" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 9 (Store Contracts and Adapter Manifests) for PayKernel monorepo",
};

let critic_schema = #{
    "type": "object",
    "required": ["gaps", "already_present", "stream_plan", "risks", "summary"],
    "properties": #{
        "gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "already_present": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "stream_plan": #{ "type": "string" },
        "risks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 120 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": [
        "ok", "typecheck_ok", "tests_ok", "build_ok", "boundaries_ok",
        "contracts_ok", "lease_semantics_ok", "fencing_ok", "error_taxonomy_ok",
        "adapter_manifest_ok", "indeterminate_blocks_ok", "renew_no_stale_ok",
        "conformance_ok", "docs_ok", "compat_ok",
        "failures", "summary"
    ],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "pack_ok": #{ "type": "boolean" },
        "coverage_ok": #{ "type": "boolean" },
        "contracts_ok": #{ "type": "boolean" },
        "lease_semantics_ok": #{ "type": "boolean" },
        "fencing_ok": #{ "type": "boolean" },
        "error_taxonomy_ok": #{ "type": "boolean" },
        "adapter_manifest_ok": #{ "type": "boolean" },
        "indeterminate_blocks_ok": #{ "type": "boolean" },
        "renew_no_stale_ok": #{ "type": "boolean" },
        "conformance_ok": #{ "type": "boolean" },
        "docs_ok": #{ "type": "boolean" },
        "compat_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "checklist", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 9 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 9 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 9 — Store Contracts and Adapter Manifests\" completely\n";
p_critic += "(Objective, 9.1 Store Contracts, 9.2 Lease Semantics, 9.3 Fencing Tokens,\n";
p_critic += "9.4 Storage Error Taxonomy, 9.5 Adapter Manifest, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  11 atomicity by storage engine not get/set; 12 no await in sync SQLite tx;\n";
p_critic += "  13 prepared statements; 14 no raw payloads by default; 15 portable timestamps/IDs;\n";
p_critic += "  16 every adapter same conformance suite; 17 document crash boundaries;\n";
p_critic += "  5 no secret leakage; 19 no auto schema migrations in prod.\n";
p_critic += "Also section 3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings,\n";
p_critic += "3.5 Each Adapter Must Declare Its Guarantees.\n";
p_critic += "Phases 0-8 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, pack validation.\n";
p_critic += "Do NOT start Phase 10 webhook inbox package (@paykernel/webhooks),\n";
p_critic += "Phase 11+ real DB adapters (postgres/sqlite/d1/redis/turso/do), new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-8 money/outcomes/events/runtime unless required for contract types.\n\n";

p_critic += "CONTEXT: Phase 4 already shipped a large slice of Phase 9 into packages/testkit:\n";
p_critic += "- packages/testkit/src/storage/contracts.ts (IdempotencyStore, WebhookInboxStore, ReconciliationStore,\n";
p_critic += "  error taxonomy StoreError* classes, lease/generation fields)\n";
p_critic += "- packages/testkit/src/memory/memory-stores.ts (NON-PRODUCTION in-memory implementations)\n";
p_critic += "- packages/testkit/src/storage/*-conformance.ts + storage-conformance.test.ts\n";
p_critic += "These are INTERIM homes until dedicated webhooks/reconciliation packages exist.\n";
p_critic += "Lease-aware IdempotencyStore is DISTINCT from core 0.x IdempotencyStore (get/set/reserve without fencing).\n";
p_critic += "Do NOT merge or break the core 0.x API.\n\n";

p_critic += "Audit against EVERY Phase 9 requirement with evidence (grep/read):\n\n";

p_critic += "9.1 Store Contracts — three SEPARATE interfaces (not one universal store):\n";
p_critic += "IdempotencyStore: reserve, renew, complete, markIndeterminate, get, deleteExpired\n";
p_critic += "WebhookInboxStore: claim, renew, complete, fail, get, listRetryable, deleteExpired\n";
p_critic += "ReconciliationStore: schedule, claim, renew, complete, fail, markManualReview, get, listDue, deleteExpired\n";
p_critic += "Every mutating method AFTER reserve/claim must require the active lease/reservation token.\n\n";

p_critic += "9.2 Lease Semantics — claimable records must define: unique key, state, lease owner,\n";
p_critic += "lease token/fencing token, lease expiry, attempts, timestamps, version/generation.\n";
p_critic += "Completion, failure, renewal require current lease token. Stale worker must not complete\n";
p_critic += "after newer worker reclaimed lease.\n\n";

p_critic += "9.3 Fencing Tokens — monotonically increasing generations OR unguessable lease tokens\n";
p_critic += "to reject stale workers. Verify both generation increments and token checks on complete/renew/fail.\n\n";

p_critic += "9.4 Storage Error Taxonomy — normalize: unavailable, conflict, lease_lost, timeout,\n";
p_critic += "serialization_failure, invalid_schema, unsupported_feature, corrupted_record\n";
p_critic += "(payload_hash_conflict may exist as extension — keep if useful).\n\n";

p_critic += "9.5 Adapter Manifest — REQUIRED and currently MISSING (grep StorageAdapterManifest):\n";
p_critic += "```ts\n";
p_critic += "interface StorageAdapterManifest {\n";
p_critic += "  name: string;\n";
p_critic += "  contracts: { idempotency: boolean; webhookInbox: boolean; reconciliation: boolean };\n";
p_critic += "  consistency: {\n";
p_critic += "    claims: \"strong\";\n";
p_critic += "    readAfterWrite: \"strong\" | \"session\" | \"eventual\";\n";
p_critic += "    staleReadsPossible: boolean;\n";
p_critic += "  };\n";
p_critic += "  coordinationScope: \"single-process\" | \"single-host\" | \"multi-host\" | \"multi-region\";\n";
p_critic += "  durability: \"durable\" | \"configuration-dependent\" | \"ephemeral\";\n";
p_critic += "  supportsTransactions: boolean;\n";
p_critic += "  supportsLeases: boolean;\n";
p_critic += "  supportsRetentionCleanup: boolean;\n";
p_critic += "  notes: readonly string[];\n";
p_critic += "}\n";
p_critic += "```\n";
p_critic += "Memory stores MUST expose a machine-readable manifest declaring single-process,\n";
p_critic += "ephemeral, NON-PRODUCTION, non-distributed, crash = data loss.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) contracts specify atomicity and stale-worker behavior precisely (code comments + docs).\n";
p_critic += "A2) implementations cannot claim correctness with non-atomic get/set logic\n";
p_critic += "    (docs + conformance require engine-level claim; memory uses single-isolate critical sections only).\n";
p_critic += "A3) adapter guarantees are machine-readable and documented (StorageAdapterManifest + docs).\n";
p_critic += "A4) indeterminate idempotency record blocks mutation replay until reconciliation or explicit\n";
p_critic += "    operator decision (reserve returns kind: indeterminate; cannot complete without re-reserve path).\n";
p_critic += "A5) long-running idempotency and reconciliation work can renew leases without allowing stale completion.\n\n";

p_critic += "Also check:\n";
p_critic += "- docs: is there packages/testkit/docs or packages/core/docs store-contracts.md?\n";
p_critic += "- public exports of contracts/manifest from testkit index\n";
p_critic += "- conformance proves stale token rejection, renew, indeterminate block, concurrent claim\n";
p_critic += "- core 0.x IdempotencyStore still intact and not confused with lease-aware store\n";
p_critic += "- NO real postgres/sqlite/redis adapter packages yet (Phase 9 is contracts only)\n";
p_critic += "- crash boundary documentation for memory store\n";
p_critic += "- timestamps are ISO strings not number IDs\n\n";

p_critic += "List concrete GAPS (especially StorageAdapterManifest, formal docs, any missing semantics).\n";
p_critic += "List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: confusing core vs testkit IdempotencyStore; overclaiming multi-process safety for memory;\n";
p_critic += "breaking Phase 4 conformance API; inventing Phase 10 inbox engine; weakening fencing;\n";
p_critic += "storing secrets in records; auto migrations; get-then-set race disguised as claim.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase9-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase9-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 9 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 9\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 9 Store Contracts and Adapter Manifests in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — PRIMARY home for Phase 9 contracts.\n";
common += "PHASE 9 ONLY: Store Contracts and Adapter Manifests.\n";
common += "Do NOT start Phase 10 @paykernel/webhooks package or inbox engine runtime.\n";
common += "Do NOT create adapter-postgres / adapter-sqlite / adapter-redis / adapter-d1 packages.\n";
common += "Do NOT add new PSPs or extract gateways. Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-8 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change.\n";
common += "2) No unsafe mutation retries without native idempotency or atomic dedup.\n";
common += "3) Never convert uncertain outcomes into failure.\n";
common += "4) Do not hide provider differences.\n";
common += "5) No secret leakage in errors/logs/fixtures/stored records.\n";
common += "6) No framework coupling.\n";
common += "7) No Node-only assumptions in portable packages.\n";
common += "8) Keep 0.x backward compat: core IdempotencyStore (get/set/reserve) UNCHANGED.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) exactOptionalPropertyTypes is ON.\n";
common += "11) Core must NOT depend on testkit.\n";
common += "12) Atomicity = engine-level claim, NOT get-then-set races (memory: single-isolate sync critical section only).\n";
common += "13) No await of external I/O inside sync SQL transactions (document for future adapters).\n";
common += "14) Portable timestamps (ISO-8601 strings) and opaque string IDs/lease tokens.\n";
common += "15) Do not store raw provider payloads by default.\n";
common += "16) Every adapter must pass the same conformance suite (memory self-proof exists).\n";
common += "17) Document crash boundaries.\n";
common += "18) Lease-aware store contracts stay in testkit until webhooks/reconciliation packages exist.\n";
common += "    Namespace clearly: never rename core 0.x IdempotencyStore.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: Contracts polish + atomicity/stale-worker precision + error taxonomy completeness
let p_a = "";
p_a += common;
p_a += "STREAM A — STORE CONTRACTS PRECISION (Tasks 9.1, 9.2, 9.3, 9.4).\n";
p_a += "OWN: packages/testkit/src/storage/contracts.ts, related unit/type tests under packages/testkit/src/storage/,\n";
p_a += "packages/testkit/src/storage/*-conformance.ts only if a contract gap requires a new case,\n";
p_a += "packages/testkit/src/memory/memory-stores.ts only for behavior fixes required by contract precision.\n\n";

p_a += "### GOAL\n";
p_a += "Make contracts the authoritative, precise specification of atomicity and stale-worker behavior.\n";
p_a += "Do NOT invent a universal mega-store. Keep three separate interfaces.\n\n";

p_a += "### 9.1 Interfaces (must match roadmap method names)\n";
p_a += "```ts\n";
p_a += "interface IdempotencyStore {\n";
p_a += "  reserve(input): Promise<IdempotencyReservation>;\n";
p_a += "  renew(input): Promise<RenewReservationResult>;\n";
p_a += "  complete(input): Promise<void>;  // REQUIRES lease token\n";
p_a += "  markIndeterminate(input): Promise<void>;  // REQUIRES lease token\n";
p_a += "  get(key): Promise<IdempotencyRecord | undefined>;\n";
p_a += "  deleteExpired(input): Promise<CleanupResult>;\n";
p_a += "}\n";
p_a += "interface WebhookInboxStore {\n";
p_a += "  claim, renew, complete, fail, get, listRetryable, deleteExpired\n";
p_a += "}\n";
p_a += "interface ReconciliationStore {\n";
p_a += "  schedule, claim, renew, complete, fail, markManualReview, get, listDue, deleteExpired\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Audit existing contracts.ts — fill ANY missing method/type/result discriminant.\n";
p_a += "Document on each mutating method after reserve/claim: **requires active leaseToken**;\n";
p_a += "throws StoreLeaseLostError or returns lease_lost when token stale/wrong/expired.\n\n";

p_a += "### Atomicity contract (MUST be explicit in JSDoc on interfaces)\n";
p_a += "- reserve/claim MUST be implemented as a single atomic engine-level claim\n";
p_a += "  (conditional INSERT/UPDATE, Redis SET NX + token, DO transactional write, etc.).\n";
p_a += "- Implementations MUST NOT claim correctness via non-atomic get-then-set races across processes.\n";
p_a += "- Memory adapters: single-isolate critical sections only; declare NON-DISTRIBUTED.\n";
p_a += "- withTransaction is optional helper; SQL adapters must not await external I/O in sync SQLite txs.\n\n";

p_a += "### 9.2 Lease fields on records (all claimable)\n";
p_a += "unique key, status/state, leaseOwner, leaseToken, leaseExpiresAt, attempts,\n";
p_a += "createdAt/updatedAt (IsoTimestamp), generation (monotonic fencing).\n";
p_a += "Webhook: payloadHash, availableAt. Reconciliation: subjectId, reason, dueAt.\n";
p_a += "Idempotency: fingerprint, optional cached result (never secrets).\n\n";

p_a += "### 9.3 Fencing\n";
p_a += "generation increments on successful reserve/claim/renew; leaseToken is unguessable opaque string.\n";
p_a += "complete/fail/renew/markIndeterminate/markManualReview MUST reject wrong token.\n";
p_a += "After lease reclaim, old token MUST fail (StoreLeaseLostError or renew ok:false lease_lost).\n\n";

p_a += "### 9.4 Error taxonomy\n";
p_a += "Ensure StoreErrorCode includes ALL roadmap codes:\n";
p_a += "unavailable | conflict | lease_lost | timeout | serialization_failure |\n";
p_a += "invalid_schema | unsupported_feature | corrupted_record\n";
p_a += "Optional extension: payload_hash_conflict (keep if already present).\n";
p_a += "Provide StoreError + subclasses for primary codes used in practice\n";
p_a += "(StoreUnavailableError, StoreConflictError, StoreLeaseLostError at minimum).\n";
p_a += "Messages must never include secrets or raw provider payloads.\n\n";

p_a += "### Indeterminate blocking (A4)\n";
p_a += "When status is indeterminate, reserve MUST return kind: \"indeterminate\" and MUST NOT\n";
p_a += "hand out a new lease for mutation replay. Document that operator/reconciliation must resolve.\n";
p_a += "Memory store already does this — lock with tests if any gap.\n\n";

p_a += "### Conformance cases that MUST exist (add if missing)\n";
p_a += "Idempotency: acquire; complete requires token; stale token rejected; fingerprint conflict;\n";
p_a += "already_completed; in_progress while lease active; reclaim after expiry; renew extends lease;\n";
p_a += "wrong renew token rejected; markIndeterminate blocks further reserve; concurrent double-reserve\n";
p_a += "(same isolate) only one acquired when concurrency true.\n";
p_a += "Webhook: claim; payload_hash_conflict; already_completed; in_progress; stale complete rejected;\n";
p_a += "fail + listRetryable; renew; reclaim after expiry.\n";
p_a += "Reconciliation: schedule; claim not_due; claim acquired; complete; stale rejected; renew;\n";
p_a += "markManualReview; fail with retryAt; listDue.\n\n";

p_a += "### Tests Stream A\n";
p_a += "- unit/contract tests for error codes completeness\n";
p_a += "- ensure storage-conformance.test.ts still green\n";
p_a += "- focused tests for indeterminate block + renew fencing if not already covered\n";
p_a += "Run: bun test packages/testkit/src/storage packages/testkit/src/memory\n";
p_a += "Do NOT write phase-9-gate-report.md (Gate owns it).\n";
p_a += "Do NOT implement StorageAdapterManifest (Stream B owns it) unless Stream B missing and you need a type import — prefer leave type for B.\n";

let a_result = agent(p_a, #{
    label: "impl:9-contracts",
    capability_mode: "all",
    output_schema: implement_schema,
});

let a_ok = false;
let a_summary = "stream A failed";
if a_result != () && a_result.success && a_result.output != () {
    a_ok = a_result.output.ok == true;
    a_summary = a_result.output.summary;
    log("Stream A ok=" + a_ok.to_string() + " — " + a_summary);
} else {
    log("Stream A agent failed");
}

// Parallel streams B and C
log("Implementing Phase 9 adapter manifests and docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — STORAGE ADAPTER MANIFEST (Task 9.5) + MEMORY STORE GUARANTEES.\n";
p_b += "OWN: packages/testkit/src/storage/adapter-manifest.ts (NEW),\n";
p_b += "packages/testkit/src/storage/adapter-manifest.test.ts (NEW),\n";
p_b += "wire into packages/testkit/src/index.ts exports,\n";
p_b += "packages/testkit/src/memory/memory-stores.ts (attach manifest + helper),\n";
p_b += "packages/testkit/src/public-api.test.ts freeze list,\n";
p_b += "optional packages/testkit/src/memory/memory-stores.test.ts assertions.\n";
p_b += "If Stream A moved types, read contracts.ts first and adapt.\n\n";

p_b += "### GOAL\n";
p_b += "Adapter guarantees are machine-readable (StorageAdapterManifest) and documented via notes.\n";
p_b += "No adapter may silently omit guarantee fields.\n\n";

p_b += "### Implement exactly (roadmap 9.5 + useful validators)\n";
p_b += "```ts\n";
p_b += "export type StorageCoordinationScope =\n";
p_b += "  | \"single-process\" | \"single-host\" | \"multi-host\" | \"multi-region\";\n";
p_b += "export type StorageDurability = \"durable\" | \"configuration-dependent\" | \"ephemeral\";\n";
p_b += "export type StorageReadAfterWrite = \"strong\" | \"session\" | \"eventual\";\n";
p_b += "\n";
p_b += "export interface StorageAdapterManifest {\n";
p_b += "  name: string;\n";
p_b += "  contracts: {\n";
p_b += "    idempotency: boolean;\n";
p_b += "    webhookInbox: boolean;\n";
p_b += "    reconciliation: boolean;\n";
p_b += "  };\n";
p_b += "  consistency: {\n";
p_b += "    claims: \"strong\"; // claims MUST be strong for production adapters\n";
p_b += "    readAfterWrite: StorageReadAfterWrite;\n";
p_b += "    staleReadsPossible: boolean;\n";
p_b += "  };\n";
p_b += "  coordinationScope: StorageCoordinationScope;\n";
p_b += "  durability: StorageDurability;\n";
p_b += "  supportsTransactions: boolean;\n";
p_b += "  supportsLeases: boolean;\n";
p_b += "  supportsRetentionCleanup: boolean;\n";
p_b += "  notes: readonly string[];\n";
p_b += "}\n";
p_b += "```\n";
p_b += "Optional but recommended helpers:\n";
p_b += "- assertStorageAdapterManifest(m): void — runtime validation of shape/enums\n";
p_b += "- isProductionSafeCoordination(m): boolean — false for single-process/ephemeral only\n";
p_b += "- MEMORY_STORAGE_ADAPTER_MANIFEST constant for the testkit memory multi-store\n\n";

p_b += "### Memory adapter manifest (required)\n";
p_b += "```ts\n";
p_b += "export const MEMORY_STORAGE_ADAPTER_MANIFEST: StorageAdapterManifest = {\n";
p_b += "  name: \"memory\",\n";
p_b += "  contracts: { idempotency: true, webhookInbox: true, reconciliation: true },\n";
p_b += "  consistency: { claims: \"strong\", readAfterWrite: \"strong\", staleReadsPossible: false },\n";
p_b += "  // claims: strong WITHIN single isolate only — notes must clarify\n";
p_b += "  coordinationScope: \"single-process\",\n";
p_b += "  durability: \"ephemeral\",\n";
p_b += "  supportsTransactions: true, // clone-on-enter withTransaction\n";
p_b += "  supportsLeases: true,\n";
p_b += "  supportsRetentionCleanup: true,\n";
p_b += "  notes: [\n";
p_b += "    \"NON-PRODUCTION. Test-only. Not safe for multi-process or distributed use.\",\n";
p_b += "    \"Atomicity is process-local Map mutation (single isolate), not multi-process locking.\",\n";
p_b += "    \"Crash or process restart loses all state (ephemeral).\",\n";
p_b += "    \"Do not use on payment production paths.\",\n";
p_b += "    // crash boundary notes...\n";
p_b += "  ],\n";
p_b += "};\n";
p_b += "```\n";
p_b += "Attach manifest to createMemoryStores() return value AND/OR each createMemory*Store:\n";
p_b += "```ts\n";
p_b += "export type MemoryStores = {\n";
p_b += "  idempotency: MemoryIdempotencyStore;\n";
p_b += "  webhookInbox: MemoryWebhookInboxStore;\n";
p_b += "  reconciliation: MemoryReconciliationStore;\n";
p_b += "  manifest: StorageAdapterManifest; // same MEMORY_STORAGE_ADAPTER_MANIFEST\n";
p_b += "  clock: Clock;\n";
p_b += "};\n";
p_b += "```\n";
p_b += "Also export getMemoryStorageAdapterManifest() or readonly property on stores if clean.\n";
p_b += "Keep NON_PRODUCTION / NON_DISTRIBUTED / MEMORY_STORE_WARNING markers.\n\n";

p_b += "### Consistency honesty for memory\n";
p_b += "claims: \"strong\" is allowed ONLY with notes that scope is single-process.\n";
p_b += "Do NOT set coordinationScope multi-host for memory. Do NOT set durability durable.\n";
p_b += "staleReadsPossible: false within isolate after write is OK; note no multi-process.\n\n";

p_b += "### Future adapter contract (document in notes/docs, do not implement adapters)\n";
p_b += "Production adapters MUST set claims: \"strong\" via engine atomic ops.\n";
p_b += "Adapters that only do get+set MUST NOT publish a conforming manifest with strong claims.\n";
p_b += "Optional: isStrongClaimAdapter(m) helper that also requires leases support.\n\n";

p_b += "### Tests Stream B\n";
p_b += "- MEMORY_STORAGE_ADAPTER_MANIFEST has all required fields and correct enums\n";
p_b += "- assertStorageAdapterManifest accepts memory, rejects missing fields / bad enums\n";
p_b += "- createMemoryStores().manifest === MEMORY_STORAGE_ADAPTER_MANIFEST (or deep equal)\n";
p_b += "- public-api.test.ts exports StorageAdapterManifest type is runtime-free but\n";
p_b += "  exports MEMORY_STORAGE_ADAPTER_MANIFEST, assertStorageAdapterManifest if present\n";
p_b += "- machine-readable: JSON.stringify(manifest) round-trips without functions\n";
p_b += "Run: bun test packages/testkit\n";
p_b += "Do NOT write gate report.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCUMENTATION + CHANGELOG + PUBLIC API DOCS (Phase 9 acceptance + engineering rules).\n";
p_c += "OWN: packages/testkit/docs/store-contracts.md (NEW, primary),\n";
p_c += "packages/testkit/docs/phase-9-gate-report.md is NOT yours (Gate writes it),\n";
p_c += "packages/testkit/README.md updates, packages/testkit/CHANGELOG.md Unreleased Phase 9,\n";
p_c += "packages/core/docs/baseline or cross-links if needed (do not invent core store APIs),\n";
p_c += "docs/workspace-boundaries.md brief note that store contracts live in testkit until domain packages,\n";
p_c += "packages/core/CHANGELOG or docs only if clarifying core 0.x IdempotencyStore vs lease-aware.\n";
p_c += "packages/testkit/package.json files[] include docs if packing docs is desired —\n";
p_c += "  currently testkit packs only dist/README/LICENSE; README must document contracts thoroughly.\n";
p_c += "Optionally add \"docs\" to testkit package.json files array so store-contracts.md ships.\n\n";

p_c += "### packages/testkit/docs/store-contracts.md MUST cover\n";
p_c += "1) Purpose of Phase 9: define storage semantics BEFORE any DB adapter.\n";
p_c += "2) Three separate contracts (not universal store) with method tables.\n";
p_c += "3) Atomicity requirement: single-statement/engine claim; FORBIDDEN non-atomic get/set claim.\n";
p_c += "4) Lease semantics fields + complete/fail/renew require current token.\n";
p_c += "5) Fencing tokens (generation + unguessable leaseToken) and stale worker rejection.\n";
p_c += "6) Error taxonomy table with codes.\n";
p_c += "7) StorageAdapterManifest fields and how adapters declare guarantees.\n";
p_c += "8) Indeterminate idempotency: blocks mutation replay until reconciliation or explicit operator decision.\n";
p_c += "9) Lease renewal for long-running work; renew fails when token stale.\n";
p_c += "10) Memory adapter: NON-PRODUCTION, single-process, ephemeral, crash boundaries.\n";
p_c += "11) Crash boundary model (acquire then crash before complete → reclaim after expiry;\n";
p_c += "    crash after external side effect before complete → indeterminate path).\n";
p_c += "12) Distinction from core 0.x IdempotencyStore (get/set/reserve for gateway mutation guards).\n";
p_c += "13) Conformance suites: how future adapters run run*StoreConformanceSuite.\n";
p_c += "14) What Phase 9 does NOT include (webhook engine package, real DB drivers).\n";
p_c += "15) Portable IDs/timestamps; no raw secrets/payloads by default.\n\n";

p_c += "### README\n";
p_c += "Add section linking to docs/store-contracts.md; show StorageAdapterManifest snippet;\n";
p_c += "show createMemoryStores + runIdempotencyStoreConformanceSuite example;\n";
p_c += "warn NON-PRODUCTION memory stores.\n\n";

p_c += "### CHANGELOG\n";
p_c += "Unreleased Phase 9 section: formalize store contracts, adapter manifest, docs, any API additions.\n\n";

p_c += "### Cross-links\n";
p_c += "If core docs mention Phase 9 as future, update to \"defined in testkit (Phase 9)\".\n";
p_c += "webhook-events.md / behavioral-contracts if they say \"Phase 9 later\" — update carefully.\n\n";

p_c += "### Do NOT\n";
p_c += "Implement adapters or Phase 10 engine. Do not commit. Do not write gate report.\n";
p_c += "After docs: ensure markdown is accurate against actual code (re-read contracts + manifest).\n";

let jobs = [
    #{ prompt: p_b, label: "impl:9-adapter-manifest", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:9-docs", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok = if a_ok { 1 } else { 0 };
let impl_fail = if a_ok { 0 } else { 1 };
let impl_i = 0;
while impl_i < impl_results.len() {
    let r = impl_results[impl_i];
    if r != () && r.success && r.output != () && r.output.ok == true {
        impl_ok += 1;
        log("OK implement: " + r.output.summary);
    } else {
        impl_fail += 1;
        log("FAIL implement slot " + impl_i.to_string());
    }
    impl_i += 1;
}
log("Implement done ok=" + impl_ok.to_string() + " fail=" + impl_fail.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "You are integrating Phase 9 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 10+ (webhooks package, DB adapters).\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) Three separate store interfaces in packages/testkit/src/storage/contracts.ts matching roadmap 9.1 methods.\n";
p_int += "2) Every post-reserve/claim mutation requires leaseToken; stale token rejected.\n";
p_int += "3) Lease fields: owner, token, expiry, attempts, timestamps, generation on claimable records.\n";
p_int += "4) Fencing via generation + unguessable lease tokens.\n";
p_int += "5) Full StoreErrorCode taxonomy (roadmap 9.4) + StoreError hierarchy.\n";
p_int += "6) StorageAdapterManifest type + MEMORY_STORAGE_ADAPTER_MANIFEST exported from testkit root.\n";
p_int += "7) createMemoryStores exposes manifest; memory marked single-process + ephemeral + NON-PRODUCTION.\n";
p_int += "8) Conformance suites pass for memory (idempotency, webhook, reconciliation).\n";
p_int += "9) Indeterminate blocks further reserve/mutation replay.\n";
p_int += "10) renew works for long-running work; wrong token renew fails; stale complete fails.\n";
p_int += "11) packages/testkit/docs/store-contracts.md documents atomicity, stale-worker, crash boundaries, manifests.\n";
p_int += "12) README + CHANGELOG updated; public-api freeze includes new runtime exports.\n";
p_int += "13) Core 0.x IdempotencyStore unchanged; core does not depend on testkit.\n";
p_int += "14) Phase 0-8 safety: typecheck, tests core+testkit, build, boundaries, runtime portability still green.\n";
p_int += "15) No real DB adapter packages; no Phase 10 webhooks package.\n";
p_int += "16) No secret leakage in store errors/records docs.\n";
p_int += "17) JSDoc states atomic claim requirement (no get/set correctness claims).\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "19) If Stream A or B failed, implement missing contracts/manifest yourself. Phase 9 cannot ship without them.\n";
p_int += "20) Ensure testkit package.json files includes docs if store-contracts.md should ship (or README has full content).\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase9",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || int_result.output.ok != true {
    log("Integrate reported issues — verify will surface details");
} else {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify Phase 9 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/testkit/dist/index.js && test -f packages/core/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence contracts: read packages/testkit/src/storage/contracts.ts for three interfaces + methods\n";
p_ver += "12) Evidence lease fields + generation on records\n";
p_ver += "13) Evidence complete/renew require leaseToken; StoreLeaseLostError on stale\n";
p_ver += "14) Evidence StoreErrorCode includes all roadmap 9.4 codes\n";
p_ver += "15) Evidence StorageAdapterManifest + MEMORY_STORAGE_ADAPTER_MANIFEST exported (src + dist .d.ts)\n";
p_ver += "16) Evidence createMemoryStores().manifest machine-readable\n";
p_ver += "17) Evidence conformance suites pass (storage-conformance.test.ts + report counters)\n";
p_ver += "18) Evidence indeterminate reserve returns kind indeterminate and blocks re-acquire\n";
p_ver += "19) Evidence renew + stale rejection in conformance cases\n";
p_ver += "20) Evidence packages/testkit/docs/store-contracts.md covers atomicity + stale-worker + crash + manifest\n";
p_ver += "21) Evidence core 0.x IdempotencyStore still exists and is distinct; no core→testkit dep\n";
p_ver += "22) Evidence NO packages/adapter-* or packages/webhooks Phase 10 package created\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- contracts_ok: 9.1 three interfaces with required methods\n";
p_ver += "- lease_semantics_ok: 9.2 fields + token required for complete/fail/renew\n";
p_ver += "- fencing_ok: 9.3 generation/tokens reject stale workers\n";
p_ver += "- error_taxonomy_ok: 9.4 all codes present\n";
p_ver += "- adapter_manifest_ok: 9.5 type + memory manifest exported + documented\n";
p_ver += "- indeterminate_blocks_ok: A4 proven by tests\n";
p_ver += "- renew_no_stale_ok: A5 renew works; stale complete fails\n";
p_ver += "- conformance_ok: three suites green for memory\n";
p_ver += "- docs_ok: store-contracts.md + README/CHANGELOG\n";
p_ver += "- compat_ok: Phase 0-8 green; core IdempotencyStore unchanged; no core→testkit\n";
p_ver += "Set ok=true only if typecheck, tests (core+testkit), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase9",
    capability_mode: "all",
    output_schema: verify_schema,
});

let verify_ok = false;
let verify_summary = "verify agent failed";
let verify_failures = "";
if ver != () && ver.success && ver.output != () {
    verify_ok = ver.output.ok == true;
    verify_summary = ver.output.summary;
    log("Verify: ok=" + verify_ok.to_string() + " — " + verify_summary);
    if ver.output.failures != () {
        verify_failures = json_encode(ver.output.failures);
    }
    write_scratch_file("phase9-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 9 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 9 — each PASS or BLOCKING:\n";
p_gate += "A1) contracts specify atomicity and stale-worker behavior precisely.\n";
p_gate += "    Evidence: JSDoc on interfaces; store-contracts.md; complete/renew require token.\n";
p_gate += "A2) implementations cannot claim correctness with non-atomic get/set logic.\n";
p_gate += "    Evidence: docs forbid get/set; memory declares single-process only; conformance atomic claim cases.\n";
p_gate += "A3) adapter guarantees are machine-readable and documented.\n";
p_gate += "    Evidence: StorageAdapterManifest type; MEMORY_STORAGE_ADAPTER_MANIFEST; JSON-serializable;\n";
p_gate += "    createMemoryStores().manifest; docs section.\n";
p_gate += "A4) indeterminate idempotency record blocks mutation replay until reconciliation or explicit operator decision.\n";
p_gate += "    Evidence: reserve returns kind indeterminate; conformance/unit test; docs.\n";
p_gate += "A5) long-running idempotency and reconciliation work can renew leases without allowing stale completion.\n";
p_gate += "    Evidence: renew success with valid token; renew/complete fail with stale token; tests.\n\n";
p_gate += "Also require Phase 9 sections 9.1-9.5 deliverables:\n";
p_gate += "- 9.1 three separate store interfaces with roadmap methods\n";
p_gate += "- 9.2 lease fields on claimable records\n";
p_gate += "- 9.3 fencing tokens/generations\n";
p_gate += "- 9.4 full error taxonomy\n";
p_gate += "- 9.5 StorageAdapterManifest\n";
p_gate += "- Memory NON-PRODUCTION + crash boundary docs\n";
p_gate += "- Conformance self-proof for memory\n";
p_gate += "- Phase 0-8 safety net still green; boundaries; no core→testkit dep\n";
p_gate += "- Core 0.x IdempotencyStore distinct and intact\n";
p_gate += "- No Phase 10 webhooks package; no real DB adapter packages\n";
p_gate += "- No logical bugs: stale complete succeeds; indeterminate re-reserves; multi-process claimed for memory;\n";
p_gate += "  secrets in store errors; universal mega-store interface; get/set advertised as atomic.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit; bun run typecheck; check:boundaries;\n";
p_gate += "focused storage conformance; validate:package if time.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/testkit/docs/phase-9-gate-report.md\n";
p_gate += "(also symlink/copy summary to packages/core/docs/baseline/phase-9-gate-report.md if monorepo convention\n";
p_gate += "expects gate reports under core/docs/baseline — prefer BOTH: primary detailed under testkit/docs,\n";
p_gate += "and a copy or short pointer under packages/core/docs/baseline/phase-9-gate-report.md).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase9-adversarial",
    capability_mode: "all",
    output_schema: gate_schema,
});

let gate_pass = false;
let blocking_json = "[]";
let gate_summary = "gate agent failed";
if gate != () && gate.success && gate.output != () {
    gate_pass = gate.output.pass == true;
    gate_summary = gate.output.summary;
    if gate.output.blocking != () {
        blocking_json = json_encode(gate.output.blocking);
    }
    log("Gate pass=" + gate_pass.to_string() + " — " + gate_summary);
    write_scratch_file("phase9-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 9 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 9 only — no Phase 10 webhooks package, no DB adapters.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete contracts precision, StorageAdapterManifest, memory manifests, conformance, docs as needed.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase9-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 9 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit, coverage, build, boundaries,\n";
    p_re += "runtime-portability, validate:package.\n";
    p_re += "Confirm all 9.1-9.5 deliverables and acceptance criteria A1-A5 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase9-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase9-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 9 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A5 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/testkit/docs/phase-9-gate-report.md and packages/core/docs/baseline/phase-9-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 9.1-9.5 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase9-final",
        capability_mode: "all",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        gate_summary = gate2.output.summary;
        if gate2.output.blocking != () {
            blocking_json = json_encode(gate2.output.blocking);
        }
        log("Final gate pass=" + gate_pass.to_string() + " — " + gate_summary);
        write_scratch_file("phase9-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 9 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 9,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
