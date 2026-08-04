let meta = #{
    name: "phase-14-sqlite-adapter",
    description: "Phase 14 Local SQLite Adapter Family: critic, implement @paykernel/store-sqlite (bun:sqlite, node:sqlite, better-sqlite3, claims, WAL/busy_timeout, conformance), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 14 roadmap 14.1-14.6 and acceptance criteria" },
        #{ title: "Implement", detail: "adapter-sqlite package: stores, subpaths, migrate, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-13 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 14 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 14" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 14 (Local SQLite Adapter Family) for PayKernel monorepo",
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
        "package_ok", "factories_ok", "driver_subpaths_ok", "root_no_drivers_ok",
        "claim_atomic_ok", "manifest_ok", "conformance_ok", "deployment_docs_ok",
        "bun_binding_ok", "node_binding_ok", "better_sqlite3_ok", "docs_ok",
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
        "driver_subpaths_ok": #{ "type": "boolean" },
        "root_no_drivers_ok": #{ "type": "boolean" },
        "claim_atomic_ok": #{ "type": "boolean" },
        "manifest_ok": #{ "type": "boolean" },
        "conformance_ok": #{ "type": "boolean" },
        "deployment_docs_ok": #{ "type": "boolean" },
        "bun_binding_ok": #{ "type": "boolean" },
        "node_binding_ok": #{ "type": "boolean" },
        "better_sqlite3_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 14 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 14 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 14 — Local SQLite Adapter Family\" completely\n";
p_critic += "(Package, Objective, Subpath Exports, Tasks 14.1-14.6, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  11 atomicity by storage engine not get/set; 13 prepared / bound / scripted only;\n";
p_critic += "  14 no raw payloads by default; 15 portable timestamps/IDs;\n";
p_critic += "  16 every adapter same conformance suite; 17 document crash boundaries;\n";
p_critic += "  19 never auto-migrate on import/prod construction.\n";
p_critic += "Also section 3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings,\n";
p_critic += "3.5 Each Adapter Must Declare Its Guarantees, 3.7 Local SQLite Is a Single-Host Default,\n";
p_critic += "3.8 Redis Is Optional, 5 Proposed Repository Structure (adapter-sqlite),\n";
p_critic += "5.1 Package Boundary Rules (adapter root must not import optional drivers).\n";
p_critic += "Phases 0-13 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, store contracts, webhook inbox engine,\n";
p_critic += "private internal/sql-store relational foundation, packages/store-postgres, packages/store-redis.\n";
p_critic += "Do NOT start Phase 15+ (adapter-turso, adapter-cloudflare-d1/do),\n";
p_critic += "new reconciliation domain package, new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-13 domain/foundation packages unless required for monorepo wiring/docs.\n\n";

p_critic += "CONTEXT already present from Phase 9-13:\n";
p_critic += "- packages/testkit — LeaseAware IdempotencyStore / WebhookInboxStore / ReconciliationStore contracts\n";
p_critic += "- packages/testkit — runIdempotencyStoreConformanceSuite / runWebhookInboxStoreConformanceSuite / runReconciliationStoreConformanceSuite\n";
p_critic += "- packages/testkit — StorageAdapterManifest + assertStorageAdapterManifest + FakeClock\n";
p_critic += "- packages/webhooks — inbox engine; dual-owned WebhookInboxStore\n";
p_critic += "- internal/sql-store — schemas, codecs, migrations (FOUNDATION_SQL_SQLITE), claim templates with sqlite dialect\n";
p_critic += "  (idempotencyReserveTemplates().sqlite, webhookClaimTemplates().sqlite, etc.)\n";
p_critic += "  decideIdempotencyReserve / decideWebhookClaim algorithms; bun:sqlite NON-PRODUCTION reference store\n";
p_critic += "- packages/store-postgres — Phase 12 production SQL adapter pattern (subpaths, errors, manifest, migrate, skip-without-env tests)\n";
p_critic += "- packages/store-redis — Phase 13 COMPLETE optional Redis adapter — preserve; do not break\n";
p_critic += "- scripts/check-workspace-boundaries.ts already lists better-sqlite3, bun:sqlite, node:sqlite in ADAPTER_OPTIONAL_DRIVERS\n";
p_critic += "- NO packages/store-sqlite yet; monorepo docs say further adapters (sqlite/turso/…) land later.\n\n";

p_critic += "Audit against EVERY Phase 14 requirement with evidence (grep/read):\n\n";

p_critic += "Package: @paykernel/store-sqlite under packages/store-sqlite\n\n";

p_critic += "Subpath exports (root must contain only shared types and must NOT import a driver):\n";
p_critic += "  @paykernel/store-sqlite/bun\n";
p_critic += "  @paykernel/store-sqlite/node\n";
p_critic += "  @paykernel/store-sqlite/better-sqlite3\n\n";

p_critic += "Objective: high-quality local/embedded implementation for Bun, Node, tests, desktop apps, single-host deployments.\n";
p_critic += "MUST NOT be advertised as distributed multi-host coordination.\n\n";

p_critic += "14.1 Bun SQLite Binding:\n";
p_critic += "- support bun:sqlite as first-class Bun implementation\n";
p_critic += "- use prepared statements\n";
p_critic += "- use synchronous transaction callbacks (no await inside transaction)\n";
p_critic += "- prefer BEGIN IMMEDIATE semantics for contested write claims where appropriate\n";
p_critic += "- configure or document busy_timeout\n";
p_critic += "- recommend WAL mode for persistent single-host applications\n";
p_critic += "- expose an in-memory test helper\n";
p_critic += "Target API:\n";
p_critic += "  import { Database } from \"bun:sqlite\";\n";
p_critic += "  import { createBunSqliteStores } from \"@paykernel/store-sqlite/bun\";\n";
p_critic += "  const db = new Database(\"payments.db\");\n";
p_critic += "  const stores = createBunSqliteStores({ db });\n\n";

