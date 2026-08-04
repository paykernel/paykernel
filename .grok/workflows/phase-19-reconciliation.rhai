let meta = #{
    name: "phase-19-reconciliation",
    description: "Phase 19 Reconciliation Primitives and Durable Scheduling: critic, implement @paykernel/reconciliation (targets, snapshots, results, safe lookup, policy helpers, scheduler, batch), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 19 roadmap 19.1-19.7 and acceptance criteria" },
        #{ title: "Implement", detail: "reconciliation package: types, lookup, policy, scheduler, batch, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-18 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 19 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 19" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 19 (Reconciliation Primitives and Durable Scheduling) for PayKernel monorepo",
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
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 150 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": [
        "ok", "typecheck_ok", "tests_ok", "build_ok", "boundaries_ok",
        "package_ok", "target_types_ok", "snapshot_types_ok", "result_types_ok",
        "lookup_order_ok", "no_silent_multi_match_ok", "policy_helpers_ok",
        "no_auto_mutation_ok", "scheduler_ok", "backoff_ok", "batch_ok",
        "no_duplicate_charge_ok", "store_contract_ok", "no_testkit_dep_ok",
        "docs_ok", "compat_ok", "failures", "summary"
    ],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "pack_ok": #{ "type": "boolean" },
        "coverage_ok": #{ "type": "boolean" },
        "package_ok": #{ "type": "boolean" },
        "target_types_ok": #{ "type": "boolean" },
        "snapshot_types_ok": #{ "type": "boolean" },
        "result_types_ok": #{ "type": "boolean" },
        "lookup_order_ok": #{ "type": "boolean" },
        "no_silent_multi_match_ok": #{ "type": "boolean" },
        "policy_helpers_ok": #{ "type": "boolean" },
        "no_auto_mutation_ok": #{ "type": "boolean" },
        "scheduler_ok": #{ "type": "boolean" },
        "backoff_ok": #{ "type": "boolean" },
        "batch_ok": #{ "type": "boolean" },
        "no_duplicate_charge_ok": #{ "type": "boolean" },
        "store_contract_ok": #{ "type": "boolean" },
        "no_testkit_dep_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 19 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 19 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 19 — Reconciliation Primitives and Durable Scheduling\" completely\n";
p_critic += "(Package @paykernel/reconciliation, Objective, Reconciliation Is Required When,\n";
p_critic += "19.1 Reconciliation Target, 19.2 Provider Snapshot, 19.3 Result Types,\n";
p_critic += "19.4 Safe Lookup Order, 19.5 Policy Helpers, 19.6 Durable Scheduling,\n";
p_critic += "19.7 Batch Primitives, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 2 no unsafe mutation retries; 3 never convert uncertain to failure;\n";
p_critic += "  5 no secret leakage; 6 no framework coupling; 7 no Node-only in portable packages;\n";
p_critic += "  9 phase ends with typecheck/tests/build/docs; 11 atomicity by storage engine;\n";
p_critic += "  14 no raw payloads by default; 15 portable timestamps/IDs;\n";
p_critic += "  17 document crash boundaries.\n";
p_critic += "Also section 3.4 Separate Contracts from Driver Bindings:\n";
p_critic += "  reconciliation owns reconciliation persistence contracts.\n";
p_critic += "Also 5.1 Package Boundary Rules:\n";
p_critic += "  reconciliation may depend on normalized payment snapshot contracts from core;\n";
p_critic += "  testkit may depend on core, webhooks, and reconciliation;\n";
p_critic += "  core must NOT depend on reconciliation/webhooks/testkit/adapters.\n";
p_critic += "Also Phase 9 ReconciliationStore contract (store API already in testkit).\n";
p_critic += "Phases 0-18 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent, PaymentRuntime, store contracts, webhook inbox engine,\n";
p_critic += "sql-store, all adapters (postgres/redis/sqlite/turso/d1/do), adapter selection guide (Phase 18).\n";
p_critic += "Do NOT start Phase 20+ (observability package, OpenTelemetry mandatory wiring),\n";
p_critic += "Phase 21 routing, new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-18 domain/foundation packages unless required for monorepo wiring/docs.\n";
p_critic += "Do NOT create a mandatory queue product — scheduling must work via ReconciliationStore adapters.\n\n";

p_critic += "CONTEXT already present from Phase 9-18:\n";
p_critic += "- packages/testkit ReconciliationStore: schedule/claim/renew/complete/fail/markManualReview/get/listDue/deleteExpired\n";
p_critic += "- packages/testkit createMemoryReconciliationStore + runReconciliationStoreConformanceSuite\n";
p_critic += "- adapters implement ReconciliationStore (postgres, redis, sqlite, turso, d1, do)\n";
p_critic += "- core: Money, PaymentStatus, indeterminate outcomes with reconciliationRequired: true\n";
p_critic += "- packages/webhooks is the model portable domain package (engine + dual store contract ownership)\n";
p_critic += "- There is NO packages/reconciliation yet and NO @paykernel/reconciliation.\n";
p_critic += "- Boundary checker already treats @paykernel/reconciliation as portable by name.\n\n";

