let meta = #{
    name: "phase-17-cloudflare-do",
    description: "Phase 17 Cloudflare SQLite-backed Durable Object Adapter: critic, implement @paykernel/store-durable-objects (DO classes, Worker client, sharding, transactionSync, optional alarms), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 17 roadmap 17.1-17.5 and acceptance criteria" },
        #{ title: "Implement", detail: "adapter-cloudflare-do package: DO SQL storage, Worker client, sharding, alarms, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-16 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 17 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 17" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 17 (Cloudflare SQLite-backed Durable Object Adapter) for payments-sdk monorepo",
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
        "package_ok", "factories_ok", "do_sqlite_only_ok", "sharding_ok",
        "txn_serialization_ok", "no_external_in_txn_ok", "alarms_ok",
        "claim_atomic_ok", "migrations_ok", "manifest_ok", "conformance_ok",
        "testing_ok", "docs_ok", "no_d1_leak_ok", "no_global_do_ok",
        "compat_ok", "failures", "summary"
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
        "factories_ok": #{ "type": "boolean" },
        "do_sqlite_only_ok": #{ "type": "boolean" },
        "sharding_ok": #{ "type": "boolean" },
        "txn_serialization_ok": #{ "type": "boolean" },
        "no_external_in_txn_ok": #{ "type": "boolean" },
        "alarms_ok": #{ "type": "boolean" },
        "claim_atomic_ok": #{ "type": "boolean" },
        "migrations_ok": #{ "type": "boolean" },
        "manifest_ok": #{ "type": "boolean" },
        "conformance_ok": #{ "type": "boolean" },
        "testing_ok": #{ "type": "boolean" },
        "docs_ok": #{ "type": "boolean" },
        "no_d1_leak_ok": #{ "type": "boolean" },
        "no_global_do_ok": #{ "type": "boolean" },
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
    "/home/shahin/Documents/projects/personal/packages/payments-sdk"
} else {
    args.root
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 17 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 17 critic for the payments-sdk monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 17 — Cloudflare SQLite-Backed Durable Object Adapter\" completely\n";
p_critic += "(Package, Objective, Architecture, Tasks 17.1-17.5, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  11 atomicity by storage engine not get/set; 13 prepared / bound / scripted only;\n";
p_critic += "  14 no raw payloads by default; 15 portable timestamps/IDs;\n";
p_critic += "  16 every adapter same conformance suite; 17 document crash boundaries;\n";
p_critic += "  19 never auto-migrate on import/prod construction.\n";
p_critic += "Also section 3.1 (Do Not Publish One Generic adapter-cloudflare — D1 and DO are SEPARATE),\n";
p_critic += "3.2 Do Not Treat Every SQLite Product as the Same Runtime (DO is NOT local SQLite, NOT D1),\n";
p_critic += "3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings,\n";
p_critic += "3.5 Each Adapter Must Declare Its Guarantees,\n";
p_critic += "5 Proposed Repository Structure (adapter-cloudflare-do),\n";
p_critic += "5.1 Package Boundary Rules (Workers-only imports must not leak into Node/Bun/Deno portable packages),\n";
p_critic += "section 28 anti-patterns: never call external provider APIs inside DO storage transactions,\n";
p_critic += "section 30 Current Runtime Notes: SQLite-backed DOs provide private, transactional, strongly\n";
p_critic += "consistent storage per object; transactionSync() callbacks must remain synchronous;\n";
p_critic += "external provider calls must remain outside storage transactions;\n";
p_critic += "DO alarms execute at least once and may retry automatically — alarm handlers need same\n";
p_critic += "idempotency and lease protections as any other retry worker.\n";
p_critic += "Recheck official docs if needed:\n";
p_critic += "  https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/\n";
p_critic += "  https://developers.cloudflare.com/durable-objects/api/alarms/\n";
p_critic += "  https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/\n";
p_critic += "Phases 0-16 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, store contracts, webhook inbox engine,\n";
p_critic += "private internal/sql-store relational foundation, packages/store-postgres, adapter-redis,\n";
p_critic += "adapter-sqlite, adapter-turso, adapter-cloudflare-d1.\n";
p_critic += "Do NOT start Phase 18+ (capability matrix as separate deliverable only if docs need a pointer),\n";
p_critic += "reconciliation domain package, new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-16 domain/foundation packages unless required for monorepo wiring/docs.\n\n";

p_critic += "CONTEXT already present from Phase 9-16:\n";
p_critic += "- packages/testkit — LeaseAware IdempotencyStore / WebhookInboxStore / ReconciliationStore contracts\n";
p_critic += "- packages/testkit — runIdempotencyStoreConformanceSuite / runWebhookInboxStoreConformanceSuite / runReconciliationStoreConformanceSuite\n";
p_critic += "- packages/testkit — StorageAdapterManifest + assertStorageAdapterManifest + FakeClock\n";
p_critic += "- packages/webhooks — inbox engine; dual-owned WebhookInboxStore\n";
p_critic += "- internal/sql-store — schemas, codecs, migrations (FOUNDATION_SQL_SQLITE), claim templates with sqlite dialect\n";
p_critic += "  (idempotencyReserveTemplates().sqlite, webhookClaimTemplates().sqlite, etc.)\n";
p_critic += "  decideIdempotencyReserve / decideWebhookClaim algorithms\n";
p_critic += "- packages/store-postgres — Phase 12 COMPLETE — preserve\n";
p_critic += "- packages/store-redis — Phase 13 COMPLETE — preserve\n";
p_critic += "- packages/store-sqlite — Phase 14 COMPLETE single-host local SQLite — preserve; do NOT conflate with DO\n";
p_critic += "- packages/store-turso — Phase 15 COMPLETE multi-host remote — preserve\n";
p_critic += "- packages/store-d1 — Phase 16 COMPLETE multi-host shared D1 — preserve;\n";
p_critic += "  DO is SEPARATE package; do NOT merge into D1 or generic adapter-cloudflare.\n";
p_critic += "  Prefer D1/sql-store claim SQL + async client patterns where applicable, but DO uses\n";
p_critic += "  synchronous ctx.storage.sql.exec + transactionSync inside the object.\n";
p_critic += "- scripts/check-workspace-boundaries.ts — may need cloudflare-workers / DO allowlist updates\n";
p_critic += "- NO packages/store-durable-objects yet; monorepo docs say Durable Objects land in Phase 17.\n";
p_critic += "- Do NOT create a generic packages/adapter-cloudflare package.\n\n";

p_critic += "Audit against EVERY Phase 17 requirement with evidence (grep/read):\n\n";

p_critic += "Package: @paykernel/store-durable-objects under packages/store-durable-objects\n\n";

p_critic += "Objective: Use Durable Objects for strongly coordinated payment idempotency, webhook claiming,\n";
p_critic += "and retry scheduling where per-key serialization is beneficial.\n\n";

p_critic += "Architecture must provide:\n";
p_critic += "1) one or more Durable Object classes (SQLite-backed).\n";
p_critic += "2) a Worker-side client implementing store contracts (Phase 9).\n";
p_critic += "3) a deterministic sharding strategy (explicit, documented, not one global DO).\n\n";

p_critic += "17.1 SQLite-Backed Durable Objects Only:\n";
p_critic += "- Use the SQLite storage backend for every new Durable Object class.\n";
p_critic += "- Wrangler migrations must use new_sqlite_classes (NOT legacy new_classes KV-only backend).\n";
p_critic += "- Do NOT build new functionality on the legacy non-SQLite (KV-only) storage backend.\n";
p_critic += "- Prefer ctx.storage.sql.exec for claims; optional transactionSync for multi-statement atomicity.\n";
p_critic += "- sql.exec cannot run BEGIN/COMMIT — use transactionSync/transaction APIs instead.\n";
p_critic += "- Consume SQL cursors synchronously before any await (.toArray() / Array.from).\n\n";

p_critic += "17.2 Sharding Strategy:\n";
p_critic += "Support strategies such as:\n";
p_critic += "- one object per event or idempotency key (getByName / idFromName on the key).\n";
p_critic += "- hash-partitioned objects (bounded partition count).\n";
p_critic += "- one object per tenant for moderate workloads.\n";
p_critic += "Do NOT choose one universal default without contention and cost documentation.\n";
p_critic += "Document ordering guarantees of each strategy.\n";
p_critic += "NEVER route all payment work through one global Durable Object.\n";
p_critic += "Provide sharding helpers + tests comparing partition isolation vs same-key serialization.\n";
p_critic += "Document hot-key risks (single key always maps to one object; hot tenants can bottleneck).\n\n";

p_critic += "17.3 Transactions and Serialization:\n";
p_critic += "- Use DO storage transactions (transactionSync) or synchronous SQLite APIs per runtime requirements.\n";
p_critic += "- Do NOT hold a transaction open across provider network calls.\n";
p_critic += "Correct pattern:\n";
p_critic += "  1. claim atomically (inside transactionSync / single SQL claim).\n";
p_critic += "  2. commit claim (exit transaction).\n";
p_critic += "  3. perform external work OUTSIDE the transaction.\n";
p_critic += "  4. complete with lease-token validation.\n";
p_critic += "- transactionSync callbacks MUST be synchronous (no async/await inside).\n";
p_critic += "- Do not use blockConcurrencyWhile for every request (only schema init if needed).\n\n";

p_critic += "17.4 Alarms for Durable Retry (OPTIONAL):\n";
p_critic += "Optionally support Durable Object alarms for retryable webhook and reconciliation records.\n";
p_critic += "The alarm scheduler must:\n";
p_critic += "- be optional (default off or explicit enable).\n";
p_critic += "- use bounded retries.\n";
p_critic += "- apply backoff and jitter.\n";
p_critic += "- avoid one alarm per excessive record when a partitioned queue is more efficient\n";
p_critic += "  (prefer ONE alarm per DO partition + queue table of due work).\n";
p_critic += "- Alarms are at-least-once — handlers must re-check lease/claim state and be idempotent.\n\n";

p_critic += "17.5 Tests:\n";
p_critic += "- concurrent requests to the same key (exactly one winner).\n";
p_critic += "- different partitions (isolation / no cross-partition serialization required).\n";
p_critic += "- object eviction/restart (lease reclaim after restart with FakeClock).\n";
p_critic += "- alarm retry (optional path; mock setAlarm/alarm handler).\n";
p_critic += "- stale lease completion (StoreLeaseLostError).\n";
p_critic += "- SQLite transaction rollback (transactionSync throw → no partial write).\n";
p_critic += "Live/miniflare/vitest-pool-workers tests skip cleanly without env.\n";
p_critic += "Conformance suite must pass against mock DO SQL storage.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) strong per-partition coordination is preserved.\n";
p_critic += "A2) external payment calls never occur inside storage transactions.\n";
p_critic += "A3) sharding and hot-key risks are documented.\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/store-durable-objects depends on testkit + internal/sql-store (workspace:*)\n";
p_critic += "- MAY depend on core only if needed — prefer testkit contracts + sql-store foundation\n";
p_critic += "- core must NOT depend on adapter-cloudflare-do\n";
p_critic += "- webhooks must NOT depend on adapter-cloudflare-do\n";
p_critic += "- adapter-postgres / redis / sqlite / turso / cloudflare-d1 must NOT depend on it\n";
p_critic += "- paymentsSdk.runtime: \"cloudflare-only\" (or equivalent non-portable mark)\n";
p_critic += "- Define structural DurableObjectNamespace / SqlStorage types so monorepo typecheck does not\n";
p_critic += "  require cloudflare:workers protocol imports in portable packages.\n";
p_critic += "- Optional peer/devDependency: @cloudflare/workers-types — must not force\n";
p_critic += "  Workers-only imports into core/webhooks/testkit.\n";
p_critic += "- DO class source may document cloudflare:workers extends DurableObject for Worker deploy,\n";
p_critic += "  but root portable client/factory path should use structural types and avoid static\n";
p_critic += "  cloudflare:workers if that breaks monorepo typecheck — use a separate export or conditional.\n";
p_critic += "- Prefer: root exports Worker client + types + DO logic modules that take injected storage;\n";
p_critic += "  examples/ or worker/ entry can show real DurableObject subclass for wrangler.\n";
p_critic += "- do NOT create a generic adapter-cloudflare package\n";
p_critic += "- do NOT create packages/reconciliation domain package\n";
p_critic += "- do NOT conflate adapter-cloudflare-do with adapter-cloudflare-d1, adapter-sqlite, or adapter-turso\n\n";

p_critic += "Critical design constraints to flag as risks if missing plan:\n";
p_critic += "- Injectable clock for conformance (FakeClock.advance must control lease expiry)\n";
p_critic += "- Atomic claims via sql.exec UPSERT RETURNING and/or transactionSync — never get-then-set\n";
p_critic += "- generation monotonic on reserve/claim/renew; unguessable leaseToken\n";
p_critic += "- stale lease complete/fail → StoreLeaseLostError\n";
p_critic += "- indeterminate rows block reserve (A4 from Phase 9)\n";
p_critic += "- StorageAdapterManifest honesty: coordinationScope multi-host (partitioned DO);\n";
p_critic += "  durability durable; readAfterWrite strong within partition; notes on sharding, hot keys,\n";
p_critic += "  SQLite-only backend, transactionSync sync-only rule, optional alarms at-least-once\n";
p_critic += "- Map StoreErrorCode taxonomy; sanitized error fields; no secrets\n";
p_critic += "- exactOptionalPropertyTypes ON\n";
p_critic += "- Never auto-migrate on import or default createDoPaymentStores construction\n";
p_critic += "- Explicit schema ensure/migrate inside DO (blockConcurrencyWhile only for schema init)\n";
p_critic += "  and/or explicit migrate helper for packaged SQL — never on package import\n";
p_critic += "- Wrangler examples with durable_objects binding + new_sqlite_classes migrations\n";
p_critic += "- Live tests skip cleanly without miniflare/wrangler\n";
p_critic += "- Worker client is async (stub RPC); DO-internal SQL is synchronous\n";
p_critic += "- No single global DO default\n";
p_critic += "- External work never inside transactionSync\n";
p_critic += "- Text/IDs/hashes/lease tokens portable (TEXT)\n";
p_critic += "- Recheck DO SQLite storage + alarms APIs from official docs (section 30); pin verification date\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: legacy KV-only DO backend; single global DO; external I/O inside transactionSync;\n";
p_critic += "get-then-set claims; missing sharding docs; one alarm per record storms; secrets in errors;\n";
p_critic += "core→adapter dep; auto-migrate; FakeClock ignored; conflating with D1/sqlite/turso;\n";
p_critic += "async work inside transactionSync; cursor held across await; missing concurrency/partition tests.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase17-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase17-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 17 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 17\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 17 Cloudflare SQLite-backed Durable Object Adapter in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Webhooks = packages/webhooks = @paykernel/webhooks (0.1.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — Phase 9 contracts + conformance + FakeClock.\n";
common += "Sql-store = internal/sql-store = @paykernel/internal-sql-store (private Phase 11) — USE for schema/migrations/claim templates.\n";
common += "Postgres adapter = packages/store-postgres (Phase 12 COMPLETE) — preserve.\n";
common += "Redis adapter = packages/store-redis (Phase 13 COMPLETE) — preserve.\n";
common += "SQLite adapter = packages/store-sqlite (Phase 14 COMPLETE, single-host) — preserve; do NOT conflate with DO.\n";
common += "Turso adapter = packages/store-turso (Phase 15 COMPLETE, multi-host remote) — preserve.\n";
common += "D1 adapter = packages/store-d1 (Phase 16 COMPLETE, multi-host shared D1) — preserve;\n";
common += "  DO is a SEPARATE package. Do NOT merge into D1. Do NOT create generic adapter-cloudflare.\n";
common += "PHASE 17 ONLY: create packages/store-durable-objects = @paykernel/store-durable-objects.\n";
common += "Do NOT create packages/reconciliation (later). Do NOT add new PSPs or extract gateways.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside adapter-cloudflare-do; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-16 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + claim atomicity + conformance + sharding + txn rollback + alarms).\n";
common += "2) Atomic claims = engine-level SQL UPSERT RETURNING and/or transactionSync multi-statement;\n";
common += "   NEVER unprotected get-then-set as claim strategy.\n";
common += "3) Never convert uncertain outcomes into failure (respect indeterminate contracts).\n";
common += "4) No secret leakage in error fields.\n";
common += "5) No framework coupling in portable root packages; DO adapter is cloudflare-only.\n";
common += "6) Prefer structural DO/SqlStorage types — avoid forcing cloudflare:workers into portable packages.\n";
common += "7) Keep 0.x compat: core/webhooks/testkit/sql-store/adapter-* public APIs stable; additive only.\n";
common += "8) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "9) exactOptionalPropertyTypes is ON — no undefined assignment to optional props without care.\n";
common += "10) Core/webhooks/adapter-postgres/redis/sqlite/turso/d1 must NOT depend on adapter-cloudflare-do.\n";
common += "11) Portable ISO-8601 timestamps and opaque string lease tokens; TEXT for IDs/hashes/money-like values.\n";
common += "12) Do not store raw provider payloads/signatures by default.\n";
common += "13) Injectable clock: stores MUST accept clock/now so FakeClock works in conformance.\n";
common += "14) Publish honest StorageAdapterManifest: multi-host partitioned DO; durable; strong RAW within object;\n";
common += "    notes on sharding strategies, hot-key risks, SQLite-only, transactionSync, optional alarms.\n";
common += "15) Map driver errors into StoreErrorCode taxonomy (StoreLeaseLostError, StoreUnavailableError, etc.).\n";
common += "16) Never auto-migrate on import or default createDoPaymentStores — explicit schema ensure only.\n";
common += "17) Prefer sql-store SQLITE dialect schema + claim strategy adapted for DO sql.exec (sync) inside object.\n";
common += "18) Worker client is async (stub RPC); DO-internal SQL is synchronous; transactionSync must stay sync.\n";
common += "19) Document crash boundaries, sharding, hot keys, alarms at-least-once, Workers-only deployment.\n";
common += "20) Mirror Phase 9 contract semantics from packages/testkit/src/storage/contracts.ts.\n";
common += "21) Mirror packages/store-d1 + adapter-sqlite structure where useful, adapted for DO model.\n";
common += "22) Recheck official DO docs: sqlite-storage-api + alarms — pin verification date in manifest notes.\n";
common += "23) Roadmap architecture: DO class(es) + Worker-side client + deterministic sharding MUST exist.\n";
common += "24) Provide createDoPaymentStores / createDoIdempotencyStore / createDoWebhookInboxStore /\n";
common += "    createDoReconciliationStore and/or createDoStores bundle.\n";
common += "25) Do not treat DO as interchangeable with D1/Turso/local SQLite — separate package and docs.\n";
common += "26) NEVER hold transaction open across external provider network calls.\n";
common += "27) NEVER default to one global Durable Object for all payment work.\n";
common += "28) SQLite-backed only: new_sqlite_classes in Wrangler; no new legacy KV-only DO classes.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: package scaffold + DO SQL core + stores + sharding + migrate + manifest
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE SCAFFOLD + DO SQL STORAGE PORT + STORE LOGIC + SHARDING + WORKER CLIENT + MANIFEST (Tasks 17.1-17.3).\n";
p_a += "OWN primarily: packages/store-durable-objects/** (NEW package).\n";
p_a += "May touch root package.json scripts ONLY if needed — prefer leave monorepo polish to Integrate/Stream C.\n";
p_a += "Do NOT write phase-17-gate-report.md (Gate owns it).\n";
p_a += "Do NOT break packages/store-postgres, adapter-redis, adapter-sqlite, adapter-turso, or adapter-cloudflare-d1.\n\n";