p_critic += "14.2 Node Built-in SQLite Binding:\n";
p_critic += "- isolate ALL node:sqlite imports behind /node subpath only\n";
p_critic += "- document minimum Node version and module stability status\n";
p_critic += "- use DatabaseSync prepared statements\n";
p_critic += "- support BigInt reads where needed\n";
p_critic += "- publish exact supported Node-version matrix and module stability level per supported line\n";
p_critic += "- keep this optional subpath isolated from the core runtime baseline\n\n";

p_critic += "14.3 better-sqlite3 Binding:\n";
p_critic += "- stable Node binding for mature synchronous driver\n";
p_critic += "- use .transaction() or explicit immediate transactions safely\n";
p_critic += "- do NOT use async transaction callbacks\n";
p_critic += "- support WAL and busy-timeout recommendations\n";
p_critic += "- use safe integer mode or strings where 64-bit precision matters\n\n";

p_critic += "14.4 SQLite Claim Semantics:\n";
p_critic += "Use ONLY after conformance verification one of:\n";
p_critic += "  - INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING (if SQLite version supports)\n";
p_critic += "  - BEGIN IMMEDIATE plus conditional statements in ONE synchronous transaction\n";
p_critic += "Do NOT rely on unprotected read followed by write.\n";
p_critic += "Prefer sql-store sqlite templates + algorithm decisions inside one sync transaction.\n\n";

p_critic += "14.5 Deployment Limits (MUST document clearly):\n";
p_critic += "- one database file must have one durable filesystem authority\n";
p_critic += "- do not share the file over unsupported network filesystems\n";
p_critic += "- ephemeral serverless filesystems lose state\n";
p_critic += "- horizontal scaling across hosts requires D1, Turso, PostgreSQL, Redis, or another shared service\n\n";

p_critic += "14.6 Tests:\n";
p_critic += "Run same logical suite against:\n";
p_critic += "- Bun SQLite in-memory and file-backed modes\n";
p_critic += "- Node SQLite where supported (skip cleanly if unavailable)\n";
p_critic += "- better-sqlite3 (skip cleanly if not installed / env not set for native)\n";
p_critic += "Add lock contention, busy timeout, WAL, restart, and migration tests.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) Bun SQLite is a production-capable single-host adapter\n";
p_critic += "A2) each subpath imports only its driver\n";
p_critic += "A3) no local SQLite adapter is misrepresented as distributed coordination\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/store-sqlite depends on testkit + internal/sql-store (workspace:*)\n";
p_critic += "- MAY depend on core only if needed — prefer testkit contracts + sql-store foundation\n";
p_critic += "- core must NOT depend on adapter-sqlite\n";
p_critic += "- webhooks must NOT depend on adapter-sqlite\n";
p_critic += "- adapter-postgres / adapter-redis must NOT depend on adapter-sqlite\n";
p_critic += "- drivers as optional peerDependencies; isolated subpaths only\n";
p_critic += "- better-sqlite3 as optional peer for /better-sqlite3\n";
p_critic += "- bun:sqlite and node:sqlite are runtime builtins — isolate on subpaths\n";
p_critic += "- do NOT create adapter-turso / adapter-cloudflare-* (Phase 15+)\n";
p_critic += "- do NOT create packages/reconciliation domain package\n";
p_critic += "- do NOT advertise multi-host / multi-region safety for local SQLite\n\n";