p_critic += "Audit against EVERY Phase 19 requirement with evidence (grep/read):\n\n";

p_critic += "Objective: recovery building blocks for unknown final state and local/provider drift.\n\n";

p_critic += "19.1 ReconciliationTarget — type with gateway, localReference?, gatewayPaymentId?,\n";
p_critic += "  idempotencyKey?, providerRequestId?, expected?: LocalPaymentSnapshot\n";
p_critic += "  (define LocalPaymentSnapshot honestly if not in core — status, amounts, refs).\n\n";

p_critic += "19.2 ProviderPaymentSnapshot — gatewayPaymentId, status: PaymentStatus, amount: Money,\n";
p_critic += "  capturedAmount?, refundedAmount?, updatedAt?, providerStatus: string, relatedIds?\n\n";

p_critic += "19.3 ReconciliationResult — EXACT discriminants:\n";
p_critic += "  consistent | drift_detected (differences: ReconciliationDifference[]) |\n";
p_critic += "  provider_not_found (retryable) | temporarily_unavailable (retryAfterMs?) |\n";
p_critic += "  ambiguous_match (matches) | manual_review_required (reason)\n";
p_critic += "  Differences must be machine-readable (path/field, local, provider or similar).\n\n";

p_critic += "19.4 Safe Lookup Order (when supported, never skip silently):\n";
p_critic += "  1 provider payment ID\n";
p_critic += "  2 provider idempotency key\n";
p_critic += "  3 merchant order/reference ID\n";
p_critic += "  4 provider request ID\n";
p_critic += "  Multiple matches MUST never resolve silently → ambiguous_match.\n\n";

p_critic += "19.5 Policy Helpers — decisions ONLY, not automatic business mutations:\n";
p_critic += "  - safe to update local pending → paid after verified lookup\n";
p_critic += "  - safe to mark failed only after definitive response\n";
p_critic += "  - manual review for ambiguous matches\n";
p_critic += "  - NEVER create a replacement payment while original is indeterminate\n";
p_critic += "  Policy must return decision enums; application applies mutations.\n\n";

p_critic += "19.6 Durable Scheduling via ReconciliationStore adapters:\n";
p_critic += "  await scheduler.schedule({ target, runAt, reason })\n";
p_critic += "  Support: exponential backoff with jitter; max attempts; manual review state;\n";
p_critic += "  dead-letter inspection; per-provider concurrency limits (document/config).\n";
p_critic += "  Do NOT require a specific queue. Store adapters or CF alarms may power scheduling.\n\n";

p_critic += "19.7 Batch: for await (const result of reconciler.reconcileMany(targets, { concurrency }))\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) indeterminate operations can be checked safely\n";
p_critic += "A2) differences are machine-readable\n";
p_critic += "A3) durable scheduling works through supported stores without a mandatory queue\n";
p_critic += "A4) reconciliation never creates duplicate charges\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/reconciliation = @paykernel/reconciliation (NEW publishable portable)\n";
p_critic += "- may depend on @paykernel/core (core) only for Money/PaymentStatus/etc.\n";
p_critic += "- must NOT depend on testkit, adapters, webhooks, frameworks, Redis, DB drivers\n";
p_critic += "- core must NOT depend on reconciliation\n";
p_critic += "- testkit MAY depend on reconciliation for integration/assignability (optional)\n";
p_critic += "- paymentsSdk.portable: true; no node:/bun: in production sources\n";
p_critic += "- Contract ownership: reconciliation owns ReconciliationStore dual types (like webhooks),\n";
p_critic += "  structural compatibility with testkit Phase 9 contract; adapters keep implementing testkit\n";
p_critic += "  or structural dual — no production import of testkit from reconciliation.\n\n";