p_a += "### Create package packages/store-durable-objects\n";
p_a += "Name: @paykernel/store-durable-objects\n";
p_a += "version 0.1.0; type module; publishable (NOT private).\n";
p_a += "description: Cloudflare SQLite-backed Durable Object stores for payments-sdk lease-aware idempotency, webhook inbox, and reconciliation (per-partition strong coordination).\n";
p_a += "dependencies:\n";
p_a += "  @paykernel/testkit: workspace:*\n";
p_a += "  @paykernel/internal-sql-store: workspace:*\n";
p_a += "optional peerDependencies / devDependencies:\n";
p_a += "  @cloudflare/workers-types — optional for improved DO typing (do NOT require at runtime)\n";
p_a += "peerDependenciesMeta: optional true if peers added\n";
p_a += "devDependencies: @types/bun, typescript, and optionally @cloudflare/workers-types for tests\n";
p_a += "scripts: build (root entry) + build:types, typecheck, test\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist\n";
p_a += "LICENSE MIT (copy from sibling). README + CHANGELOG.\n";
p_a += "publishConfig access public + provenance true (match adapter-cloudflare-d1).\n";
p_a += "paymentsSdk: { portable: false, runtime: \"cloudflare-only\" }\n";
p_a += "After package.json exists: bun install from monorepo root.\n\n";