p_critic += "Critical design constraints to flag as risks if missing plan:\n";
p_critic += "- Injectable clock for conformance (FakeClock.advance must control lease expiry)\n";
p_critic += "- Claims in one synchronous transaction or single-statement atomic UPSERT — never get-then-set\n";
p_critic += "- generation monotonic on reserve/claim/renew; unguessable leaseToken\n";
p_critic += "- stale lease complete/fail → StoreLeaseLostError\n";
p_critic += "- indeterminate rows block reserve (A4 from Phase 9)\n";
p_critic += "- StorageAdapterManifest honesty: coordinationScope single-host (or process-local),\n";
p_critic += "  durability durable for file-backed (with notes), NOT multi-host\n";
p_critic += "- Map StoreErrorCode taxonomy; sanitized error fields max size; no secrets\n";
p_critic += "- exactOptionalPropertyTypes ON\n";
p_critic += "- Never auto-migrate on import or default create*Stores construction\n";
p_critic += "- Explicit migrateSqliteAdapter using sql-store migrate dialect sqlite\n";
p_critic += "- WAL + busy_timeout documented and helpers provided\n";
p_critic += "- Production stores must NOT re-export NON_PRODUCTION bun-sqlite reference from sql-store as the product\n";
p_critic += "- Tests skip cleanly for node:sqlite / better-sqlite3 when unavailable\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: root importing drivers; get-then-set claims; async txn callbacks; dishonest multi-host manifest;\n";
p_critic += "secrets in errors; core→adapter dep; auto-migrate; missing deployment limits docs;\n";
p_critic += "Phase 15+ packages; FakeClock ignored; network FS advertised as OK; serverless ephemeral advertised durable.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase14-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase14-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 14 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 14\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 14 SQLite Adapter in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Webhooks = packages/webhooks = @paykernel/webhooks (0.1.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — Phase 9 contracts + conformance + FakeClock.\n";
common += "Sql-store = internal/sql-store = @paykernel/internal-sql-store (private Phase 11) — USE for schema/migrations/claim templates.\n";
common += "Postgres adapter = packages/store-postgres (Phase 12 COMPLETE) — preserve; do not break; MIRROR its patterns.\n";
common += "Redis adapter = packages/store-redis (Phase 13 COMPLETE) — preserve; do not break.\n";
common += "PHASE 14 ONLY: create packages/store-sqlite = @paykernel/store-sqlite.\n";
common += "Do NOT create packages/store-turso / adapter-cloudflare-d1 / adapter-cloudflare-do.\n";
common += "Do NOT create packages/reconciliation (later). Do NOT add new PSPs or extract gateways.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside adapter-sqlite; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-13 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + claim atomicity + conformance + binding tests).\n";
common += "2) Atomic claims = engine-level single-statement OR one sync BEGIN IMMEDIATE transaction;\n";
common += "   NEVER unprotected get-then-set as claim strategy.\n";
common += "3) Never convert uncertain outcomes into failure (respect indeterminate contracts).\n";
common += "4) No secret leakage in error fields (sanitized, max size).\n";
common += "5) No framework coupling in portable root; drivers only on subpaths.\n";
common += "6) Root entry must NOT import bun:sqlite, node:sqlite, or better-sqlite3.\n";
common += "7) Keep 0.x compat: core/webhooks/testkit/sql-store/adapter-postgres/adapter-redis public APIs stable; additive only.\n";
common += "8) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "9) exactOptionalPropertyTypes is ON — no undefined assignment to optional props without care.\n";
common += "10) Core/webhooks/adapter-postgres/adapter-redis must NOT depend on adapter-sqlite.\n";
common += "11) Portable ISO-8601 timestamps and opaque string lease tokens; no JS number for 64-bit IDs.\n";
common += "12) Do not store raw provider payloads/signatures by default.\n";
common += "13) Injectable clock: stores MUST accept clock/now so FakeClock works in conformance.\n";
common += "14) Publish honest StorageAdapterManifest: single-host coordination; durable for file-backed with limits notes;\n";
common += "    NEVER multi-host for local SQLite file.\n";
common += "15) Map driver errors into StoreErrorCode taxonomy (StoreLeaseLostError, StoreUnavailableError, etc.).\n";
common += "16) Never auto-migrate on import or default create*Stores — explicit migrateSqliteAdapter only.\n";
common += "17) Prefer sql-store sqlite claim templates + algorithm inside one sync transaction.\n";
common += "18) Synchronous transaction callbacks only — no async/await inside txn.\n";
common += "19) Document busy_timeout, WAL recommendation, deployment limits (14.5).\n";
common += "20) Mirror Phase 9 contract semantics from packages/testkit/src/storage/contracts.ts.\n";
common += "21) Mirror packages/store-postgres structure (executor/stores/migrate/manifest/errors/clock/drivers) adapted for sync SQLite.\n";
common += "22) Production package is NOT the sql-store NON_PRODUCTION bun reference — implement real production stores.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: package scaffold + executor + stores + claims + migrate + manifest
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE SCAFFOLD + SQLITE EXECUTOR PORT + STORE FACTORIES + CLAIMS + MIGRATE + MANIFEST (Tasks 14.4, partial 14.1, 14.5).\n";
p_a += "OWN primarily: packages/store-sqlite/** (NEW package).\n";
p_a += "May touch root package.json scripts ONLY if needed — prefer leave monorepo polish to Integrate/Stream C.\n";
p_a += "Do NOT write phase-14-gate-report.md (Gate owns it).\n";
p_a += "Do NOT implement Turso/D1/DO adapters.\n";
p_a += "Do NOT break packages/store-postgres or packages/store-redis.\n\n";

p_a += "### Create package packages/store-sqlite\n";
p_a += "Name: @paykernel/store-sqlite\n";
p_a += "version 0.1.0; type module; publishable (NOT private).\n";
p_a += "description: Local/embedded SQLite stores for PayKernel lease-aware idempotency, webhook inbox, and reconciliation (single-host).\n";
p_a += "dependencies:\n";
p_a += "  @paykernel/testkit: workspace:*\n";
p_a += "  @paykernel/internal-sql-store: workspace:*\n";
p_a += "optional peerDependencies:\n";
p_a += "  better-sqlite3 — for /better-sqlite3 subpath\n";
p_a += "  (bun:sqlite and node:sqlite are runtime-provided — no npm peer required)\n";
p_a += "peerDependenciesMeta: better-sqlite3 optional true\n";
p_a += "devDependencies: @types/bun, typescript, better-sqlite3, @types/better-sqlite3 for tests as needed\n";
p_a += "scripts: build multi-entry (root + bun + node + better-sqlite3) + build:types, typecheck, test\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist\n";
p_a += "LICENSE MIT (copy from sibling). README + CHANGELOG.\n";
p_a += "publishConfig access public + provenance true (match adapter-postgres).\n";
p_a += "paymentsSdk: { portable: false, runtime: \"node-or-bun\" }\n";
p_a += "After package.json exists: bun install from monorepo root.\n\n";