p_critic += "Also check monorepo wiring gaps: root package.json build/test/typecheck omit reconciliation;\n";
p_critic += "docs/monorepo.md still says reconciliation lands later; no CHANGELOG/README/gate report.\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: silent multi-match resolution; auto-mutating local payments; creating replacement charges;\n";
p_critic += "converting indeterminate→failed without definitive provider data; requiring Redis/queue;\n";
p_critic += "storing secrets/raw payloads; get-then-set claims; core→reconciliation dep; reconciliation→testkit;\n";
p_critic += "Phase 20 OTEL scope creep; breaking adapter store APIs; non-machine-readable drift.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase19-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase19-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 19 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 19\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 19 Reconciliation package in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core.\n";
common += "Webhooks = packages/webhooks = @paykernel/webhooks — MODEL portable domain package.\n";
common += "Testkit = packages/testkit — Phase 9 ReconciliationStore + memory + conformance.\n";
common += "Adapters COMPLETE: postgres/redis/sqlite/turso/d1/do implement ReconciliationStore.\n";
common += "PHASE 19 ONLY: create @paykernel/reconciliation with primitives + scheduler + batch.\n";
common += "Do NOT create packages/observability (Phase 20). Do NOT add OpenTelemetry as mandatory.\n";
common += "Do NOT create new PSPs or extract gateways. Do NOT rewrite adapters unless dual-type docs only.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside reconciliation; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-18 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + concurrency + policy + lookup + batch + scheduler).\n";
common += "2) No unsafe mutation retries; NEVER create replacement charges while indeterminate.\n";
common += "3) Never convert uncertain outcomes into failure without definitive provider response.\n";
common += "4) Policy helpers return decisions only — no automatic local payment mutations.\n";
common += "5) No secret leakage in errors/logs/stored records (sanitize errors).\n";
common += "6) No framework coupling.\n";
common += "7) No Node-only assumptions — portable package (injectable clock/rng for jitter).\n";
common += "8) Keep 0.x compat: core + testkit + webhooks + adapters public APIs stable; additive only.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) exactOptionalPropertyTypes is ON — omit optional keys when absent.\n";
common += "11) Core must NOT depend on reconciliation or testkit.\n";
common += "12) Reconciliation must NOT depend on testkit, webhooks, adapters, Redis, or DB drivers.\n";
common += "13) Atomic claim via store.claim only — never get-then-set race in scheduler.\n";
common += "14) Portable ISO-8601 timestamps and opaque string lease tokens.\n";
common += "15) Multiple provider matches → ambiguous_match, never silent pick-first.\n";
common += "16) No mandatory queue — ReconciliationStore is the scheduling abstraction.\n";
common += "17) Machine-readable ReconciliationDifference fields.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: Package + core types + lookup + policy + reconciler + scheduler + batch
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE + TYPES + LOOKUP + POLICY + RECONCILER + SCHEDULER + BATCH (19.1–19.7).\n";
p_a += "OWN primarily: packages/reconciliation/** (NEW package).\n";
p_a += "May touch root package.json scripts, docs/monorepo.md ONLY if needed for discovery —\n";
p_a += "prefer leave monorepo polish to Integrate if Stream A is large.\n";
p_a += "Do NOT write phase-19-gate-report.md (Gate owns it).\n\n";

p_a += "### Create package packages/reconciliation\n";
p_a += "Name: @paykernel/reconciliation version 0.1.0\n";
p_a += "type module; exports \".\"; main/types dist; files: dist, docs, README, LICENSE\n";
p_a += "dependency: @paykernel/core workspace:*\n";
p_a += "devDependencies: @types/bun, typescript (mirror packages/webhooks)\n";
p_a += "paymentsSdk: { portable: true }\n";
p_a += "publishConfig access public provenance true\n";
p_a += "scripts: build (bun build + build:types), typecheck, test — mirror webhooks/testkit\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist, exclude **/*.test.ts from emit\n";
p_a += "Copy MIT LICENSE from packages/webhooks or core\n";
p_a += "After package.json exists: run bun install from monorepo root so workspace links resolve.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/reconciliation/src/\n";
p_a += "  index.ts                      # public exports only\n";
p_a += "  types.ts                      # Target, Snapshot, Result, Difference, LocalPaymentSnapshot\n";
p_a += "  store.ts                      # domain ReconciliationStore dual contract (reconciliation-owned)\n";
p_a += "  lookup.ts                     # safe lookup order + ProviderLookupPort\n";
p_a += "  compare.ts                    # snapshot diff → ReconciliationDifference[]\n";
p_a += "  policy.ts                     # decideReconciliationAction / policy helpers (no mutations)\n";
p_a += "  backoff.ts                    # exponential backoff + jitter (injectable rng)\n";
p_a += "  reconciler.ts                 # createPaymentReconciler + reconcileOne + reconcileMany\n";
p_a += "  scheduler.ts                  # createReconciliationScheduler over store\n";
p_a += "  sanitize.ts                   # sanitize errors (no secrets)\n";
p_a += "  public-api.test.ts            # freeze exports\n";
p_a += "  types.test.ts / compare.test.ts / lookup.test.ts / policy.test.ts\n";
p_a += "  reconciler.test.ts / scheduler.test.ts / backoff.test.ts / batch.test.ts\n";
p_a += "  store.assignability.test.ts   # structural compat with testkit if both exist\n";
p_a += "  no-duplicate-charge.test.ts   # A4 policy + reconciler never creates charges\n\n";