p_a += "### Exports map\n";
p_a += "```json\n";
p_a += "{\n";
p_a += "  \".\": { \"types\": \"./dist/index.d.ts\", \"import\": \"./dist/index.js\" }\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Single root export is fine. Optional extra subpaths only if needed (e.g. ./worker for DO class entry).\n";
p_a += "Root must not require Cloudflare REST clients or account credentials for store construction.\n";
p_a += "Define structural types in src/types.ts so consumers can pass env.PAYMENTS_DO without importing cloudflare:workers in portable packages.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/store-durable-objects/src/\n";
p_a += "  index.ts                 # curated public root exports\n";
p_a += "  manifest.ts              # DO_STORAGE_ADAPTER_MANIFEST + getter\n";
p_a += "  types.ts                 # structural SqlStorageLike, DoNamespaceLike, sharding, clock, options\n";
p_a += "  sql-executor.ts          # narrow sync DO SQL executor over SqlStorageLike + transactionSync\n";
p_a += "  errors.ts                # map DO/sql errors → StoreErrorCode; strip secrets\n";
p_a += "  clock.ts                 # Clock interface compatible with testkit FakeClock\n";
p_a += "  migrate.ts               # ensureDoSchema / migrateDoAdapter (explicit; sql-store sqlite foundation)\n";
p_a += "  sharding.ts              # key | hash | tenant strategies; NEVER global singleton default\n";
p_a += "  stores/\n";
p_a += "    idempotency-store.ts    # may implement via partition router or direct executor\n";
p_a += "    webhook-inbox-store.ts\n";
p_a += "    reconciliation-store.ts\n";
p_a += "    shared.ts\n";
p_a += "  object/\n";
p_a += "    payments-store-object.ts  # DO class logic: methods for reserve/claim/complete + schema init\n";
p_a += "    alarm-scheduler.ts       # optional partitioned alarm queue (17.4)\n";
p_a += "  client.ts                # Worker-side createDoPaymentStores({ namespace, sharding, ... })\n";
p_a += "  index-stores.ts          # createDo* factories from executor or partition transport\n";
p_a += "  public-api.test.ts\n";
p_a += "  import-no-migrate.test.ts\n";
p_a += "  errors.test.ts\n";
p_a += "  sharding.test.ts\n";
p_a += "  stores/*.test.ts\n";
p_a += "  conformance.do.test.ts\n";
p_a += "  concurrency.do.test.ts\n";
p_a += "  partitions.do.test.ts\n";
p_a += "  transaction.do.test.ts\n";
p_a += "  restart.do.test.ts\n";
p_a += "  alarms.do.test.ts\n";
p_a += "  migrate.do.test.ts\n";
p_a += "  test-utils/\n";
p_a += "    mock-do-sql.ts          # faithful mock SqlStorage + transactionSync for unit/conformance (may use bun:sqlite TEST-ONLY)\n";
p_a += "    mock-namespace.ts       # mock DO namespace routing by name for partition tests\n";
p_a += "    do-env.ts               # env detection + skip helpers for miniflare/vitest-pool-workers\n";
p_a += "examples/wrangler.toml    # DO binding + new_sqlite_classes migration\n";
p_a += "docs/**\n\n";

