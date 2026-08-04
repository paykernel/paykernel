let meta = #{
    name: "phase-16-cloudflare-d1",
    description: "Phase 16 Cloudflare D1 Adapter: critic, implement @paykernel/store-d1 (D1 binding, prepared claims, batch, sessions, migrations, wrangler), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 16 roadmap 16.1-16.6 and acceptance criteria" },
        #{ title: "Implement", detail: "adapter-cloudflare-d1 package: stores, D1 binding, migrate, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-15 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 16 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 16" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 16 (Cloudflare D1 Adapter) for PayKernel monorepo",
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
        "package_ok", "factories_ok", "d1_binding_ok", "no_rest_required_ok",
        "claim_atomic_ok", "prepared_ok", "batch_ok", "sessions_ok",
        "migrations_ok", "numeric_portability_ok", "replication_ok",
        "manifest_ok", "conformance_ok", "testing_ok", "docs_ok",
        "no_local_sqlite_leak_ok", "no_do_package_ok", "compat_ok",
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
        "package_ok": #{ "type": "boolean" },
        "factories_ok": #{ "type": "boolean" },
        "d1_binding_ok": #{ "type": "boolean" },
        "no_rest_required_ok": #{ "type": "boolean" },
        "claim_atomic_ok": #{ "type": "boolean" },
        "prepared_ok": #{ "type": "boolean" },
        "batch_ok": #{ "type": "boolean" },
        "sessions_ok": #{ "type": "boolean" },
        "migrations_ok": #{ "type": "boolean" },
        "numeric_portability_ok": #{ "type": "boolean" },
        "replication_ok": #{ "type": "boolean" },
        "manifest_ok": #{ "type": "boolean" },
        "conformance_ok": #{ "type": "boolean" },
        "testing_ok": #{ "type": "boolean" },
        "docs_ok": #{ "type": "boolean" },
        "no_local_sqlite_leak_ok": #{ "type": "boolean" },
        "no_do_package_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 16 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 16 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 16 — Cloudflare D1 Adapter\" completely\n";
p_critic += "(Package, Objective, Tasks 16.1-16.6, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  11 atomicity by storage engine not get/set; 13 prepared / bound / scripted only;\n";
p_critic += "  14 no raw payloads by default; 15 portable timestamps/IDs;\n";
p_critic += "  16 every adapter same conformance suite; 17 document crash boundaries;\n";
p_critic += "  19 never auto-migrate on import/prod construction.\n";
p_critic += "Also section 3.1 (Do Not Publish One Generic adapter-cloudflare — D1 and DO are SEPARATE),\n";
p_critic += "3.2 Do Not Treat Every SQLite Product as the Same Runtime (D1 is NOT local SQLite),\n";
p_critic += "3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings,\n";
p_critic += "3.5 Each Adapter Must Declare Its Guarantees, 3.7 Local SQLite Is a Single-Host Default\n";
p_critic += "(contrast: D1 is multi-host Worker-native shared store),\n";
p_critic += "5 Proposed Repository Structure (adapter-cloudflare-d1),\n";
p_critic += "5.1 Package Boundary Rules (Workers-only imports must not leak into Node/Bun/Deno portable packages),\n";
p_critic += "section 30 Current Runtime Notes: D1 supports prepared statements and transactional batch();\n";
p_critic += "correctness-critical read-after-write must use explicit consistency strategy including Sessions.\n";
p_critic += "Recheck official docs if needed:\n";
p_critic += "  https://developers.cloudflare.com/d1/worker-api/\n";
p_critic += "  https://developers.cloudflare.com/d1/worker-api/d1-database/\n";
p_critic += "Phases 0-15 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, store contracts, webhook inbox engine,\n";
p_critic += "private internal/sql-store relational foundation, packages/store-postgres, adapter-redis,\n";
p_critic += "adapter-sqlite, adapter-turso.\n";
p_critic += "Do NOT start Phase 17+ (adapter-cloudflare-do Durable Objects),\n";
p_critic += "Phase 18 matrix-only work as a separate deliverable, reconciliation domain package,\n";
p_critic += "new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-15 domain/foundation packages unless required for monorepo wiring/docs.\n\n";

p_critic += "CONTEXT already present from Phase 9-15:\n";
p_critic += "- packages/testkit — LeaseAware IdempotencyStore / WebhookInboxStore / ReconciliationStore contracts\n";
p_critic += "- packages/testkit — runIdempotencyStoreConformanceSuite / runWebhookInboxStoreConformanceSuite / runReconciliationStoreConformanceSuite\n";
p_critic += "- packages/testkit — StorageAdapterManifest + assertStorageAdapterManifest + FakeClock\n";
p_critic += "- packages/webhooks — inbox engine; dual-owned WebhookInboxStore\n";
p_critic += "- internal/sql-store — schemas, codecs, migrations (FOUNDATION_SQL_SQLITE), claim templates with sqlite dialect\n";
p_critic += "  (idempotencyReserveTemplates().sqlite, webhookClaimTemplates().sqlite, etc.)\n";
p_critic += "  decideIdempotencyReserve / decideWebhookClaim algorithms\n";
p_critic += "- packages/store-postgres — Phase 12 async remote SQL pattern (subpaths, errors, manifest, migrate, skip-without-env)\n";
p_critic += "- packages/store-redis — Phase 13 COMPLETE — preserve\n";
p_critic += "- packages/store-sqlite — Phase 14 COMPLETE single-host local SQLite — preserve; do NOT conflate with D1\n";
p_critic += "- packages/store-turso — Phase 15 COMPLETE multi-host remote SQLite-compatible — preserve;\n";
p_critic += "  PREFER turso/postgres async remote structural model for D1 (async executor, multi-host),\n";
p_critic += "  but D1 API is Workers binding (prepare/bind/first/all/run/batch/withSession), NOT turso/libsql client.\n";
p_critic += "- scripts/check-workspace-boundaries.ts — may need cloudflare-workers types / D1-related allowlist updates\n";
p_critic += "- NO packages/store-d1 yet; monorepo docs say further adapters (d1/do) land later.\n";
p_critic += "- NO packages/store-durable-objects (Phase 17 — must stay absent).\n\n";