p_a += "### Exports map (CRITICAL — root must not pull drivers)\n";
p_a += "```json\n";
p_a += "{\n";
p_a += "  \".\": { \"types\": \"./dist/index.d.ts\", \"import\": \"./dist/index.js\" },\n";
p_a += "  \"./bun\": { \"types\": \"./dist/bun.d.ts\", \"import\": \"./dist/bun.js\" },\n";
p_a += "  \"./node\": { \"types\": \"./dist/node.d.ts\", \"import\": \"./dist/node.js\" },\n";
p_a += "  \"./better-sqlite3\": { \"types\": \"./dist/better-sqlite3.d.ts\", \"import\": \"./dist/better-sqlite3.js\" }\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Root exports: store factories accepting a narrow SqliteExecutor / sync port, migrate helpers, manifest, types,\n";
p_a += "clock — ZERO static imports of bun:sqlite / node:sqlite / better-sqlite3.\n";
p_a += "Subpaths: thin bindings that adapt driver Database types to the executor port and re-export factories.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/store-sqlite/src/\n";
p_a += "  index.ts                 # curated public root exports\n";
p_a += "  manifest.ts              # SQLITE_STORAGE_ADAPTER_MANIFEST + getter\n";
p_a += "  types.ts                 # SqliteStoreOptions, clock, namespace, SqliteExecutor\n";
p_a += "  executor.ts              # narrow sync executor: prepare/query/run + transaction(immediate)\n";
p_a += "  errors.ts                # map driver errors → StoreErrorCode / StoreLeaseLostError / etc.\n";
p_a += "  clock.ts                 # Clock interface compatible with testkit FakeClock (nowMs / nowIso)\n";
p_a += "  migrate.ts               # migrateSqliteAdapter / verifySqliteAdapterSchema (dialect: sqlite)\n";
p_a += "  pragmas.ts               # applyRecommendedPragmas: busy_timeout, WAL, foreign_keys helpers\n";
p_a += "  stores/\n";
p_a += "    idempotency-store.ts\n";
p_a += "    webhook-inbox-store.ts\n";
p_a += "    reconciliation-store.ts\n";
p_a += "    shared.ts\n";
p_a += "  index-stores.ts          # createSqlite* factories + createSqliteStores bundle\n";
p_a += "  drivers/\n";
p_a += "    bun.ts\n";
p_a += "    node.ts\n";
p_a += "    better-sqlite3.ts\n";
p_a += "  bun.ts / node.ts / better-sqlite3.ts  # subpath re-exports\n";
p_a += "  public-api.test.ts\n";
p_a += "  import-no-migrate.test.ts\n";
p_a += "  errors.test.ts\n";
p_a += "  stores/*.test.ts\n";
p_a += "  conformance.sqlite.test.ts\n";
p_a += "  contention.sqlite.test.ts\n";
p_a += "  wal-busy.sqlite.test.ts\n";
p_a += "  migrate.sqlite.test.ts\n";
p_a += "  restart.sqlite.test.ts\n";
p_a += "  drivers/*.test.ts\n\n";

p_a += "### Narrow SqliteExecutor (sync-friendly)\n";
p_a += "SQLite bindings are primarily SYNCHRONOUS. Design the port so stores can run claim paths without async races.\n";
p_a += "Recommended shape (adapt as needed but keep narrow):\n";
p_a += "```ts\n";
p_a += "export interface SqliteExecutor {\n";
p_a += "  /** Run SQL with bound params; return rows as plain objects. */\n";
p_a += "  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T[];\n";
p_a += "  /** Execute write; return changes/lastInsertRowid if useful. */\n";
p_a += "  run(sql: string, params?: readonly unknown[]): { changes: number };\n";
p_a += "  /**\n";
p_a += "   * Run fn inside a transaction. Prefer BEGIN IMMEDIATE for write claims.\n";
p_a += "   * fn MUST be synchronous (no Promise). Drivers must not accept async callbacks.\n";
p_a += "   */\n";
p_a += "  transaction<T>(fn: () => T, options?: { mode?: \"deferred\" | \"immediate\" | \"exclusive\" }): T;\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Also provide toSqlStoreExecutor adapter for sql-store migrate() which may use async SqlExecutor —\n";
p_a += "wrap sync methods in Promise.resolve if sql-store migrate expects async.\n";
p_a += "Stores MUST depend only on SqliteExecutor (+ clock + namespace options), never on a specific driver type.\n\n";