p_a += "### Structural types (critical for monorepo typecheck)\n";
p_a += "```ts\n";
p_a += "export type SqlStorageCursorLike = {\n";
p_a += "  toArray(): Record<string, unknown>[];\n";
p_a += "  one?(): Record<string, unknown>;\n";
p_a += "  // iterable optional\n";
p_a += "};\n";
p_a += "export type SqlStorageLike = {\n";
p_a += "  exec(query: string, ...bindings: unknown[]): SqlStorageCursorLike;\n";
p_a += "};\n";
p_a += "export type DoStorageLike = {\n";
p_a += "  sql: SqlStorageLike;\n";
p_a += "  transactionSync<T>(callback: () => T): T;\n";
p_a += "  setAlarm?(scheduledTime: number | Date): Promise<void>;\n";
p_a += "  getAlarm?(): Promise<number | null>;\n";
p_a += "  deleteAlarm?(): Promise<void>;\n";
p_a += "};\n";
p_a += "export type DoStubLike = {\n";
p_a += "  // RPC surface — methods return promises for store ops\n";
p_a += "  [method: string]: (...args: unknown[]) => Promise<unknown> | unknown;\n";
p_a += "};\n";
p_a += "export type DoNamespaceLike = {\n";
p_a += "  idFromName(name: string): { toString(): string };\n";
p_a += "  get(id: { toString(): string }): DoStubLike;\n";
p_a += "  getByName?(name: string): DoStubLike; // preferred when available\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Do NOT require REST/HTTP for normal operation.\n\n";