p_critic += "Audit against EVERY Phase 16 requirement with evidence (grep/read):\n\n";

p_critic += "Package: @paykernel/store-d1 under packages/store-d1\n\n";

p_critic += "Objective: Provide a D1-native store for Workers and Pages using SQLite semantics through the D1 API.\n";
p_critic += "D1 is a SHARED durable store across distributed Workers (multi-host). Local SQLite adapter remains single-host.\n";
p_critic += "Do NOT hide D1 behind adapter-sqlite. Do NOT create a generic adapter-cloudflare package.\n\n";

p_critic += "16.1 Accept a D1 Binding:\n";
p_critic += "```ts\n";
p_critic += "const stores = createD1PaymentStores({ db: env.PAYMENTS_DB });\n";
p_critic += "```\n";
p_critic += "- Accept Workers D1Database binding (structural type OK).\n";
p_critic += "- Do NOT require REST API / Cloudflare account API token for normal Worker operation.\n";
p_critic += "- Prefer Workers binding path as the primary/default production path.\n\n";

p_critic += "16.2 Use D1-Native Execution:\n";
p_critic += "- use prepared statements (db.prepare(...).bind(...).first/all/run).\n";
p_critic += "- prefer single-statement atomic claims (ON CONFLICT UPSERT + RETURNING where supported).\n";
p_critic += "- use batch() only for operations requiring multiple statements; verify rollback semantics.\n";
p_critic += "- use sessions (withSession / first-primary) when sequential consistency or primary-first reads required.\n";
p_critic += "- avoid assumptions copied from local synchronous SQLite drivers (no BEGIN IMMEDIATE sync callbacks,\n";
p_critic += "  no bun:sqlite / better-sqlite3 / node:sqlite APIs in this package).\n\n";

p_critic += "16.3 Schema and Migrations:\n";
p_critic += "- Provide D1-compatible SQL migration files and Wrangler examples.\n";
p_critic += "- Do NOT include unsupported transaction wrappers (BEGIN/COMMIT) in migration files intended for D1 execution.\n";
p_critic += "- Explicit migrate only — never auto-migrate on import or default create* construction.\n";
p_critic += "- Prefer sql-store foundation dialect sqlite where compatible with D1.\n\n";

p_critic += "16.4 Numeric Portability:\n";
p_critic += "- Store identifiers, lease tokens, hashes, and exact financial values as text or explicitly encoded values\n";
p_critic += "  where JavaScript integer precision could be a concern.\n";
p_critic += "- Timestamps as TEXT ISO-8601; generation may be INTEGER; lease tokens TEXT.\n\n";

p_critic += "16.5 Read Replication Awareness:\n";
p_critic += "- Correctness-critical claims are WRITES and must use the primary.\n";
p_critic += "- Reads immediately following writes must use a consistency strategy appropriate to D1 sessions\n";
p_critic += "  when read replication is enabled (e.g. withSession('first-primary') or bookmark-based sessions).\n";
p_critic += "- Document when stale replica reads are possible without sessions.\n\n";

p_critic += "16.6 Testing:\n";
p_critic += "Use Cloudflare local runtime and/or faithful D1 mock and test:\n";
p_critic += "- duplicate concurrent deliveries.\n";
p_critic += "- atomic claims.\n";
p_critic += "- D1 batch rollback.\n";
p_critic += "- primary/session behavior where testable.\n";
p_critic += "- migrations.\n";
p_critic += "- Worker restarts (lease reclaim after restart).\n";
p_critic += "Live/local D1 tests must skip cleanly without env/wrangler when unavailable.\n";
p_critic += "Conformance suite must pass against mock executor or local D1.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) safe for distributed Worker deployments (multi-host coordination via shared D1).\n";
p_critic += "A2) no local SQLite driver assumptions leak into the D1 implementation.\n";
p_critic += "A3) D1-specific guarantees and limits are documented.\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/store-d1 depends on testkit + internal/sql-store (workspace:*)\n";
p_critic += "- MAY depend on core only if needed — prefer testkit contracts + sql-store foundation\n";
p_critic += "- core must NOT depend on adapter-cloudflare-d1\n";
p_critic += "- webhooks must NOT depend on adapter-cloudflare-d1\n";
p_critic += "- adapter-postgres / adapter-redis / adapter-sqlite / adapter-turso must NOT depend on it\n";
p_critic += "- paymentsSdk.runtime: \"cloudflare-only\" (or equivalent non-portable mark)\n";
p_critic += "- Define structural D1Database / D1PreparedStatement types so monorepo typecheck does not\n";
p_critic += "  require cloudflare:workers protocol imports in portable packages.\n";
p_critic += "- Optional peer/devDependency: @cloudflare/workers-types for improved DX — must not force\n";
p_critic += "  Workers-only imports into core/webhooks/testkit.\n";
p_critic += "- Root entry should accept structural binding; avoid static import of cloudflare:workers if possible.\n";
p_critic += "- do NOT create adapter-cloudflare-do (Phase 17)\n";
p_critic += "- do NOT create a generic adapter-cloudflare package\n";
p_critic += "- do NOT create packages/reconciliation domain package\n";
p_critic += "- do NOT conflate adapter-cloudflare-d1 with adapter-sqlite (local) or adapter-turso (remote libsql)\n\n";