p_a += "### Domain store contract (reconciliation owns — roadmap 3.4)\n";
p_a += "Define ReconciliationStore + schedule/claim/renew/complete/fail/markManualReview/get/listDue\n";
p_a += "types in packages/reconciliation/src/store.ts matching Phase 9 testkit SEMANTICS so\n";
p_a += "createMemoryReconciliationStore is structurally assignable.\n";
p_a += "Include portable StoreLeaseLostError + isStoreLeaseLostError (mirror webhooks pattern).\n";
p_a += "Document durable adapters must pass runReconciliationStoreConformanceSuite (still in testkit).\n";
p_a += "NEVER import @paykernel/testkit from packages/reconciliation production sources.\n";
p_a += "For unit tests: implement a tiny in-package MemoryReconciliationStore (test-only, not public export)\n";
p_a += "matching the dual contract — preferred over testkit dependency.\n\n";

p_a += "### 19.1 Types\n";
p_a += "```ts\n";
p_a += "type LocalPaymentSnapshot = {\n";
p_a += "  status?: PaymentStatus; // from core\n";
p_a += "  amount?: Money;\n";
p_a += "  capturedAmount?: Money;\n";
p_a += "  refundedAmount?: Money;\n";
p_a += "  gatewayPaymentId?: string;\n";
p_a += "  localReference?: string;\n";
p_a += "};\n";
p_a += "type ReconciliationTarget = {\n";
p_a += "  gateway: string;\n";
p_a += "  localReference?: string;\n";
p_a += "  gatewayPaymentId?: string;\n";
p_a += "  idempotencyKey?: string;\n";
p_a += "  providerRequestId?: string;\n";
p_a += "  expected?: LocalPaymentSnapshot;\n";
p_a += "};\n";
p_a += "```\n";
p_a += "exactOptionalPropertyTypes-safe construction helpers optional.\n\n";

p_a += "### 19.2 ProviderPaymentSnapshot\n";
p_a += "```ts\n";
p_a += "type ProviderPaymentSnapshot = {\n";
p_a += "  gatewayPaymentId: string;\n";
p_a += "  status: PaymentStatus; // import type from core\n";
p_a += "  amount: Money;\n";
p_a += "  capturedAmount?: Money;\n";
p_a += "  refundedAmount?: Money;\n";
p_a += "  updatedAt?: string;\n";
p_a += "  providerStatus: string;\n";
p_a += "  relatedIds?: Record<string, string>;\n";
p_a += "};\n";
p_a += "```\n\n";

p_a += "### 19.3 Result types (EXACT discriminants)\n";
p_a += "```ts\n";
p_a += "type ReconciliationDifference = {\n";
p_a += "  field: string; // machine-readable path e.g. status | amount | capturedAmount\n";
p_a += "  local?: unknown;\n";
p_a += "  provider?: unknown;\n";
p_a += "  message?: string;\n";
p_a += "};\n";
p_a += "type ReconciliationResult =\n";
p_a += "  | { outcome: \"consistent\"; provider: ProviderPaymentSnapshot }\n";
p_a += "  | { outcome: \"drift_detected\"; provider: ProviderPaymentSnapshot; differences: ReconciliationDifference[] }\n";
p_a += "  | { outcome: \"provider_not_found\"; retryable: boolean }\n";
p_a += "  | { outcome: \"temporarily_unavailable\"; retryAfterMs?: number }\n";
p_a += "  | { outcome: \"ambiguous_match\"; matches: ProviderPaymentSnapshot[] }\n";
p_a += "  | { outcome: \"manual_review_required\"; reason: string };\n";
p_a += "```\n\n";