p_a += "### Architecture pattern (MUST implement)\n";
p_a += "1) **In-object store logic** operates on DoStorageLike / SqlStorageLike synchronously for claims:\n";
p_a += "   - single-statement INSERT ON CONFLICT DO UPDATE … RETURNING preferred\n";
p_a += "   - multi-statement only inside transactionSync (sync callback, no await)\n";
p_a += "   - consume cursors with .toArray() before any await\n";
p_a += "2) **Worker-side client** implements async Phase 9 store interfaces by routing each op to a DO stub\n";
p_a += "   via sharding.resolve(key) → idFromName/getByName → RPC method on stub.\n";
p_a += "3) **Direct executor path for tests**: createDo*Store({ storage }) or createDo*Store({ executor })\n";
p_a += "   against mock-do-sql so conformance runs without Workers runtime.\n";
p_a += "4) **PaymentsStoreObject** (or similarly named) encapsulates schema ensure + claim RPC methods.\n";
p_a += "   For monorepo builds: implement as plain class taking DoStorageLike so it can be unit-tested\n";
p_a += "   without cloudflare:workers. Document real `extends DurableObject` wrapper in examples/docs.\n";
p_a += "   Optionally export a worker entry that subclasses DurableObject when types available.\n\n";

p_a += "### Sharding (17.2) — REQUIRED\n";
p_a += "```ts\n";
p_a += "export type DoShardingStrategy =\n";
p_a += "  | { kind: \"key\" } // one object per idempotency/event key (strongest per-key serialization)\n";
p_a += "  | { kind: \"hash\"; partitions: number } // bounded hash partitions (partitions >= 1, recommend >= 16)\n";
p_a += "  | { kind: \"tenant\"; tenantId: string | ((input) => string) }; // one object per tenant\n";
p_a += "// FORBIDDEN as default: { kind: \"global\" } or hard-coded name \"payments-global\"\n";
p_a += "export function resolveDoShardName(strategy, input: { key: string; tenantId?: string }): string\n";
p_a += "```\n";
p_a += "Rules:\n";
p_a += "- createDoPaymentStores MUST require an explicit sharding strategy (or document recommended defaults\n";
p_a += "  per use case without a silent global DO).\n";
p_a += "- If a default is offered, prefer `key` for pure idempotency/webhook claim keys, or require\n";
p_a += "  `hash` with explicit partitions — NEVER default to one global object.\n";
p_a += "- Document ordering: within a shard/object, requests serialize; across shards, no global order.\n";
p_a += "- Document hot-key: many ops for same key/tenant hit same object → latency/cost concentration.\n";
p_a += "- Reject partitions < 1; reject empty tenant ids; reject blank keys where applicable.\n";
p_a += "- Tests: same key → same shard name; different keys under hash → may differ; tenant isolation.\n\n";

p_a += "### Factories (roadmap architecture)\n";
p_a += "```ts\n";
p_a += "export function createDoPaymentStores(options: {\n";
p_a += "  namespace: DoNamespaceLike; // Worker binding\n";
p_a += "  sharding: DoShardingStrategy;\n";
p_a += "  clock?: StoreClock;\n";
p_a += "  namespacePrefix?: string; // table prefix / logical namespace\n";
p_a += "  alarms?: DoAlarmOptions; // optional 17.4\n";
p_a += "})\n";
p_a += "// Also support test path:\n";
p_a += "export function createDoPaymentStoresFromStorage(options: {\n";
p_a += "  storage: DoStorageLike; // single partition mock — or map of partition → storage\n";
p_a += "  sharding?: DoShardingStrategy;\n";
p_a += "  clock?: StoreClock;\n";
p_a += "})\n";
p_a += "```\n";
p_a += "createDoIdempotencyStore / createDoWebhookInboxStore / createDoReconciliationStore\n";
p_a += "createDoStores bundle. Names should be consistent and frozen in public-api.test.ts.\n\n";

p_a += "### Claim implementation (CRITICAL)\n";
p_a += "Implement full Phase 9 contracts for all three stores.\n";
p_a += "Claim strategy for DO SQLite:\n";
p_a += "PREFERRED: single-statement INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING via sql.exec\n";
p_a += "  (mirror adapter-sqlite / adapter-cloudflare-d1 / adapter-turso sqlite UPSERT claim SQL).\n";
p_a += "If multi-statement unavoidable: storage.transactionSync(() => { … pure sync sql … }).\n";
p_a += "NEVER await fetch/provider/network inside transactionSync.\n";
p_a += "Pattern for runtime callers (document + code comments):\n";
p_a += "  1) claim atomically  2) commit (leave txn)  3) external work  4) complete with lease token\n";
p_a += "Rules:\n";
p_a += "- generation increments on successful reserve/claim/renew that issues new lease\n";
p_a += "- leaseToken: unguessable from crypto.randomUUID or randomBytes\n";
p_a += "- complete/fail/renew require matching leaseToken; mismatch → StoreLeaseLostError\n";
p_a += "- fingerprint/payloadHash conflicts return explicit conflict kinds\n";
p_a += "- indeterminate: reserve returns kind indeterminate; cleanup does NOT remove by default\n";
p_a += "- prepared/bound only — NEVER string-interpolate user values (use ? bindings)\n";
p_a += "- injectable clock: lease predicates use clock.now() / nowIso\n";
p_a += "Read packages/store-sqlite/src/stores/* and packages/store-d1/src/stores/* as references.\n";
p_a += "Read packages/testkit/src/memory/memory-stores.ts as behavioral oracle.\n";
p_a += "Read internal/sql-store for schema columns and foundation migrations.\n\n";

p_a += "### Schema / migrate (explicit only)\n";
p_a += "ensureDoSchema(storage) / migrateDoAdapter(storageOrExecutor) applies sql-store sqlite foundation\n";
p_a += "  (CREATE TABLE IF NOT EXISTS …) — may run inside blockConcurrencyWhile-equivalent init once.\n";
p_a += "verifyDoAdapterSchema optional.\n";
p_a += "NEVER call migrate from package import or from createDoPaymentStores by default\n";
p_a += "  (schema ensure inside DO constructor via blockConcurrencyWhile is OK IF documented as DO lifecycle,\n";
p_a += "   not as auto-migrate on npm import of the package).\n";
p_a += "import-no-migrate.test.ts must prove package import does not run SQL.\n";
p_a += "Ship examples/wrangler.toml documenting durable_objects binding + new_sqlite_classes.\n\n";