p_critic += "Critical design constraints to flag as risks if missing plan:\n";
p_critic += "- Injectable clock for conformance (FakeClock.advance must control lease expiry)\n";
p_critic += "- Prefer single-statement atomic UPSERT (ON CONFLICT … RETURNING) for D1 claims;\n";
p_critic += "  multi-statement only inside db.batch() with verified atomicity/rollback — never get-then-set\n";
p_critic += "- generation monotonic on reserve/claim/renew; unguessable leaseToken\n";
p_critic += "- stale lease complete/fail → StoreLeaseLostError\n";
p_critic += "- indeterminate rows block reserve (A4 from Phase 9)\n";
p_critic += "- StorageAdapterManifest honesty: coordinationScope multi-host for D1;\n";
p_critic += "  durability durable; notes on D1 API, batch semantics, sessions/read replication, Workers-only binding\n";
p_critic += "- Map StoreErrorCode taxonomy; sanitized error fields; no secrets (API tokens, account IDs if any)\n";
p_critic += "- exactOptionalPropertyTypes ON\n";
p_critic += "- Never auto-migrate on import or default createD1PaymentStores construction\n";
p_critic += "- Explicit migrateD1Adapter (or equivalent) using D1-compatible SQL / sql-store sqlite dialect\n";
p_critic += "- Migration SQL files free of BEGIN/COMMIT wrappers unsupported on D1 apply path\n";
p_critic += "- Wrangler examples (wrangler.toml d1_databases binding + migrate notes)\n";
p_critic += "- Live/local tests skip cleanly without CLOUDFLARE_ACCOUNT_ID / D1 local env / miniflare\n";
p_critic += "- Async executor (Workers D1 is async) — do NOT require sync transaction callbacks\n";
p_critic += "- Do not copy local SQLite BEGIN IMMEDIATE sync assumptions into D1 path\n";
p_critic += "- Sessions for read-after-write when replication enabled\n";
p_critic += "- Text/IDs/hashes/lease tokens portable (TEXT)\n";
p_critic += "- Recheck D1 prepare/bind/first/all/run/batch/withSession APIs from official docs (section 30)\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: local sqlite sync APIs leaked; get-then-set claims; missing sessions for RAW; REST required;\n";
p_critic += "BEGIN/COMMIT in D1 migrations; secrets in errors; core→adapter dep; auto-migrate;\n";
p_critic += "missing concurrency/batch/session tests; creating adapter-cloudflare-do; FakeClock ignored;\n";
p_critic += "JS number precision for IDs/money; dishonest multi-region ads; conflating with turso/sqlite.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase16-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase16-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 16 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 16\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 16 Cloudflare D1 Adapter in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Webhooks = packages/webhooks = @paykernel/webhooks (0.1.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — Phase 9 contracts + conformance + FakeClock.\n";
common += "Sql-store = internal/sql-store = @paykernel/internal-sql-store (private Phase 11) — USE for schema/migrations/claim templates.\n";
common += "Postgres adapter = packages/store-postgres (Phase 12 COMPLETE) — preserve.\n";
common += "Redis adapter = packages/store-redis (Phase 13 COMPLETE) — preserve.\n";
common += "SQLite adapter = packages/store-sqlite (Phase 14 COMPLETE, single-host) — preserve; do NOT conflate with D1.\n";
common += "Turso adapter = packages/store-turso (Phase 15 COMPLETE, multi-host remote) — preserve;\n";
common += "  MIRROR async remote SQL structure (executor/stores/migrate/manifest/errors/clock) but D1 API is different.\n";
common += "PHASE 16 ONLY: create packages/store-d1 = @paykernel/store-d1.\n";
common += "Do NOT create packages/store-durable-objects (Phase 17).\n";
common += "Do NOT create a generic packages/adapter-cloudflare package.\n";
common += "Do NOT create packages/reconciliation (later). Do NOT add new PSPs or extract gateways.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside adapter-cloudflare-d1; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-15 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + claim atomicity + conformance + D1 binding tests).\n";
common += "2) Atomic claims = engine-level single-statement UPSERT preferred for D1;\n";
common += "   multi-statement only inside db.batch() with verified atomicity/rollback;\n";
common += "   NEVER unprotected get-then-set as claim strategy.\n";
common += "3) Never convert uncertain outcomes into failure (respect indeterminate contracts).\n";
common += "4) No secret leakage in error fields (sanitize; never echo API tokens / account secrets).\n";
common += "5) No framework coupling in portable root packages; D1 adapter is cloudflare-only.\n";
common += "6) Prefer structural D1Database types — avoid forcing cloudflare:workers into portable packages.\n";
common += "7) Keep 0.x compat: core/webhooks/testkit/sql-store/adapter-* public APIs stable; additive only.\n";
common += "8) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "9) exactOptionalPropertyTypes is ON — no undefined assignment to optional props without care.\n";
common += "10) Core/webhooks/adapter-postgres/redis/sqlite/turso must NOT depend on adapter-cloudflare-d1.\n";
common += "11) Portable ISO-8601 timestamps and opaque string lease tokens; TEXT for IDs/hashes/money-like values.\n";
common += "12) Do not store raw provider payloads/signatures by default.\n";
common += "13) Injectable clock: stores MUST accept clock/now so FakeClock works in conformance.\n";
common += "14) Publish honest StorageAdapterManifest: multi-host for D1; durable;\n";
common += "    notes on D1 prepare/batch/sessions, Workers binding, read replication caveats.\n";
common += "15) Map driver errors into StoreErrorCode taxonomy (StoreLeaseLostError, StoreUnavailableError, etc.).\n";
common += "16) Never auto-migrate on import or default createD1PaymentStores — explicit migrate only.\n";
common += "17) Prefer sql-store SQLITE dialect schema + claim strategy adapted for async D1 (not local IMMEDIATE).\n";
common += "18) Async executor (Workers D1 is async) — do NOT require sync transaction callbacks like local SQLite.\n";
common += "19) Document crash boundaries, batch limits, sessions/replication, Workers-only deployment.\n";
common += "20) Mirror Phase 9 contract semantics from packages/testkit/src/storage/contracts.ts.\n";
common += "21) Mirror packages/store-turso structure (executor/stores/migrate/manifest/errors/clock)\n";
common += "    adapted for D1 Binding API (prepare/bind/first/all/run/batch/withSession).\n";
common += "22) Recheck official D1 docs: https://developers.cloudflare.com/d1/worker-api/ — pin verification date in manifest notes.\n";
common += "23) Roadmap factory name createD1PaymentStores({ db }) MUST exist as primary ergonomic API.\n";
common += "24) Also provide createD1IdempotencyStore / createD1WebhookInboxStore / createD1ReconciliationStore\n";
common += "    and/or createD1Stores bundle accepting { db } or { executor }.\n";
common += "25) Do not treat D1 as interchangeable with Turso/libsql or local SQLite — separate package and docs.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: package scaffold + executor + stores + claims + migrate + manifest
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE SCAFFOLD + D1 EXECUTOR PORT + STORE FACTORIES + CLAIMS + MIGRATE + MANIFEST (Tasks 16.1-16.4 partial).\n";
p_a += "OWN primarily: packages/store-d1/** (NEW package).\n";
p_a += "May touch root package.json scripts ONLY if needed — prefer leave monorepo polish to Integrate/Stream C.\n";
p_a += "Do NOT write phase-16-gate-report.md (Gate owns it).\n";
p_a += "Do NOT implement Durable Objects adapter (Phase 17).\n";
p_a += "Do NOT break packages/store-postgres, adapter-redis, adapter-sqlite, or adapter-turso.\n\n";