p_a += "### 14.4 Claim implementation (CRITICAL)\n";
p_a += "Implement full Phase 9 contracts for:\n";
p_a += "  createSqliteIdempotencyStore\n";
p_a += "  createSqliteWebhookInboxStore\n";
p_a += "  createSqliteReconciliationStore\n";
p_a += "  createSqliteStores (bundle)\n\n";
p_a += "Claim strategy (choose and verify with conformance):\n";
p_a += "PREFERRED for SQLite: inside ONE executor.transaction(() => {...}, { mode: \"immediate\" }):\n";
p_a += "  1) SELECT existing row FOR decision (or use INSERT OR IGNORE + conditional UPDATE from sql-store templates)\n";
p_a += "  2) Apply decideIdempotencyReserve / decideWebhookClaim / decideReconciliationClaim from sql-store algorithm\n";
p_a += "  3) Write with prepared bound statements\n";
p_a += "  Because the entire decision+write is one IMMEDIATE transaction, this is NOT unprotected get-then-set\n";
p_a += "  across connections — SQLite serializes writers.\n";
p_a += "ALTERNATIVE: single-statement INSERT ON CONFLICT DO UPDATE WHERE RETURNING if the SQLite version\n";
p_a += "  and template support it reliably (RETURNING supported on modern SQLite).\n";
p_a += "Use sql-store templates: idempotencyReserveTemplates(ns).sqlite, webhookClaimTemplates(ns).sqlite, etc.\n";
p_a += "Parse multi-step template comments carefully or implement equivalent logic using algorithm helpers.\n";
p_a += "Rules:\n";
p_a += "- generation increments on successful reserve/claim/renew that issues new lease\n";
p_a += "- leaseToken: unguessable from crypto.randomUUID or randomBytes\n";
p_a += "- complete/fail/renew require matching leaseToken; mismatch → StoreLeaseLostError\n";
p_a += "- fingerprint/payloadHash conflicts return explicit conflict kinds\n";
p_a += "- indeterminate: reserve returns kind indeterminate; cleanup does NOT remove by default\n";
p_a += "- prepared statements only — NEVER string-interpolate user values\n";
p_a += "- injectable clock: lease predicates use clock.now() / nowIso, not Date.now alone in store paths\n";
p_a += "Read packages/store-postgres/src/stores/* as structural reference (async PG vs sync SQLite).\n";
p_a += "Read packages/testkit/src/memory/memory-stores.ts as behavioral oracle.\n";
p_a += "Read internal/sql-store/src/reference/bun-sqlite-store.ts for sync-transaction claim pattern (but implement production API).\n\n";

p_a += "### Migrate (explicit only)\n";
p_a += "migrateSqliteAdapter(executor, options?) → sql-store migrate with dialect: \"sqlite\"\n";
p_a += "verifySqliteAdapterSchema(executor, options?)\n";
p_a += "NEVER call migrate from package import or from createSqliteStores by default.\n";
p_a += "import-no-migrate.test.ts must prove this.\n\n";

p_a += "### Pragmas helpers (14.1/14.3)\n";
p_a += "applyRecommendedPragmas(executor, { busyTimeoutMs?: number, wal?: boolean }):\n";
p_a += "  PRAGMA busy_timeout = N;\n";
p_a += "  PRAGMA journal_mode = WAL; (file-backed only; document :memory: is not WAL)\n";
p_a += "  PRAGMA foreign_keys = ON;\n";
p_a += "Document recommendations; call from subpath helpers optionally (not auto on every store create).\n\n";

p_a += "### Manifest (honesty — single-host)\n";
p_a += "```ts\n";
p_a += "{\n";
p_a += "  name: \"sqlite\",\n";
p_a += "  contracts: { idempotency: true, webhookInbox: true, reconciliation: true },\n";
p_a += "  consistency: { claims: \"strong\", readAfterWrite: \"strong\", staleReadsPossible: false },\n";
p_a += "  coordinationScope: \"single-host\",  // NOT multi-host — one durable filesystem authority\n";
p_a += "  durability: \"durable\",  // file-backed; note :memory: is process-local only\n";
p_a += "  supportsTransactions: true,\n";
p_a += "  supportsLeases: true,\n";
p_a += "  supportsRetentionCleanup: true,\n";
p_a += "  notes: [\n";
p_a += "    \"Single-host only: one database file must have one durable filesystem authority.\",\n";
p_a += "    \"Do not share the SQLite file over unsupported network filesystems.\",\n";
p_a += "    \"Ephemeral serverless filesystems lose state — not suitable for durable inbox/idempotency there.\",\n";
p_a += "    \"Horizontal scaling across hosts requires D1, Turso, PostgreSQL, Redis, or another shared service.\",\n";
p_a += "    \"Claims use BEGIN IMMEDIATE (or equivalent) + conditional writes / ON CONFLICT in one sync transaction.\",\n";
p_a += "    \"Never unprotected get-then-set across connections for claim correctness.\",\n";
p_a += "    \"Recommend WAL mode and busy_timeout for persistent single-host applications.\",\n";
p_a += "    \"Migrations are explicit (migrateSqliteAdapter) — never on package import or default factory construction.\",\n";
p_a += "    \"Injectable clock: lease reclaim predicates use injected now; FakeClock works in conformance tests.\",\n";
p_a += "    \"Timestamps stored as TEXT ISO-8601; generation as INTEGER; lease tokens as TEXT.\",\n";
p_a += "    \"Root entry does not import bun:sqlite / node:sqlite / better-sqlite3; use isolated subpath bindings.\",\n";
p_a += "  ]\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Validate with assertStorageAdapterManifest.\n\n";

p_a += "### Public exports (root) — freeze in public-api.test.ts\n";
p_a += "createSqliteIdempotencyStore, createSqliteWebhookInboxStore, createSqliteReconciliationStore,\n";
p_a += "createSqliteStores (bundle),\n";
p_a += "migrateSqliteAdapter, verifySqliteAdapterSchema,\n";
p_a += "SQLITE_STORAGE_ADAPTER_MANIFEST / getSqliteStorageAdapterManifest,\n";
p_a += "applyRecommendedPragmas (if root-safe without drivers),\n";
p_a += "SqliteExecutor type, mapDriverError / StoreError re-exports as needed,\n";
p_a += "clock helpers.\n";
p_a += "Assert root source graph has no import of 'bun:sqlite' | 'node:sqlite' | 'better-sqlite3'.\n\n";