p_a += "### Manifest (honesty — partitioned multi-host DO)\n";
p_a += "```ts\n";
p_a += "{\n";
p_a += "  name: \"cloudflare-do\",\n";
p_a += "  contracts: { idempotency: true, webhookInbox: true, reconciliation: true },\n";
p_a += "  consistency: { claims: \"strong\", readAfterWrite: \"strong\", staleReadsPossible: false },\n";
p_a += "  // strong RAW within a single DO instance; cross-partition no global order\n";
p_a += "  coordinationScope: \"multi-host\",\n";
p_a += "  durability: \"durable\",\n";
p_a += "  supportsTransactions: true, // transactionSync + implicit SQL atomicity\n";
p_a += "  supportsLeases: true,\n";
p_a += "  supportsRetentionCleanup: true,\n";
p_a += "  notes: [\n";
p_a += "    \"SQLite-backed Durable Objects only (new_sqlite_classes). Not legacy KV-only DO storage.\",\n";
p_a += "    \"Strong per-partition coordination; not a shared multi-primary global store.\",\n";
p_a += "    \"Not packages/store-d1 (shared D1). Not adapter-sqlite local file. Not adapter-turso.\",\n";
p_a += "    \"Never route all payment work through one global Durable Object.\",\n";
p_a += "    \"Sharding strategies: key | hash-partitioned | tenant — document ordering and hot-key risks.\",\n";
p_a += "    \"Claims use sql.exec UPSERT/RETURNING and/or transactionSync; never get-then-set.\",\n";
p_a += "    \"transactionSync callbacks must be synchronous; no await external I/O inside storage transactions.\",\n";
p_a += "    \"Correct pattern: claim → commit → external provider work → complete with lease token.\",\n";
p_a += "    \"Optional alarms are at-least-once; use partitioned queue + one alarm per DO; bounded retries + backoff/jitter.\",\n";
p_a += "    \"Injectable clock for FakeClock conformance; TEXT IDs/tokens/hashes; explicit schema ensure not import-time migrate.\",\n";
p_a += "    \"Pin verification date against Cloudflare DO SQLite storage + alarms docs.\",\n";
p_a += "  ]\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Validate with assertStorageAdapterManifest.\n\n";

p_a += "### Public exports — freeze in public-api.test.ts\n";
p_a += "createDoPaymentStores, createDoIdempotencyStore, createDoWebhookInboxStore, createDoReconciliationStore,\n";
p_a += "createDoStores / createDoPaymentStoresFromStorage as designed,\n";
p_a += "sharding helpers (resolveDoShardName, strategies),\n";
p_a += "migrate/ensure helpers, DO_STORAGE_ADAPTER_MANIFEST / getDoStorageAdapterManifest,\n";
p_a += "types, mapDriverError / StoreError re-exports, clock helpers,\n";
p_a += "PaymentsStoreObject logic / alarm helpers as appropriate.\n";
p_a += "Assert production source does not import D1-only APIs as required path.\n";
p_a += "Assert no REST-only construction path required.\n";
p_a += "Assert no default global DO shard strategy.\n\n";

p_a += "### Stream A tests\n";
p_a += "- public-api freeze + no illegal imports\n";
p_a += "- import-no-migrate\n";
p_a += "- store unit tests with mock-do-sql (test-utils; bun:sqlite TEST-ONLY OK in test-utils)\n";
p_a += "- sharding unit tests (key/hash/tenant; reject invalid; never global default)\n";
p_a += "- error mapping unit tests (secrets stripped)\n";
p_a += "- manifest assert + multi-host + strong RAW + sharding/hot-key honesty notes\n";
p_a += "- migrate/ensure schema tests\n";
p_a += "- transactionSync rollback test (throw aborts partial writes)\n";
p_a += "Run package typecheck/tests after wiring.\n";