p_a += "### Create package packages/store-d1\n";
p_a += "Name: @paykernel/store-d1\n";
p_a += "version 0.1.0; type module; publishable (NOT private).\n";
p_a += "description: Cloudflare D1 stores for PayKernel lease-aware idempotency, webhook inbox, and reconciliation (Workers-native shared SQLite via D1 binding).\n";
p_a += "dependencies:\n";
p_a += "  @paykernel/testkit: workspace:*\n";
p_a += "  @paykernel/internal-sql-store: workspace:*\n";
p_a += "optional peerDependencies / devDependencies:\n";
p_a += "  @cloudflare/workers-types — optional for improved D1Database typing (do NOT require at runtime)\n";
p_a += "peerDependenciesMeta: optional true if peers added\n";
p_a += "devDependencies: @types/bun, typescript, and optionally @cloudflare/workers-types for tests\n";
p_a += "scripts: build (root entry) + build:types, typecheck, test\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist\n";
p_a += "LICENSE MIT (copy from sibling). README + CHANGELOG.\n";
p_a += "publishConfig access public + provenance true (match adapter-turso).\n";
p_a += "paymentsSdk: { portable: false, runtime: \"cloudflare-only\" }\n";
p_a += "After package.json exists: bun install from monorepo root.\n\n";

p_a += "### Exports map\n";
p_a += "```json\n";
p_a += "{\n";
p_a += "  \".\": { \"types\": \"./dist/index.d.ts\", \"import\": \"./dist/index.js\" }\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Single root export is fine (D1 is one binding surface). If helpful, optional \"./types\" only — no REST subpath required.\n";
p_a += "Root must not require Cloudflare REST clients or account credentials for store construction.\n";
p_a += "Define structural D1 types in src/types.ts so consumers can pass env.DB without this package importing cloudflare:workers.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/store-d1/src/\n";
p_a += "  index.ts                 # curated public root exports\n";
p_a += "  manifest.ts              # D1_STORAGE_ADAPTER_MANIFEST + getter\n";
p_a += "  types.ts                 # D1DatabaseLike, D1StoreOptions, clock, namespace, D1Executor\n";
p_a += "  executor.ts              # narrow async executor + createD1Executor(db)\n";
p_a += "  errors.ts                # map D1 errors → StoreErrorCode; strip secrets\n";
p_a += "  clock.ts                 # Clock interface compatible with testkit FakeClock\n";
p_a += "  migrate.ts               # migrateD1Adapter / verifyD1AdapterSchema\n";
p_a += "  stores/\n";
p_a += "    idempotency-store.ts\n";
p_a += "    webhook-inbox-store.ts\n";
p_a += "    reconciliation-store.ts\n";
p_a += "    shared.ts\n";
p_a += "  index-stores.ts          # createD1* factories + createD1PaymentStores / createD1Stores\n";
p_a += "  d1-binding.ts            # createD1PaymentStores({ db }) ergonomic binding (16.1)\n";
p_a += "  sessions.ts              # helpers for withSession / first-primary when available\n";
p_a += "  public-api.test.ts\n";
p_a += "  import-no-migrate.test.ts\n";
p_a += "  errors.test.ts\n";
p_a += "  stores/*.test.ts\n";
p_a += "  conformance.d1.test.ts\n";
p_a += "  batch.d1.test.ts\n";
p_a += "  sessions.d1.test.ts\n";
p_a += "  concurrency.d1.test.ts\n";
p_a += "  migrate.d1.test.ts\n";
p_a += "  restart.d1.test.ts\n";
p_a += "  test-utils/\n";
p_a += "    mock-d1.ts             # faithful mock D1Database for unit/conformance without Workers\n";
p_a += "    d1-env.ts              # env detection + skip helpers for local wrangler/miniflare\n";
p_a += "migrations/ or sql/       # D1-compatible SQL migration files (no BEGIN/COMMIT wrappers)\n";
p_a += "examples/wrangler.toml    # Wrangler D1 binding example\n";
p_a += "docs/**\n\n";

p_a += "### Structural D1 types (16.1) — critical for monorepo typecheck\n";
p_a += "```ts\n";
p_a += "// Minimal structural surface — duck-types real D1Database from Workers\n";
p_a += "export type D1PreparedStatementLike = {\n";
p_a += "  bind(...values: unknown[]): D1PreparedStatementLike;\n";
p_a += "  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;\n";
p_a += "  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta?: unknown }>;\n";
p_a += "  run(): Promise<{ success: boolean; meta?: { changes?: number }; results?: unknown[] }>;\n";
p_a += "};\n";
p_a += "export type D1DatabaseLike = {\n";
p_a += "  prepare(query: string): D1PreparedStatementLike;\n";
p_a += "  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<T[]>;\n";
p_a += "  exec?(query: string): Promise<unknown>;\n";
p_a += "  withSession?(constraintOrBookmark?: string): D1DatabaseLike; // sessions API\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Do NOT require REST/HTTP D1 API client for normal operation.\n\n";

p_a += "### Narrow D1Executor (async — Workers-friendly)\n";
p_a += "```ts\n";
p_a += "export interface D1Executor {\n";
p_a += "  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;\n";
p_a += "  execute(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;\n";
p_a += "  /** Multi-statement transactional batch when available (D1 batch()). */\n";
p_a += "  batch?(statements: Array<{ sql: string; params?: readonly unknown[] }>): Promise<void>;\n";
p_a += "  /** Optional: obtain a session-scoped executor (primary-first / sequential consistency). */\n";
p_a += "  withSession?(constraintOrBookmark?: string): D1Executor;\n";
p_a += "}\n";
p_a += "```\n";
p_a += "createD1Executor(db: D1DatabaseLike, options?: { session?: string }): D1Executor\n";
p_a += "Also provide toSqlStoreExecutor adapter for sql-store migrate().\n";
p_a += "Stores MUST depend only on D1Executor (+ clock + namespace), never on Workers globals.\n";
p_a += "Under the hood: prepare + bind + first/all/run; batch maps to db.batch([...prepared]).\n\n";