p_a += "### 19.4 Safe lookup (ProviderLookupPort + ordered resolve)\n";
p_a += "Define injectable ProviderLookupPort (gateway-agnostic):\n";
p_a += "  findByPaymentId?(gateway, id): Promise<LookupOutcome>\n";
p_a += "  findByIdempotencyKey?(gateway, key): Promise<LookupOutcome>\n";
p_a += "  findByLocalReference?(gateway, ref): Promise<LookupOutcome>\n";
p_a += "  findByProviderRequestId?(gateway, id): Promise<LookupOutcome>\n";
p_a += "LookupOutcome =\n";
p_a += "  | { kind: \"found\"; snapshots: ProviderPaymentSnapshot[] }  // 0/1/N — engine handles N\n";
p_a += "  | { kind: \"not_found\" }\n";
p_a += "  | { kind: \"unavailable\"; retryAfterMs?: number }\n";
p_a += "  | { kind: \"error\"; retryable: boolean; message?: string }\n";
p_a += "Safe order when supported (skip methods that are undefined, do NOT invent):\n";
p_a += "  1 gatewayPaymentId → findByPaymentId\n";
p_a += "  2 idempotencyKey → findByIdempotencyKey\n";
p_a += "  3 localReference → findByLocalReference\n";
p_a += "  4 providerRequestId → findByProviderRequestId\n";
p_a += "Rules:\n";
p_a += "  - If any step returns multiple snapshots → return ambiguous_match immediately (never pick first).\n";
p_a += "  - If single found → use it (then compare to expected if present).\n";
p_a += "  - If not_found at a step, continue to next supported step.\n";
p_a += "  - If all supported steps not_found → provider_not_found { retryable: true } (unknown may still settle).\n";
p_a += "  - If a step is unavailable → temporarily_unavailable (do not invent paid/failed).\n";
p_a += "  - If no lookup keys present at all → manual_review_required with clear reason.\n";
p_a += "  - If no lookup methods implemented for available keys → manual_review_required.\n\n";

p_a += "### 19.5 Policy helpers (NO side effects)\n";
p_a += "```ts\n";
p_a += "type ReconciliationDecision =\n";
p_a += "  | { action: \"update_local_to_paid\"; safe: true; provider: ProviderPaymentSnapshot }\n";
p_a += "  | { action: \"update_local_to_failed\"; safe: true; provider: ProviderPaymentSnapshot }\n";
p_a += "  | { action: \"mark_consistent\"; safe: true; provider: ProviderPaymentSnapshot }\n";
p_a += "  | { action: \"manual_review\"; safe: false; reason: string }\n";
p_a += "  | { action: \"retry_later\"; safe: false; retryAfterMs?: number }\n";
p_a += "  | { action: \"do_not_create_replacement\"; safe: false; reason: string }\n";
p_a += "  | { action: \"apply_drift_review\"; safe: false; differences: ReconciliationDifference[]; provider: ProviderPaymentSnapshot };\n";
p_a += "```\n";
p_a += "decideReconciliationPolicy(result, target): ReconciliationDecision\n";
p_a += "Rules (authoritative):\n";
p_a += "  - consistent → mark_consistent\n";
p_a += "  - drift_detected → apply_drift_review (never auto-mutate money totals)\n";
p_a += "  - if local pending/indeterminate and provider paid AND single verified match → update_local_to_paid\n";
p_a += "  - if local pending/indeterminate and provider definitive failed (not timeout) → update_local_to_failed\n";
p_a += "  - ambiguous_match → manual_review (never pick)\n";
p_a += "  - temporarily_unavailable / provider_not_found retryable → retry_later\n";
p_a += "  - ALWAYS expose do_not_create_replacement when status indeterminate or ambiguous\n";
p_a += "  - Policy functions MUST NOT call payment create/capture/refund APIs or mutate stores\n\n";

p_a += "### 19.6 Durable scheduler\n";
p_a += "createReconciliationScheduler({ store, clock?, defaultLeaseMs?, owner?, backoff?, maxAttempts? })\n";
p_a += "API (at minimum):\n";
p_a += "  schedule({ target, runAt, reason, key? }): Promise<ScheduleResult-like>\n";
p_a += "    - derive stable key from gateway + (gatewayPaymentId | idempotencyKey | localReference | providerRequestId)\n";
p_a += "    - store.schedule({ key, subjectId, reason, dueAt: runAt })\n";
p_a += "    - subjectId = gatewayPaymentId || localReference || key\n";
p_a += "  claimDue({ limit?, owner?, leaseMs? }): claim one or listDue+claim pattern — document honestly\n";
p_a += "  Prefer: listDue then atomic claim each; handle not_due/in_progress\n";
p_a += "  complete({ key, leaseToken })\n";
p_a += "  failAndReschedule({ key, leaseToken, error, attempt }) using backoff.nextDelayMs(attempt)\n";
p_a += "  markManualReview({ key, leaseToken, note? })\n";
p_a += "  listDeadLetter / inspect: jobs at max attempts or manual_review status via get/listDue\n";
p_a += "Backoff: createExponentialBackoff({ baseMs, maxMs, multiplier?, jitterRatio?, random? })\n";
p_a += "  delay = min(maxMs, baseMs * multiplier^attempt) * (1 ± jitter)\n";
p_a += "  injectable random(): number in [0,1) for tests\n";
p_a += "Document per-provider concurrency: applications may pass concurrency limit to claim/process loops;\n";
p_a += "optional maxInFlightByGateway map in processDue options.\n";
p_a += "NO queue product required.\n\n";