let a_result = agent(p_a, #{
    label: "impl:17-do-core-stores",
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

// Parallel: B tests (conformance/concurrency/partitions/alarms/restart), C docs+monorepo+wrangler
log("Implementing Phase 17 tests and docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — CONFORMANCE + CONCURRENCY + PARTITIONS + TXN ROLLBACK + RESTART + ALARMS TESTS (Tasks 17.3-17.5, 17.4).\n";
p_b += "OWN: packages/store-durable-objects/src/test-utils/**, integration/conformance/sharding/alarm tests.\n";
p_b += "May extend Stream A store/claim/sharding files if missing transitions or bugs.\n";
p_b += "Do NOT write gate report. Do NOT break prior adapters.\n\n";

p_b += "### 17.5 Testing matrix (REQUIRED)\n";
p_b += "1) runIdempotencyStoreConformanceSuite with mock DO SQL + FakeClock\n";
p_b += "2) runWebhookInboxStoreConformanceSuite same\n";
p_b += "3) runReconciliationStoreConformanceSuite same\n";
p_b += "4) Concurrent requests same key: two store instances / parallel reserves → exactly one acquired\n";
p_b += "5) Different partitions: hash strategy with partitions=N; keys in different shards do not share storage\n";
p_b += "6) Object eviction/restart: store A claims; drop instance; store B with FakeClock reclaim or complete with lease\n";
p_b += "7) SQLite transaction rollback: transactionSync callback throws → no partial durable write\n";
p_b += "8) Stale lease complete/fail → StoreLeaseLostError\n";
p_b += "9) Alarm retry path (optional feature): mock setAlarm; alarm handler is idempotent; bounded retries;\n";
p_b += "   backoff/jitter applied; one alarm per partition queue not one alarm per record for many records\n";
p_b += "10) External-work-outside-txn invariant: unit/static test or documented code path that complete/claim\n";
p_b += "    never awaits network inside transactionSync (grep for await inside transactionSync bodies)\n";
p_b += "11) No global DO default\n";
p_b += "12) Optional live miniflare/vitest-pool-workers skip cleanly without env\n";
p_b += "Use unique table namespaces/prefixes per test run.\n";
p_b += "Env helpers document any CLOUDFLARE_* / miniflare flags used.\n\n";

p_b += "### 17.4 Alarms (optional but implement + test)\n";
p_b += "Implement optional DoAlarmOptions:\n";
p_b += "- enabled: boolean (default false)\n";
p_b += "- maxAttempts / maxRetries bounded\n";
p_b += "- baseBackoffMs + maxBackoffMs + jitter factor\n";
p_b += "- queue table or in-object schedule of due webhook/recon work\n";
p_b += "- single setAlarm per DO partition for next due item (not N alarms for N records)\n";
p_b += "- alarm() handler: claim with lease, process, complete/fail, reschedule if more due\n";
p_b += "- at-least-once: duplicate alarm delivery must not double-process without lease protection\n\n";

p_b += "### After implementation\n";
p_b += "bun install; typecheck package; bun test packages/store-durable-objects\n";
p_b += "Also run full monorepo safety including adapter-cloudflare-do:\n";
p_b += "bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCS + WRANGLER EXAMPLES + MONOREPO WIRING for Phase 17 (Tasks 17.1-17.5 docs).\n";
p_c += "OWN: packages/store-durable-objects/README.md, packages/store-durable-objects/docs/**,\n";
p_c += "packages/store-durable-objects/CHANGELOG.md Unreleased Phase 17,\n";
p_c += "packages/store-durable-objects/examples/wrangler.toml,\n";
p_c += "docs/monorepo.md (layout: packages/store-durable-objects present),\n";
p_c += "docs/workspace-boundaries.md (adapter-cloudflare-do rules, cloudflare-only, partitioned multi-host),\n";
p_c += "docs/releases.md note if adapters publish separately,\n";
p_c += "root package.json scripts: include adapter-cloudflare-do in build/typecheck/test filters AFTER adapter-cloudflare-d1,\n";
p_c += "root package.json description lists adapter-cloudflare-do,\n";
p_c += "packages/testkit/docs/store-contracts.md short pointer that Phase 17 DO adapter exists,\n";
p_c += "root README if it lists packages.\n";
p_c += "Update scripts/check-workspace-boundaries.ts ONLY if needed for optional @cloudflare/workers-types\n";
p_c += "or cloudflare-only runtime handling — do not weaken portable package rules.\n";
p_c += "Update packages/store-d1 docs that said \"Phase 17 not this package\" only if needed for cross-links\n";
p_c += "(optional pointer to new package — do not rewrite Phase 16 gate report history).\n";
p_c += "Do NOT write phase-17-gate-report.md (Gate owns it).\n\n";

p_c += "### Docs that MUST exist under packages/store-durable-objects/docs/\n";
p_c += "1) overview.md — purpose, SQLite-backed DO, Worker client, NOT D1, NOT local SQLite, NOT Turso\n";
p_c += "2) crash-boundaries.md — crash before/after side effect; lease reclaim; object eviction/restart\n";
p_c += "3) sharding.md — key/hash/tenant strategies; ordering guarantees; hot-key risks; NEVER global DO\n";
p_c += "4) claims.md — UPSERT/transactionSync; claim→commit→external→complete; no get-then-set\n";
p_c += "5) transactions.md — transactionSync sync-only; never external I/O inside txn; cursor sync consumption\n";
p_c += "6) alarms.md — optional; bounded retries; backoff+jitter; one alarm per partition queue; at-least-once\n";
p_c += "7) migrations.md — explicit ensure/migrate; never on package import; new_sqlite_classes only\n";
p_c += "8) testing.md — mock DO SQL, skip-without-env, FakeClock, partitions, alarms\n";
p_c += "9) guarantees.md — aligned with DO_STORAGE_ADAPTER_MANIFEST\n";
p_c += "10) limits.md — DO CPU/storage/request limits; hot partitions; comparison vs D1\n";
p_c += "11) wrangler.md — binding + new_sqlite_classes example\n\n";

p_c += "### Wrangler example (17.1)\n";
p_c += "examples/wrangler.toml:\n";
p_c += "```toml\n";
p_c += "name = \"payments-worker\"\n";
p_c += "main = \"src/index.ts\"\n";
p_c += "compatibility_date = \"2024-09-23\"\n";
p_c += "[[durable_objects.bindings]]\n";
p_c += "name = \"PAYMENTS_DO\"\n";
p_c += "class_name = \"PaymentsStoreObject\"\n";
p_c += "[[migrations]]\n";
p_c += "tag = \"v1\"\n";
p_c += "new_sqlite_classes = [\"PaymentsStoreObject\"]\n";
p_c += "```\n";
p_c += "Document that new_sqlite_classes is REQUIRED (not legacy new_classes KV-only).\n\n";

p_c += "### monorepo wiring (required)\n";
p_c += "Root workspaces already packages/* so adapter-cloudflare-do is auto-discovered.\n";
p_c += "Update scripts:\n";
p_c += "  build: ... && bun run --filter @paykernel/store-durable-objects build\n";
p_c += "    (order: ... → adapter-cloudflare-d1 → adapter-cloudflare-do)\n";
p_c += "  typecheck: include adapter-cloudflare-do filter\n";
p_c += "  test: include packages/store-durable-objects path\n";
p_c += "  test:adapter-cloudflare-do script recommended\n";
p_c += "  lint already covers packages/*/src\n";
p_c += "Run bun install after package creation.\n";
p_c += "Run bun run check:boundaries — must pass.\n";
p_c += "Emphasize partitioned multi-host DO; not shared D1; not local single-host SQLite; not Turso.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:17-tests-alarms", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:17-docs-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 17 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 18 matrix-only package work as a separate product, or reconciliation package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/store-durable-objects exists as @paykernel/store-durable-objects (publishable).\n";
p_int += "2) Architecture: DO class logic + Worker-side client + deterministic sharding all present.\n";
p_int += "3) createDoPaymentStores (or equivalent primary factory) + three Phase 9 store factories.\n";
p_int += "4) SQLite-backed only: new_sqlite_classes in examples; no legacy KV-only new DO backend.\n";
p_int += "5) Sharding strategies key/hash/tenant; NEVER one global DO default; hot-key docs.\n";
p_int += "6) Claims via sql.exec UPSERT and/or transactionSync; never get-then-set alone.\n";
p_int += "7) transactionSync remains synchronous; external work outside storage transactions.\n";
p_int += "8) Optional alarms: bounded retries, backoff+jitter, partitioned queue, at-least-once safe.\n";
p_int += "9) Injectable clock for FakeClock conformance.\n";
p_int += "10) StorageAdapterManifest: multi-host, durable, strong RAW within partition, honest notes.\n";
p_int += "11) Explicit schema ensure/migrate; never on package import.\n";
p_int += "12) Conformance suites pass on mock DO SQL storage.\n";
p_int += "13) Tests: concurrent same key, different partitions, restart/eviction, alarm retry,\n";
p_int += "    stale lease, transaction rollback.\n";
p_int += "14) Docs: overview, crash-boundaries, sharding, claims, transactions, alarms, migrations,\n";
p_int += "    testing, guarantees, limits, wrangler, README, CHANGELOG.\n";
p_int += "15) monorepo.md + workspace-boundaries.md updated; root scripts include package.\n";
p_int += "16) Phase 0-16 safety: typecheck, tests core+testkit+webhooks+sql-store+all adapters including do,\n";
p_int += "    build, boundaries, runtime portability green.\n";
p_int += "17) exactOptionalPropertyTypes clean.\n";
p_int += "18) public-api.test freezes exports; no illegal reverse deps.\n";
p_int += "19) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "20) If Stream A failed, implement the full adapter package yourself — Phase 17 cannot ship without it.\n";
p_int += "21) If docs/API names mismatch code, fix docs to match code (prefer roadmap createDoPaymentStores naming).\n";
p_int += "22) Ensure package builds dist for root entry.\n";
p_int += "23) Never advertise D1/local SQLite/Turso semantics for this package.\n";
p_int += "24) Auth/API tokens never appear in errors.\n";
p_int += "25) paymentsSdk.runtime cloudflare-only; portable false.\n";
p_int += "26) Grep: no await inside transactionSync callbacks in production source.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase17",
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
p_ver += "Verify Phase 17 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/store-durable-objects/dist/index.js && test -f packages/core/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence package @paykernel/store-durable-objects exists with factories\n";
p_ver += "12) Evidence DO class logic + Worker client + sharding strategy code\n";
p_ver += "13) Evidence SQLite-backed only (new_sqlite_classes, sql.exec path; no new legacy KV-only DO)\n";
p_ver += "14) Evidence sharding key/hash/tenant; no global DO default\n";
p_ver += "15) Evidence claim paths use UPSERT and/or transactionSync — not get-then-set alone\n";
p_ver += "16) Evidence transactionSync callbacks have no await/network I/O\n";
p_ver += "17) Evidence optional alarms with bounds/backoff/jitter/partitioned queue\n";
p_ver += "18) Evidence migrate/ensure explicit; not on package import\n";
p_ver += "19) Evidence StorageAdapterManifest multi-host + strong RAW + sharding/hot-key notes\n";
p_ver += "20) Evidence conformance tests pass on mock DO SQL\n";
p_ver += "21) Evidence concurrency, partitions, restart, txn rollback, stale lease, alarms tests\n";
p_ver += "22) Evidence docs complete including sharding.md and transactions.md\n";
p_ver += "23) Evidence core/webhooks/prior adapters have no adapter-cloudflare-do dep\n";
p_ver += "24) Evidence monorepo scripts include adapter-cloudflare-do\n";
p_ver += "25) Evidence no generic packages/adapter-cloudflare package created\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- package_ok: package exists with correct name and build\n";
p_ver += "- factories_ok: createDo* factories implement contracts\n";
p_ver += "- do_sqlite_only_ok: SQLite storage backend only; new_sqlite_classes\n";
p_ver += "- sharding_ok: strategies + no global default + tests/docs\n";
p_ver += "- txn_serialization_ok: transactionSync/sql atomic claims\n";
p_ver += "- no_external_in_txn_ok: no external I/O inside storage transactions\n";
p_ver += "- alarms_ok: optional alarms with required properties + tests\n";
p_ver += "- claim_atomic_ok: UPSERT/transactionSync claims\n";
p_ver += "- migrations_ok: explicit ensure/migrate; not on import\n";
p_ver += "- manifest_ok: multi-host honest notes\n";
p_ver += "- conformance_ok: suites pass on mock DO\n";
p_ver += "- testing_ok: 17.5 matrix covered\n";
p_ver += "- docs_ok: full docs set + monorepo links\n";
p_ver += "- no_d1_leak_ok: not conflated with D1 package; separate package\n";
p_ver += "- no_global_do_ok: no single global DO routing default\n";
p_ver += "- compat_ok: Phase 0-16 green; boundaries; no illegal deps\n";
p_ver += "Set ok=true only if typecheck, tests (all packages listed), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase17",
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
    write_scratch_file("phase17-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 17 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 17 — each PASS or BLOCKING:\n";
p_gate += "A1) strong per-partition coordination is preserved.\n";
p_gate += "    Evidence: multi-host partitioned DO manifest; atomic claims; concurrency same-key tests;\n";
p_gate += "    partition isolation tests; crash-boundaries; object restart/lease reclaim; durable notes.\n";
p_gate += "A2) external payment calls never occur inside storage transactions.\n";
p_gate += "    Evidence: claim→commit→external→complete pattern in code/docs;\n";
p_gate += "    transactionSync callbacks synchronous with no await/network; transactions.md.\n";
p_gate += "A3) sharding and hot-key risks are documented.\n";
p_gate += "    Evidence: sharding.md; strategies key/hash/tenant; NEVER global DO; hot-key notes in docs+manifest.\n\n";
p_gate += "Also require Phase 17 sections 17.1-17.5 deliverables:\n";
p_gate += "- 17.1 SQLite-backed DO only (new_sqlite_classes; sql.exec; not legacy KV-only new work)\n";
p_gate += "- 17.2 sharding strategies with deterministic routing; no universal silent global default\n";
p_gate += "- 17.3 transactions/serialization: transactionSync or sync SQL; no external I/O in txn\n";
p_gate += "- 17.4 optional alarms: bounded retries, backoff+jitter, efficient partitioned queue\n";
p_gate += "- 17.5 tests: concurrent same key, different partitions, eviction/restart, alarm retry,\n";
p_gate += "  stale lease, SQLite transaction rollback\n";
p_gate += "- Injectable clock for conformance\n";
p_gate += "- Explicit schema ensure/migrate only; never on package import\n";
p_gate += "- Phase 0-16 safety net still green; boundaries; no illegal deps\n";
p_gate += "- Separate from adapter-cloudflare-d1; no generic adapter-cloudflare package\n";
p_gate += "- No logical bugs: get/set claim race; external I/O in txn; global DO default; alarm storms;\n";
p_gate += "  secrets in errors; FakeClock ignored; auto-migrate on import; async transactionSync;\n";
p_gate += "  cursor held across await; conflating with D1/sqlite/turso; JS number precision for IDs.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_gate += "  bun run typecheck; check:boundaries; focused adapter-cloudflare-do tests.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/store-durable-objects/docs/phase-17-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-17-gate-report.md (full or pointer + verdict summary).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase17-adversarial",
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
    write_scratch_file("phase17-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 17 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 17 only — no Phase 18 product package, no reconciliation package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete packages/store-durable-objects: DO SQL stores, Worker client, sharding (no global DO),\n";
    p_fix += "transactionSync rules, optional alarms, concurrency/partition/restart/rollback tests,\n";
    p_fix += "docs, wrangler new_sqlite_classes example, monorepo wiring as needed.\n";
    p_fix += "Preserve Phase 0-16 and all prior adapters including adapter-cloudflare-d1.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase17-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 17 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm all 17.1-17.5 deliverables and acceptance criteria A1-A3 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase17-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase17-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 17 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/store-durable-objects/docs/phase-17-gate-report.md and packages/core/docs/baseline/phase-17-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 17.1-17.5 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase17-final",
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
        write_scratch_file("phase17-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 17 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 17,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