p_a += "### Claim implementation (CRITICAL — prefer single-statement)\n";
p_a += "Implement full Phase 9 contracts for:\n";
p_a += "  createD1IdempotencyStore\n";
p_a += "  createD1WebhookInboxStore\n";
p_a += "  createD1ReconciliationStore\n";
p_a += "  createD1Stores / createD1PaymentStores (bundle — roadmap name createD1PaymentStores REQUIRED)\n\n";
p_a += "```ts\n";
p_a += "export function createD1PaymentStores(options: { db: D1DatabaseLike; clock?; namespace?; session? }) {\n";
p_a += "  const executor = createD1Executor(options.db, { session: options.session });\n";
p_a += "  return createD1Stores({ executor, clock: options.clock, namespace: options.namespace });\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Claim strategy for D1:\n";
p_a += "PREFERRED: single-statement INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING\n";
p_a += "  using SQLite-compatible UPSERT + RETURNING (D1 is SQLite-based).\n";
p_a += "  Mirror packages/store-turso/src/stores/* claim SQL (sqlite placeholders ?).\n";
p_a += "If multi-statement unavoidable: use executor.batch so decision+write is one atomic batch.\n";
p_a += "Do NOT do unprotected get-then-set across round-trips without batch atomicity.\n";
p_a += "Rules:\n";
p_a += "- generation increments on successful reserve/claim/renew that issues new lease\n";
p_a += "- leaseToken: unguessable from crypto.randomUUID or randomBytes\n";
p_a += "- complete/fail/renew require matching leaseToken; mismatch → StoreLeaseLostError\n";
p_a += "- fingerprint/payloadHash conflicts return explicit conflict kinds\n";
p_a += "- indeterminate: reserve returns kind indeterminate; cleanup does NOT remove by default\n";
p_a += "- prepared/bound only — NEVER string-interpolate user values\n";
p_a += "- injectable clock: lease predicates use clock.now() / nowIso\n";
p_a += "Read packages/store-turso/src/stores/* as primary structural reference (async sqlite UPSERT).\n";
p_a += "Read packages/testkit/src/memory/memory-stores.ts as behavioral oracle.\n";
p_a += "Read internal/sql-store for schema columns and foundation migrations.\n\n";

p_a += "### Migrate (explicit only) — 16.3\n";
p_a += "migrateD1Adapter(executorOrDb, options?) → apply D1-compatible foundation SQL (sql-store dialect sqlite\n";
p_a += "  or D1 migration files under package migrations/ without BEGIN/COMMIT wrappers).\n";
p_a += "verifyD1AdapterSchema(executorOrDb, options?)\n";
p_a += "NEVER call migrate from package import or from createD1PaymentStores by default.\n";
p_a += "import-no-migrate.test.ts must prove this.\n";
p_a += "Ship migrations/*.sql and examples/wrangler.toml documenting d1_databases binding + migrate apply.\n\n";

p_a += "### Numeric portability — 16.4\n";
p_a += "Use TEXT columns for keys, lease tokens, fingerprints/hashes, ISO timestamps, and any exact money-like values.\n";
p_a += "generation may be INTEGER. Do not store opaque IDs as JS Number/float. Align with sql-store sqlite foundation.\n\n";

p_a += "### Manifest (honesty — D1 multi-host Workers store)\n";
p_a += "```ts\n";
p_a += "{\n";
p_a += "  name: \"cloudflare-d1\",\n";
p_a += "  contracts: { idempotency: true, webhookInbox: true, reconciliation: true },\n";
p_a += "  consistency: { claims: \"strong\", readAfterWrite: \"session-dependent\", staleReadsPossible: true },\n";
p_a += "  // NOTE: if sessions always used for RAW, staleReadsPossible may be false with caveats in notes.\n";
p_a += "  // Prefer honest: staleReadsPossible true when read replication enabled without sessions; document fix.\n";
p_a += "  coordinationScope: \"multi-host\",\n";
p_a += "  durability: \"durable\",\n";
p_a += "  supportsTransactions: true, // via batch() atomic multi-statement\n";
p_a += "  supportsLeases: true,\n";
p_a += "  supportsRetentionCleanup: true,\n";
p_a += "  notes: [\n";
p_a += "    \"Workers/Pages D1 binding store for multi-instance Worker deployments (shared D1 database).\",\n";
p_a += "    \"Not the same as packages/store-sqlite local single-host file databases.\",\n";
p_a += "    \"Not the same as packages/store-turso Turso/libSQL clients.\",\n";
p_a += "    \"Normal operation uses D1 Workers binding only — no Cloudflare REST API required.\",\n";
p_a += "    \"Claims prefer single-statement ON CONFLICT/RETURNING UPSERTs; multi-statement only via D1 batch().\",\n";
p_a += "    \"Never unprotected get-then-set across round-trips for claim correctness.\",\n";
p_a += "    \"Uses prepared statements (prepare/bind/first|all|run) — no string interpolation of user values.\",\n";
p_a += "    \"Correctness-critical claims are writes against the primary; use withSession('first-primary') or bookmarks for read-after-write when read replication is enabled.\",\n";
p_a += "    \"Without sessions, stale replica reads are possible under D1 read replication.\",\n";
p_a += "    \"Migration SQL must not wrap statements in BEGIN/COMMIT for D1 apply path; use explicit migrateD1Adapter.\",\n";
p_a += "    \"Never auto-migrate on package import or default createD1PaymentStores construction.\",\n";
p_a += "    \"Injectable clock: lease reclaim uses injected now; FakeClock works in conformance tests.\",\n";
p_a += "    \"Identifiers, lease tokens, hashes, and exact financial values stored as TEXT for JS precision safety.\",\n";
p_a += "    \"Async D1 API only — no local sync SQLite transaction callbacks (BEGIN IMMEDIATE).\",\n";
p_a += "    \"Pin verification date against Cloudflare D1 Workers Binding API docs in this package's docs.\",\n";
p_a += "  ]\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Validate with assertStorageAdapterManifest. Adjust consistency fields only if tests prove stronger guarantees.\n\n";