p_a += "### Stream A tests (run under Bun; use bun:sqlite via subpath or test helper)\n";
p_a += "- public-api freeze + root no drivers\n";
p_a += "- import-no-migrate\n";
p_a += "- store unit tests with in-memory Bun SQLite\n";
p_a += "- error mapping unit tests\n";
p_a += "- manifest assert + coordinationScope single-host\n";
p_a += "- migrate unit/integration on memory + file\n";
p_a += "Run package typecheck/tests after wiring.\n";

let a_result = agent(p_a, #{
    label: "impl:14-stores-claims",
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

// Parallel: B drivers+conformance, C docs+monorepo
log("Implementing Phase 14 drivers/tests and docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — DRIVER BINDINGS + CONFORMANCE + CONTENTION + WAL/BUSY + RESTART TESTS (Tasks 14.1, 14.2, 14.3, 14.6).\n";
p_b += "OWN: packages/store-sqlite/src/drivers/**, subpath entries, integration/conformance/contention tests.\n";
p_b += "May extend Stream A store/claim files if missing transitions or bugs.\n";
p_b += "Do NOT write gate report. Do NOT create Phase 15+ adapters. Do NOT break adapter-postgres/redis.\n\n";

p_b += "### 14.1 Bun binding (/bun)\n";
p_b += "```ts\n";
p_b += "import { Database } from \"bun:sqlite\";\n";
p_b += "import { createBunSqliteStores } from \"@paykernel/store-sqlite/bun\";\n";
p_b += "const db = new Database(\"payments.db\");\n";
p_b += "const stores = createBunSqliteStores({ db });\n";
p_b += "```\n";
p_b += "Implement:\n";
p_b += "- createBunSqliteExecutor(db: Database): SqliteExecutor\n";
p_b += "- createBunSqliteStores({ db, clock?, namespace?, ... })\n";
p_b += "- createBunSqliteIdempotencyStore / WebhookInbox / Reconciliation as needed\n";
p_b += "- createInMemoryBunSqliteStores() or createBunSqliteStoresInMemory() test helper\n";
p_b += "- use prepared statements (db.prepare)\n";
p_b += "- use db.transaction() with IMMEDIATE mode for claim paths (or executor.transaction mode immediate)\n";
p_b += "- optional apply pragmas helper for busy_timeout + WAL on file DBs\n";
p_b += "Isolate ALL bun:sqlite imports in drivers/bun.ts and bun.ts entry only.\n\n";

p_b += "### 14.2 Node built-in SQLite (/node)\n";
p_b += "Isolate ALL node:sqlite imports.\n";
p_b += "- Use DatabaseSync (sync API) prepared statements\n";
p_b += "- createNodeSqliteExecutor / createNodeSqliteStores({ db })\n";
p_b += "- Support BigInt reads where needed (safe conversion to number or string for generation etc.)\n";
p_b += "- Document minimum Node version (e.g. Node 22.5+ experimental / Node 24+ stability — RESEARCH CURRENT STATUS)\n";
p_b += "  and module stability level in docs/drivers.md and package README\n";
p_b += "- Publish supported Node-version matrix in docs\n";
p_b += "- Tests: if node:sqlite unavailable in runtime, SKIP cleanly (do not fail CI under Bun-only)\n";
p_b += "  Provide unit tests that mock DatabaseSync surface if live node:sqlite cannot run under Bun\n\n";

p_b += "### 14.3 better-sqlite3 (/better-sqlite3)\n";
p_b += "- createBetterSqlite3Executor(db) / createBetterSqlite3Stores({ db })\n";
p_b += "- use .transaction() or BEGIN IMMEDIATE; never async transaction callbacks\n";
p_b += "- safeIntegers option or store 64-bit as TEXT where precision matters\n";
p_b += "- WAL + busy_timeout helpers documented\n";
p_b += "- optional peerDependency better-sqlite3\n";
p_b += "- Tests skip cleanly if better-sqlite3 cannot load native module\n\n";

p_b += "### 14.6 Tests (same logical suite)\n";
p_b += "1) runIdempotencyStoreConformanceSuite with Bun SQLite + FakeClock (memory)\n";
p_b += "2) runWebhookInboxStoreConformanceSuite same\n";
p_b += "3) runReconciliationStoreConformanceSuite same\n";
p_b += "4) File-backed Bun SQLite conformance or smoke (temp file)\n";
p_b += "5) Concurrent / lock contention: multi-connection same file → exactly one claim acquired\n";
p_b += "   (use two Database handles on same file path + IMMEDIATE + busy_timeout)\n";
p_b += "6) busy_timeout behavior test (documented + basic evidence)\n";
p_b += "7) WAL mode smoke: journal_mode=WAL on file DB\n";
p_b += "8) Restart test: write to file, close, reopen, read records still present\n";
p_b += "9) Migration tests: migrate then verifySchema; no auto-migrate on import\n";
p_b += "10) Stale lease complete/fail → StoreLeaseLostError\n";
p_b += "11) Node binding tests (skip if unavailable)\n";
p_b += "12) better-sqlite3 tests (skip if unavailable)\n";
p_b += "13) Driver unit tests for executor mapping without claiming multi-host\n";
p_b += "Use unique temp dirs/prefixes per test run.\n";
p_b += "Primary live binding under bun test: Bun SQLite.\n\n";

p_b += "### After implementation\n";
p_b += "bun install; typecheck package; bun test packages/store-sqlite\n";
p_b += "Also run full monorepo safety including adapter-sqlite:\n";
p_b += "bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCS + MONOREPO WIRING for Phase 14.\n";
p_c += "OWN: packages/store-sqlite/README.md, packages/store-sqlite/docs/**,\n";
p_c += "packages/store-sqlite/CHANGELOG.md Unreleased Phase 14,\n";
p_c += "docs/monorepo.md (layout: packages/store-sqlite present),\n";
p_c += "docs/workspace-boundaries.md (adapter-sqlite rules, root no drivers, single-host honesty),\n";
p_c += "docs/releases.md note if adapters publish separately,\n";
p_c += "root package.json scripts: include adapter-sqlite in build/typecheck/test filters AFTER adapter-redis,\n";
p_c += "root package.json description lists adapter-sqlite,\n";
p_c += "packages/testkit/docs/store-contracts.md short pointer that Phase 14 sqlite adapter exists,\n";
p_c += "root README if it lists packages.\n";
p_c += "Do NOT write phase-14-gate-report.md (Gate owns it).\n\n";

p_c += "### Docs that MUST exist under packages/store-sqlite/docs/\n";
p_c += "1) overview.md — purpose, single-host local/embedded, subpaths, NOT distributed\n";
p_c += "2) crash-boundaries.md — crash before/after side effect; lease reclaim; process restart vs file durability\n";
p_c += "3) drivers.md — /bun /node /better-sqlite3; prepared statements; IMMEDIATE; busy_timeout; WAL;\n";
p_c += "   Node version matrix + stability for node:sqlite; root has no drivers\n";
p_c += "4) claims.md — claim strategy (BEGIN IMMEDIATE sync txn or ON CONFLICT); no get-then-set\n";
p_c += "5) deployment-limits.md — 14.5 four limits clearly\n";
p_c += "6) migrations.md — explicit migrate; never on import; sql-store foundation dialect sqlite\n";
p_c += "7) testing.md — in-memory helper, file tests, skips for node/better-sqlite3, concurrency\n";
p_c += "8) guarantees.md / manifest notes aligned with SQLITE_STORAGE_ADAPTER_MANIFEST\n\n";

p_c += "### monorepo wiring (required)\n";
p_c += "Root workspaces already packages/* so adapter-sqlite is auto-discovered.\n";
p_c += "Update scripts:\n";
p_c += "  build: ... && bun run --filter @paykernel/store-sqlite build\n";
p_c += "    (order: core → webhooks → testkit → sql-store → adapter-postgres → adapter-redis → adapter-sqlite)\n";
p_c += "  typecheck: include adapter-sqlite filter\n";
p_c += "  test: include packages/store-sqlite path\n";
p_c += "  test:adapter-sqlite script recommended\n";
p_c += "  lint already covers packages/*/src\n";
p_c += "Run bun install after package creation.\n";
p_c += "Run bun run check:boundaries — must pass.\n";
p_c += "Emphasize single-host only; not multi-host distributed coordination.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:14-drivers-tests", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:14-docs-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 14 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 15+ adapters or reconciliation package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/store-sqlite exists as @paykernel/store-sqlite (publishable).\n";
p_int += "2) createSqliteIdempotencyStore / createSqliteWebhookInboxStore / createSqliteReconciliationStore implement full Phase 9 contracts.\n";
p_int += "3) Subpath exports: /bun, /node, /better-sqlite3 present in package.json exports.\n";
p_int += "4) Root entry has ZERO static imports of bun:sqlite, node:sqlite, better-sqlite3.\n";
p_int += "5) Depends on testkit + sql-store; core/webhooks/adapter-postgres/adapter-redis do NOT depend on adapter-sqlite.\n";
p_int += "6) Claims use IMMEDIATE sync transaction and/or atomic ON CONFLICT — not unprotected get-then-set.\n";
p_int += "7) Injectable clock for FakeClock conformance.\n";
p_int += "8) StorageAdapterManifest: single-host, strong claims, honest deployment limits notes.\n";
p_int += "9) migrateSqliteAdapter explicit; never auto on import/create.\n";
p_int += "10) applyRecommendedPragmas or docs for busy_timeout + WAL.\n";
p_int += "11) Conformance suites pass on Bun SQLite (memory; file smoke where practical).\n";
p_int += "12) Contention / busy_timeout / WAL / restart / migration tests exist.\n";
p_int += "13) Docs: overview, crash-boundaries, drivers, claims, deployment-limits, migrations, testing, guarantees, README, CHANGELOG.\n";
p_int += "14) monorepo.md + workspace-boundaries.md updated; root scripts include package.\n";
p_int += "15) Phase 0-13 safety: typecheck, tests core+testkit+webhooks+sql-store+adapter-postgres+adapter-redis+adapter-sqlite,\n";
p_int += "    build, boundaries, runtime portability green.\n";
p_int += "16) exactOptionalPropertyTypes clean.\n";
p_int += "17) public-api.test freezes exports; root no-driver assertion.\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "19) If Stream A failed, implement the full adapter package yourself — Phase 14 cannot ship without it.\n";
p_int += "20) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap).\n";
p_int += "21) Ensure package builds dist for root + 3 subpaths.\n";
p_int += "22) Never advertise multi-host distributed coordination for local SQLite.\n";
p_int += "23) Store method APIs may be async (matching Phase 9 contracts) but claim BODIES must use sync transaction on the executor.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase14",
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
p_ver += "Verify Phase 14 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/store-sqlite/dist/index.js && test -f packages/core/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence package @paykernel/store-sqlite exists with three store factories\n";
p_ver += "12) Evidence package.json exports ./bun ./node ./better-sqlite3\n";
p_ver += "13) Evidence root entry does not import bun:sqlite/node:sqlite/better-sqlite3 (grep)\n";
p_ver += "14) Evidence claim paths use IMMEDIATE transaction or ON CONFLICT atomic writes (grep stores)\n";
p_ver += "15) Evidence no unprotected get-then-set claim (claim body in transaction)\n";
p_ver += "16) Evidence StorageAdapterManifest single-host + deployment limit notes\n";
p_ver += "17) Evidence migrate is explicit; import-no-migrate test exists\n";
p_ver += "18) Evidence conformance tests pass on Bun SQLite\n";
p_ver += "19) Evidence contention, WAL/busy, restart, migration tests\n";
p_ver += "20) Evidence docs: deployment-limits, drivers, claims, crash-boundaries, migrations, testing\n";
p_ver += "21) Evidence core/webhooks/adapter-postgres/adapter-redis package.json have no adapter-sqlite dep\n";
p_ver += "22) Evidence monorepo scripts include adapter-sqlite\n";
p_ver += "23) Evidence Bun binding createBunSqliteStores + in-memory helper\n";
p_ver += "24) Evidence Node and better-sqlite3 subpaths exist (tests may skip)\n";
p_ver += "25) Evidence no Phase 15 adapter packages created\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- package_ok: package exists with correct name and build\n";
p_ver += "- factories_ok: three createSqlite* factories implement contracts\n";
p_ver += "- driver_subpaths_ok: three subpaths exported\n";
p_ver += "- root_no_drivers_ok: root has no optional driver static imports\n";
p_ver += "- claim_atomic_ok: IMMEDIATE/ON CONFLICT claims; not unprotected get-set\n";
p_ver += "- manifest_ok: single-host honest durability notes\n";
p_ver += "- conformance_ok: suites pass on Bun SQLite\n";
p_ver += "- deployment_docs_ok: 14.5 four limits documented\n";
p_ver += "- bun_binding_ok: prepared statements, sync txn, busy_timeout/WAL, in-memory helper\n";
p_ver += "- node_binding_ok: /node isolated; version matrix docs; DatabaseSync\n";
p_ver += "- better_sqlite3_ok: /better-sqlite3 binding; sync txn; peer optional\n";
p_ver += "- docs_ok: full docs set + monorepo links\n";
p_ver += "- compat_ok: Phase 0-13 green; boundaries; no illegal deps\n";
p_ver += "Set ok=true only if typecheck, tests (all packages), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase14",
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
    write_scratch_file("phase14-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 14 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 14 — each PASS or BLOCKING:\n";
p_gate += "A1) Bun SQLite is a production-capable single-host adapter.\n";
p_gate += "    Evidence: /bun subpath; createBunSqliteStores; prepared statements; sync IMMEDIATE transactions;\n";
p_gate += "    busy_timeout/WAL docs or helpers; in-memory test helper; conformance pass; file restart durability.\n";
p_gate += "A2) each subpath imports only its driver.\n";
p_gate += "    Evidence: /bun imports bun:sqlite only there; /node imports node:sqlite only there;\n";
p_gate += "    /better-sqlite3 imports better-sqlite3 only there; root has none; public-api + boundaries.\n";
p_gate += "A3) no local SQLite adapter is misrepresented as distributed coordination.\n";
p_gate += "    Evidence: manifest coordinationScope single-host; deployment-limits.md; overview honesty;\n";
p_gate += "    notes about one filesystem authority / no network FS / no serverless ephemeral / scale-out needs shared service.\n\n";
p_gate += "Also require Phase 14 sections 14.1-14.6 deliverables:\n";
p_gate += "- 14.1 Bun binding complete\n";
p_gate += "- 14.2 Node SQLite binding isolated + version/stability docs\n";
p_gate += "- 14.3 better-sqlite3 binding complete\n";
p_gate += "- 14.4 claim semantics atomic (IMMEDIATE txn or ON CONFLICT)\n";
p_gate += "- 14.5 deployment limits documented\n";
p_gate += "- 14.6 test matrix: Bun memory+file, node (skip ok), better-sqlite3 (skip ok), contention, busy, WAL, restart, migration\n";
p_gate += "- Injectable clock for conformance\n";
p_gate += "- Explicit migrate only; never on import\n";
p_gate += "- Phase 0-13 safety net still green; boundaries; no illegal deps\n";
p_gate += "- No Phase 15 packages\n";
p_gate += "- No logical bugs: get/set claim race; async txn callbacks; multi-host lies; secrets unbounded;\n";
p_gate += "  root importing drivers; FakeClock ignored; auto-migrate; serverless advertised durable.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite\n";
p_gate += "  bun run typecheck; check:boundaries; focused adapter-sqlite tests.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/store-sqlite/docs/phase-14-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-14-gate-report.md (full or pointer + verdict summary).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase14-adversarial",
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
    write_scratch_file("phase14-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 14 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 14 only — no Phase 15 adapters, no reconciliation package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete packages/store-sqlite: factories, subpaths, atomic claims, Bun/Node/better-sqlite3,\n";
    p_fix += "manifest honesty, deployment limits, conformance, docs, monorepo wiring as needed.\n";
    p_fix += "Preserve Phase 0-13, adapter-postgres, adapter-redis.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase14-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 14 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm all 14.1-14.6 deliverables and acceptance criteria A1-A3 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase14-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase14-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 14 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/store-sqlite/docs/phase-14-gate-report.md and packages/core/docs/baseline/phase-14-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 14.1-14.6 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase14-final",
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
        write_scratch_file("phase14-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 14 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 14,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