p_a += "### 19.7 Reconciler + batch\n";
p_a += "createPaymentReconciler({ lookup, clock? })\n";
p_a += "  reconcile(target): Promise<ReconciliationResult>\n";
p_a += "  reconcileMany(targets, { concurrency?: number }): AsyncIterable<ReconciliationResult> OR\n";
p_a += "    AsyncGenerator yielding results in completion order with bounded concurrency (default 5)\n";
p_a += "  Implement real async concurrency limiter (pool), not unlimited Promise.all for large batches.\n";
p_a += "  for await (const result of reconciler.reconcileMany(targets, { concurrency: 5 })) { ... }\n";
p_a += "  MUST work with empty targets (no yield).\n";
p_a += "  Errors from lookup map to temporarily_unavailable / provider_not_found — never throw unpaid as failed.\n\n";

p_a += "### Compare helper\n";
p_a += "compareSnapshots(local?, provider): ReconciliationDifference[]\n";
p_a += "  Compare status, amount (amount+currency), capturedAmount, refundedAmount when present.\n";
p_a += "  Money equality: amount string + currency case-sensitive match.\n";
p_a += "  Empty differences → consistent path.\n\n";

p_a += "### Public exports (index.ts)\n";
p_a += "createPaymentReconciler, createReconciliationScheduler, createExponentialBackoff,\n";
p_a += "decideReconciliationPolicy (and aliases if useful),\n";
p_a += "comparePaymentSnapshots / compareSnapshots,\n";
p_a += "resolveProviderSnapshot / safeLookup (internal or exported),\n";
p_a += "sanitizeReconciliationError,\n";
p_a += "StoreLeaseLostError, isStoreLeaseLostError,\n";
p_a += "types: all public types from types.ts + store.ts + policy + lookup port.\n";
p_a += "Do NOT export in-package test memory store from public index.\n";
p_a += "public-api.test.ts freezes runtime export names.\n\n";

p_a += "### Tests Stream A (must prove acceptance)\n";
p_a += "Use bun:test. In-package memory store for scheduler tests.\n";
p_a += "Required cases:\n";
p_a += "- A1 safe check: indeterminate local + provider paid → consistent or drift with decision update_local_to_paid; never auto-writes store payment\n";
p_a += "- A2 drift differences machine-readable field paths\n";
p_a += "- A3 schedule + claim + complete via memory ReconciliationStore (no queue)\n";
p_a += "- A4 policy do_not_create_replacement when indeterminate/ambiguous; reconciler has zero createPayment methods\n";
p_a += "- lookup order: payment id preferred; fallbacks work; multi-match → ambiguous_match\n";
p_a += "- temporarily_unavailable does not become failed\n";
p_a += "- provider_not_found retryable true when exhausted lookups\n";
p_a += "- backoff increases and respects max; jitter bounded with fixed rng\n";
p_a += "- max attempts → markManualReview / dead letter path\n";
p_a += "- reconcileMany concurrency: with slow lookup, concurrency limit not exceeded (counter)\n";
p_a += "- stale lease complete fails (StoreLeaseLostError)\n";
p_a += "- no secrets in sanitize\n";
p_a += "- structural assignability smoke if testkit types reachable without dep (optional dual string-compare)\n";
p_a += "Run: cd packages/reconciliation && bun test && bun run typecheck\n";