p_a += "### Public exports — freeze in public-api.test.ts\n";
p_a += "createD1PaymentStores (REQUIRED roadmap name),\n";
p_a += "createD1IdempotencyStore, createD1WebhookInboxStore, createD1ReconciliationStore, createD1Stores,\n";
p_a += "createD1Executor,\n";
p_a += "migrateD1Adapter, verifyD1AdapterSchema,\n";
p_a += "D1_STORAGE_ADAPTER_MANIFEST / getD1StorageAdapterManifest,\n";
p_a += "D1DatabaseLike / D1Executor types, mapDriverError / StoreError re-exports as needed,\n";
p_a += "clock helpers, session helpers.\n";
p_a += "Assert no static import of bun:sqlite, better-sqlite3, node:sqlite, @libsql/client, @tursodatabase/serverless.\n";
p_a += "Assert no REST-only construction path required for createD1PaymentStores.\n\n";

p_a += "### Stream A tests\n";
p_a += "- public-api freeze + no local-sqlite driver imports\n";
p_a += "- import-no-migrate\n";
p_a += "- store unit tests with mock D1Database (test-utils/mock-d1.ts using in-memory sqlite semantics OR pure JS mock)\n";
p_a += "- error mapping unit tests (secrets stripped)\n";
p_a += "- manifest assert + coordinationScope multi-host + sessions/replication honesty\n";
p_a += "- migrate unit tests against mock executor; migration SQL has no BEGIN/COMMIT wrappers\n";
p_a += "- numeric portability assertions (TEXT columns for keys/tokens/hashes)\n";
p_a += "Run package typecheck/tests after wiring.\n";

let a_result = agent(p_a, #{
    label: "impl:16-stores-claims",
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

// Parallel: B D1 binding tests/sessions/batch/conformance, C docs+monorepo+wrangler
log("Implementing Phase 16 binding tests and docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — D1 BINDING + CONFORMANCE + BATCH + SESSIONS + CONCURRENCY + RESTART TESTS (Tasks 16.1, 16.2, 16.5, 16.6).\n";
p_b += "OWN: packages/store-d1/src/test-utils/**, binding/session helpers, integration/conformance/batch/session tests.\n";
p_b += "May extend Stream A store/claim files if missing transitions or bugs.\n";
p_b += "Do NOT write gate report. Do NOT create Phase 17 DO adapter.\n";
p_b += "Do NOT break adapter-postgres/redis/sqlite/turso.\n\n";

p_b += "### 16.1 D1 Binding path\n";
p_b += "```ts\n";
p_b += "import { createD1PaymentStores } from \"@paykernel/store-d1\";\n";
p_b += "// In a Worker:\n";
p_b += "const stores = createD1PaymentStores({ db: env.PAYMENTS_DB });\n";
p_b += "```\n";
p_b += "Prove createD1PaymentStores accepts structural D1DatabaseLike.\n";
p_b += "Prove no REST/account credentials required.\n";
p_b += "createD1Executor(db) uses prepare/bind/first|all|run only.\n\n";

p_b += "### 16.2 Prepared + batch\n";
p_b += "- Unit tests that mock-d1 tracks prepare/bind usage (no raw string concat of params).\n";
p_b += "- batch() multi-statement: on failure of a statement, earlier statements in the same batch roll back\n";
p_b += "  (document and test against mock that implements D1 batch atomicity; if mock approximates, document fidelity).\n";
p_b += "- Prefer single-statement claims so batch is rarely needed for claims.\n\n";

p_b += "### 16.5 Sessions / replication\n";
p_b += "- withSession helper: createD1PaymentStores({ db, session: 'first-primary' }) or executor.withSession.\n";
p_b += "- Tests: when mock supports sessions, verify session-scoped reads after writes.\n";
p_b += "- Docs + tests document that without sessions under read replication, stale reads are possible.\n";
p_b += "- Claims remain writes (primary path).\n\n";

p_b += "### 16.6 Testing matrix\n";
p_b += "1) runIdempotencyStoreConformanceSuite with mock D1 + FakeClock\n";
p_b += "2) runWebhookInboxStoreConformanceSuite same\n";
p_b += "3) runReconciliationStoreConformanceSuite same\n";
p_b += "4) Concurrent/duplicate claim deliveries: two store instances same mock DB → exactly one winner\n";
p_b += "5) D1 batch rollback test\n";
p_b += "6) Session/primary-first smoke where testable\n";
p_b += "7) Migration tests: migrate then verifySchema; no auto-migrate on import\n";
p_b += "8) Worker restart simulation: store A claims; drop instance; store B with FakeClock reclaim or complete with lease\n";
p_b += "9) Stale lease complete/fail → StoreLeaseLostError\n";
p_b += "10) Optional live/local D1 (miniflare/wrangler) skip cleanly without env\n";
p_b += "11) No local sqlite driver imports in package source (grep)\n";
p_b += "Use unique table namespaces/prefixes per test run.\n";
p_b += "Env helpers document any CLOUDFLARE_* / D1 local flags used.\n\n";

p_b += "### After implementation\n";
p_b += "bun install; typecheck package; bun test packages/store-d1\n";
p_b += "Also run full monorepo safety including adapter-cloudflare-d1:\n";
p_b += "bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCS + WRANGLER EXAMPLES + MONOREPO WIRING for Phase 16 (Tasks 16.3 docs + 16.5/16.6 docs).\n";
p_c += "OWN: packages/store-d1/README.md, packages/store-d1/docs/**,\n";
p_c += "packages/store-d1/CHANGELOG.md Unreleased Phase 16,\n";
p_c += "packages/store-d1/examples/wrangler.toml (or docs/wrangler-example.md),\n";
p_c += "packages/store-d1/migrations/** D1-compatible SQL,\n";
p_c += "docs/monorepo.md (layout: packages/store-d1 present),\n";
p_c += "docs/workspace-boundaries.md (adapter-cloudflare-d1 rules, cloudflare-only, multi-host honesty),\n";
p_c += "docs/releases.md note if adapters publish separately,\n";
p_c += "root package.json scripts: include adapter-cloudflare-d1 in build/typecheck/test filters AFTER adapter-turso,\n";
p_c += "root package.json description lists adapter-cloudflare-d1,\n";
p_c += "packages/testkit/docs/store-contracts.md short pointer that Phase 16 D1 adapter exists,\n";
p_c += "root README if it lists packages.\n";
p_c += "Update scripts/check-workspace-boundaries.ts ONLY if needed for optional @cloudflare/workers-types\n";
p_c += "or cloudflare-only runtime handling — do not weaken portable package rules.\n";
p_c += "Do NOT write phase-16-gate-report.md (Gate owns it).\n\n";

p_c += "### Docs that MUST exist under packages/store-d1/docs/\n";
p_c += "1) overview.md — purpose, Workers/Pages D1 binding, NOT local SQLite, NOT Turso, NOT Durable Objects\n";
p_c += "2) crash-boundaries.md — crash before/after side effect; lease reclaim; Worker isolate restart\n";
p_c += "3) drivers.md or binding.md — D1 binding API (prepare/bind/run/batch/withSession); no REST required\n";
p_c += "4) claims.md — prefer single-statement UPSERT; multi-statement only via batch; no get-then-set\n";
p_c += "5) sessions-and-replication.md — 16.5 primary writes; sessions for RAW; stale replica risk without sessions\n";
p_c += "6) migrations.md — explicit migrate; never on import; D1-compatible SQL; no BEGIN/COMMIT wrappers; Wrangler\n";
p_c += "7) testing.md — mock D1, skip-without-env, FakeClock, namespaces, optional miniflare/wrangler\n";
p_c += "8) guarantees.md / manifest notes aligned with D1_STORAGE_ADAPTER_MANIFEST\n";
p_c += "9) numeric-portability.md or section — TEXT for IDs/tokens/hashes/money-like values\n";
p_c += "10) limits.md — D1 batch size limits, Workers CPU, multi-region caveats, comparison vs DO (Phase 17)\n\n";

p_c += "### Wrangler example (16.3)\n";
p_c += "examples/wrangler.toml or docs example:\n";
p_c += "```toml\n";
p_c += "name = \"payments-worker\"\n";
p_c += "main = \"src/index.ts\"\n";
p_c += "compatibility_date = \"2024-09-23\"\n";
p_c += "[[d1_databases]]\n";
p_c += "binding = \"PAYMENTS_DB\"\n";
p_c += "database_name = \"payments\"\n";
p_c += "database_id = \"<your-d1-id>\"\n";
p_c += "```\n";
p_c += "Document wrangler d1 migrations apply and that migration SQL omits BEGIN/COMMIT.\n\n";

p_c += "### monorepo wiring (required)\n";
p_c += "Root workspaces already packages/* so adapter-cloudflare-d1 is auto-discovered.\n";
p_c += "Update scripts:\n";
p_c += "  build: ... && bun run --filter @paykernel/store-d1 build\n";
p_c += "    (order: ... → adapter-turso → adapter-cloudflare-d1)\n";
p_c += "  typecheck: include adapter-cloudflare-d1 filter\n";
p_c += "  test: include packages/store-d1 path\n";
p_c += "  test:adapter-cloudflare-d1 script recommended\n";
p_c += "  lint already covers packages/*/src\n";
p_c += "Run bun install after package creation.\n";
p_c += "Run bun run check:boundaries — must pass.\n";
p_c += "Emphasize multi-host D1; not local single-host SQLite; not Turso; not Durable Objects.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:16-binding-tests", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:16-docs-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 16 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 17 Durable Objects adapter or reconciliation package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/store-d1 exists as @paykernel/store-d1 (publishable).\n";
p_int += "2) createD1PaymentStores({ db }) exists and is the primary ergonomic API (roadmap 16.1).\n";
p_int += "3) createD1IdempotencyStore / createD1WebhookInboxStore / createD1ReconciliationStore implement full Phase 9 contracts.\n";
p_int += "4) D1 binding path only for normal operation — no REST API required.\n";
p_int += "5) Prepared statements only; prefer single-statement UPSERT claims; multi-statement only via batch().\n";
p_int += "6) Sessions support for sequential consistency / primary-first when available.\n";
p_int += "7) Injectable clock for FakeClock conformance.\n";
p_int += "8) StorageAdapterManifest: multi-host, honest sessions/replication notes, durable.\n";
p_int += "9) migrateD1Adapter explicit; migration SQL without BEGIN/COMMIT wrappers; Wrangler example present.\n";
p_int += "10) Numeric portability: TEXT for IDs, tokens, hashes, money-like values.\n";
p_int += "11) Conformance suites pass on mock D1 (or local D1).\n";
p_int += "12) Tests: concurrent claims, batch rollback, sessions (where testable), migrations, restart/lease reclaim.\n";
p_int += "13) Docs: overview, crash-boundaries, binding, claims, sessions-and-replication, migrations, testing,\n";
p_int += "    guarantees, numeric-portability, limits, README, CHANGELOG, wrangler example.\n";
p_int += "14) monorepo.md + workspace-boundaries.md updated; root scripts include package.\n";
p_int += "15) Phase 0-15 safety: typecheck, tests core+testkit+webhooks+sql-store+adapter-postgres+redis+sqlite+turso+cloudflare-d1,\n";
p_int += "    build, boundaries, runtime portability green.\n";
p_int += "16) exactOptionalPropertyTypes clean.\n";
p_int += "17) public-api.test freezes exports; no local sqlite driver imports; no Phase 17 DO package.\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "19) If Stream A failed, implement the full adapter package yourself — Phase 16 cannot ship without it.\n";
p_int += "20) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap createD1PaymentStores).\n";
p_int += "21) Ensure package builds dist for root entry.\n";
p_int += "22) Never advertise local SQLite semantics or conflate with adapter-sqlite / adapter-turso / Durable Objects.\n";
p_int += "23) Auth/API tokens never appear in errors.\n";
p_int += "24) paymentsSdk.runtime cloudflare-only; portable false.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase16",
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
p_ver += "Verify Phase 16 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/store-d1/dist/index.js && test -f packages/core/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence package @paykernel/store-d1 exists with createD1PaymentStores\n";
p_ver += "12) Evidence three store factories + Phase 9 contracts\n";
p_ver += "13) Evidence D1 binding path (prepare/bind) and no REST required for createD1PaymentStores\n";
p_ver += "14) Evidence claim paths use single-statement UPSERT and/or batch — not get-then-set alone\n";
p_ver += "15) Evidence prepared statements (no string-interpolated user params)\n";
p_ver += "16) Evidence batch support + rollback test\n";
p_ver += "17) Evidence sessions/primary-first support and replication docs\n";
p_ver += "18) Evidence migrate explicit; migration SQL without BEGIN/COMMIT; Wrangler example\n";
p_ver += "19) Evidence numeric portability (TEXT IDs/tokens/hashes)\n";
p_ver += "20) Evidence StorageAdapterManifest multi-host + honest D1 notes\n";
p_ver += "21) Evidence conformance tests pass on mock D1\n";
p_ver += "22) Evidence concurrency, restart/lease, sessions tests present\n";
p_ver += "23) Evidence docs complete; no local sqlite driver imports in package\n";
p_ver += "24) Evidence no packages/store-durable-objects created\n";
p_ver += "25) Evidence core/webhooks/prior adapters have no adapter-cloudflare-d1 dep\n";
p_ver += "26) Evidence monorepo scripts include adapter-cloudflare-d1\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- package_ok: package exists with correct name and build\n";
p_ver += "- factories_ok: createD1PaymentStores + three store factories implement contracts\n";
p_ver += "- d1_binding_ok: Workers binding accepted via structural type\n";
p_ver += "- no_rest_required_ok: normal path needs only db binding\n";
p_ver += "- claim_atomic_ok: UPSERT/batch claims; not unprotected get-set\n";
p_ver += "- prepared_ok: prepare/bind path used\n";
p_ver += "- batch_ok: batch + rollback test\n";
p_ver += "- sessions_ok: session helpers + docs/tests\n";
p_ver += "- migrations_ok: explicit migrate; no BEGIN/COMMIT in D1 migration files; wrangler example\n";
p_ver += "- numeric_portability_ok: TEXT for IDs/tokens/hashes\n";
p_ver += "- replication_ok: primary claims + session RAW strategy documented\n";
p_ver += "- manifest_ok: multi-host honest notes\n";
p_ver += "- conformance_ok: suites pass on mock/local D1\n";
p_ver += "- testing_ok: 16.6 matrix covered\n";
p_ver += "- docs_ok: full docs set + monorepo links\n";
p_ver += "- no_local_sqlite_leak_ok: no bun:sqlite/better-sqlite3/node:sqlite in package prod source\n";
p_ver += "- no_do_package_ok: no adapter-cloudflare-do\n";
p_ver += "- compat_ok: Phase 0-15 green; boundaries; no illegal deps\n";
p_ver += "Set ok=true only if typecheck, tests (all packages listed), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase16",
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
    write_scratch_file("phase16-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 16 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 16 — each PASS or BLOCKING:\n";
p_gate += "A1) safe for distributed Worker deployments.\n";
p_gate += "    Evidence: multi-host manifest; createD1PaymentStores; atomic claims; concurrency tests;\n";
p_gate += "    crash-boundaries; Worker restart/lease reclaim; durable notes.\n";
p_gate += "A2) no local SQLite driver assumptions leak into the D1 implementation.\n";
p_gate += "    Evidence: no bun:sqlite/better-sqlite3/node:sqlite/sync BEGIN IMMEDIATE callbacks;\n";
p_gate += "    async prepare/bind/batch API; docs contrast with adapter-sqlite.\n";
p_gate += "A3) D1-specific guarantees and limits are documented.\n";
p_gate += "    Evidence: guarantees/limits/sessions-and-replication docs; honest manifest notes;\n";
p_gate += "    batch limits; read replication caveats; Wrangler binding docs.\n\n";
p_gate += "Also require Phase 16 sections 16.1-16.6 deliverables:\n";
p_gate += "- 16.1 D1 binding createD1PaymentStores({ db }) — no REST required\n";
p_gate += "- 16.2 prepared statements; single-statement claims preferred; batch for multi-statement; sessions\n";
p_gate += "- 16.3 D1-compatible migrations without unsupported txn wrappers; Wrangler examples\n";
p_gate += "- 16.4 numeric portability (TEXT IDs/tokens/hashes/money-like)\n";
p_gate += "- 16.5 claims are primary writes; post-write reads use session strategy when replication enabled\n";
p_gate += "- 16.6 tests: concurrent deliveries, atomic claims, batch rollback, sessions, migrations, restarts\n";
p_gate += "- Injectable clock for conformance\n";
p_gate += "- Explicit migrate only; never on import\n";
p_gate += "- Phase 0-15 safety net still green; boundaries; no illegal deps\n";
p_gate += "- No Phase 17 adapter-cloudflare-do package\n";
p_gate += "- No logical bugs: get/set claim race; local sqlite APIs leaked; secrets in errors;\n";
p_gate += "  FakeClock ignored; auto-migrate; BEGIN/COMMIT in D1 migrations; REST required for Workers path;\n";
p_gate += "  conflating D1 with turso/sqlite/DO; JS number precision for IDs.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1\n";
p_gate += "  bun run typecheck; check:boundaries; focused adapter-cloudflare-d1 tests.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/store-d1/docs/phase-16-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-16-gate-report.md (full or pointer + verdict summary).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase16-adversarial",
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
    write_scratch_file("phase16-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 16 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 16 only — no Phase 17 DO adapter, no reconciliation package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete packages/store-d1: createD1PaymentStores, factories, prepared claims,\n";
    p_fix += "batch, sessions, migrate without BEGIN/COMMIT, numeric portability, concurrency, conformance,\n";
    p_fix += "docs, wrangler example, monorepo wiring as needed.\n";
    p_fix += "Preserve Phase 0-15 and all prior adapters.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase16-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 16 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm all 16.1-16.6 deliverables and acceptance criteria A1-A3 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase16-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase16-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 16 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/store-d1/docs/phase-16-gate-report.md and packages/core/docs/baseline/phase-16-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 16.1-16.6 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase16-final",
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
        write_scratch_file("phase16-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 16 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 16,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