let a_result = agent(p_a, #{
    label: "impl:19-package-engine",
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

// Parallel: B docs; C monorepo wiring
log("Implementing Phase 19 docs and monorepo wiring in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — DOCUMENTATION for Phase 19 (packages/reconciliation docs + cross-links).\n";
p_b += "OWN: packages/reconciliation/README.md, packages/reconciliation/docs/*.md,\n";
p_b += "packages/reconciliation/CHANGELOG.md Unreleased Phase 19,\n";
p_b += "cross-links in packages/testkit/docs/store-contracts.md (engine/primitives live in reconciliation),\n";
p_b += "docs/monorepo.md layout (reconciliation present),\n";
p_b += "docs/workspace-boundaries.md (reconciliation portable, may depend on core),\n";
p_b += "docs/adapter-selection.md short pointer that reconciliation uses store adapters (optional one line),\n";
p_b += "root README package table if packages listed.\n";
p_b += "Do NOT write phase-19-gate-report.md (Gate owns it).\n";
p_b += "If packages/reconciliation does not exist yet, create docs after reading Stream A files;\n";
p_b += "if package still missing, create docs tree + README matching intended API from roadmap.\n\n";

p_b += "### packages/reconciliation/docs/ MUST cover\n";
p_b += "1) overview.md — purpose: recovery for indeterminate ops and drift; package boundary\n";
p_b += "2) reconciliation.md — target, snapshot, result types, compare, policy helpers, code samples\n";
p_b += "3) safe-lookup.md — ordered lookup, ambiguous_match, inject ProviderLookupPort\n";
p_b += "4) scheduling.md — scheduler over ReconciliationStore; backoff/jitter/max attempts;\n";
p_b += "   manual review; dead letter; no mandatory queue; CF alarms / store adapters may power it\n";
p_b += "5) crash-boundaries.md — before schedule; after schedule before claim; during lookup;\n";
p_b += "   after provider read before complete; after complete; never create duplicate charge\n";
p_b += "6) batch.md — reconcileMany concurrency, application persists/alerts\n\n";

p_b += "### README\n";
p_b += "Install, quickstart: inject lookup port + optional memory/test store, schedule, reconcile, policy.\n";
p_b += "Explicit: policy does not mutate; never creates replacement payments; multi-match not silent.\n\n";

p_b += "### CHANGELOG\n";
p_b += "Unreleased: initial @paykernel/reconciliation — types, lookup, policy, scheduler, batch.\n\n";

p_b += "### Cross-links accuracy\n";
p_b += "Re-read actual exports after writing; fix wrong API names.\n";
p_b += "Do not invent Phase 20 observability package.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — MONOREPO WIRING + OPTIONAL TESTKIT INTEGRATION.\n";
p_c += "OWN: root package.json scripts (build/test/typecheck include reconciliation),\n";
p_c += "docs/monorepo.md, docs/workspace-boundaries.md,\n";
p_c += "optional packages/testkit dependency on reconciliation for assignability/integration test,\n";
p_c += "tsconfig root project references if used,\n";
p_c += "scripts/check-workspace-boundaries already knows reconciliation name — verify still green.\n";
p_c += "Do NOT write gate report.\n\n";

p_c += "### Root package.json updates (required)\n";
p_c += "build order: core first, then webhooks, then reconciliation, then testkit (if testkit depends on them),\n";
p_c += "  then sql-store, then adapters. Include filter for @paykernel/reconciliation.\n";
p_c += "typecheck: include reconciliation\n";
p_c += "test: add packages/reconciliation to bun test list\n";
p_c += "build:types: include reconciliation\n";
p_c += "description mention reconciliation package\n\n";

p_c += "### Boundaries\n";
p_c += "Run bun run check:boundaries after wiring; fix any violations.\n";
p_c += "Ensure portable production sources in reconciliation have no node:/bun: imports.\n";
p_c += "Update workspace-boundaries.md expected layout: reconciliation present, portable, depends on core only.\n\n";

p_c += "### Optional integration proof\n";
p_c += "If safe: testkit may add workspace:* dep on reconciliation and an assignability test that\n";
p_c += "MemoryReconciliationStore is assignable to reconciliation's ReconciliationStore.\n";
p_c += "If dependency is risky, skip testkit dep and keep reconciliation self-contained tests only.\n\n";

p_c += "### After wiring run\n";
p_c += "bun install\n";
p_c += "bun run --filter @paykernel/reconciliation build || (cd packages/reconciliation && bun run build)\n";
p_c += "bun test packages/reconciliation\n";
p_c += "bun run check:boundaries\n";

let jobs = [
    #{ prompt: p_b, label: "impl:19-docs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:19-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 19 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 20 observability package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/reconciliation exists as @paykernel/reconciliation@0.1.0 with portable:true.\n";
p_int += "2) ReconciliationTarget, ProviderPaymentSnapshot, ReconciliationResult match roadmap 19.1-19.3.\n";
p_int += "3) Safe lookup order 19.4; multiple matches → ambiguous_match (tested).\n";
p_int += "4) Policy helpers return decisions only; never create replacement payment; never auto-mutate.\n";
p_int += "5) createReconciliationScheduler works on ReconciliationStore without mandatory queue.\n";
p_int += "6) Backoff with jitter + max attempts + manual review/dead-letter path.\n";
p_int += "7) reconcileMany with concurrency bound (async iterable).\n";
p_int += "8) Domain ReconciliationStore dual-owned; no reconciliation→testkit import.\n";
p_int += "9) Differences machine-readable; sanitize errors; no secrets.\n";
p_int += "10) Acceptance A1-A4 proven by tests.\n";
p_int += "11) Docs: overview, reconciliation, safe-lookup, scheduling, crash-boundaries, batch, README, CHANGELOG.\n";
p_int += "12) Root scripts build/test/typecheck include reconciliation; monorepo + boundaries docs updated.\n";
p_int += "13) Core does not depend on reconciliation; reconciliation does not depend on testkit/adapters.\n";
p_int += "14) Phase 0-18 safety: typecheck, full package tests, build, boundaries, runtime portability green.\n";
p_int += "15) exactOptionalPropertyTypes clean.\n";
p_int += "16) Public API freeze test for reconciliation exports.\n";
p_int += "17) dist builds (index.js + .d.ts).\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks packages/reconciliation internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "19) If Stream A failed, implement the full package yourself — Phase 19 cannot ship without it.\n";
p_int += "20) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap).\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase19",
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
p_ver += "Verify Phase 19 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) bun run typecheck\n";
p_ver += "3) bun run typecheck:types\n";
p_ver += "4) bun test packages/core packages/testkit packages/webhooks packages/reconciliation internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_ver += "5) bun test --coverage packages/core\n";
p_ver += "6) bun run build\n";
p_ver += "7) bun run check:boundaries\n";
p_ver += "8) bun run check:runtime-portability\n";
p_ver += "9) bun run validate:package\n";
p_ver += "10) Evidence packages/reconciliation package.json name @paykernel/reconciliation portable:true\n";
p_ver += "11) Evidence ReconciliationTarget, ProviderPaymentSnapshot, ReconciliationResult types\n";
p_ver += "12) Evidence safe lookup order implementation + multi-match → ambiguous_match test\n";
p_ver += "13) Evidence policy helpers are pure decisions (grep for createPayment/charge — must not exist as side effects)\n";
p_ver += "14) Evidence scheduler uses store.schedule/claim without queue product\n";
p_ver += "15) Evidence backoff + max attempts\n";
p_ver += "16) Evidence reconcileMany concurrency\n";
p_ver += "17) Evidence no production import of payments-testkit from packages/reconciliation/src\n";
p_ver += "18) Evidence docs present (overview/reconciliation/safe-lookup/scheduling/crash-boundaries)\n";
p_ver += "19) Evidence dist/index.js and dist/index.d.ts after build\n";
p_ver += "20) Evidence root scripts include reconciliation\n\n";
p_ver += "Set flags from verify_schema names. Set ok=true only if typecheck, tests, build, boundaries,\n";
p_ver += "and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase19",
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
    write_scratch_file("phase19-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 19 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 19 — each PASS or BLOCKING:\n";
p_gate += "A1) indeterminate operations can be checked safely.\n";
p_gate += "    Evidence: tests show lookup/reconcile without converting uncertain→failed; policy safe paths.\n";
p_gate += "A2) differences are machine-readable.\n";
p_gate += "    Evidence: ReconciliationDifference field paths; drift_detected tests.\n";
p_gate += "A3) durable scheduling works through supported stores without a mandatory queue.\n";
p_gate += "    Evidence: scheduler on ReconciliationStore; schedule/claim/complete tests; docs.\n";
p_gate += "A4) reconciliation never creates duplicate charges.\n";
p_gate += "    Evidence: no createPayment in package; do_not_create_replacement policy; tests.\n\n";
p_gate += "Also require:\n";
p_gate += "- Package @paykernel/reconciliation portable with core-only dependency\n";
p_gate += "- Types 19.1-19.3 present with exact result discriminants\n";
p_gate += "- Safe lookup order 19.4; multi-match never silent\n";
p_gate += "- Policy helpers 19.5 decisions only\n";
p_gate += "- Scheduler 19.6 backoff/max attempts/manual review\n";
p_gate += "- Batch 19.7 reconcileMany\n";
p_gate += "- Store dual ownership without reconciliation→testkit production dep\n";
p_gate += "- Phase 0-18 safety net still green\n";
p_gate += "- No Phase 20 observability package sneak-in\n";
p_gate += "- No logical bugs: silent multi-match; auto-mutate payments; require Redis/queue;\n";
p_gate += "  convert indeterminate to failed without definitive data; secrets in errors.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks packages/reconciliation internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_gate += "  bun run typecheck; check:boundaries.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/reconciliation/docs/phase-19-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-19-gate-report.md (or pointer).\n";
p_gate += "AND optionally docs/phase-19-gate-report.md pointer.\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase19-adversarial",
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
    write_scratch_file("phase19-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 19 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 19 only — no Phase 20 observability package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete packages/reconciliation: types, lookup, policy, scheduler, batch, tests, docs, wiring.\n";
    p_fix += "Preserve Phase 0-18 adapters and safety net.\n";
    p_fix += "After fixes re-run typecheck, full tests, build, boundaries, runtime-portability, validate:package.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase19-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 19 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, full package tests including packages/reconciliation,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm A1-A4 with file and test evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase19-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase19-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 19 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A4 with independent evidence.\n";
    p_gate2 += "Update packages/reconciliation/docs/phase-19-gate-report.md and baseline pointer.\n";
    p_gate2 += "pass=true only if acceptance criteria are evidenced and suite is green.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase19-final",
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
        write_scratch_file("phase19-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 19 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 19,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
