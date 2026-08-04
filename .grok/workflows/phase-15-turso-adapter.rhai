let meta = #{
    name: "phase-15-turso-adapter",
    description: "Phase 15 Turso and libSQL Adapter: critic, implement @paykernel/store-turso (serverless, libsql, atomic claims, concurrency, drizzle examples), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 15 roadmap 15.1-15.4 and acceptance criteria" },
        #{ title: "Implement", detail: "adapter-turso package: stores, subpaths, migrate, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-14 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 15 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 15" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 15 (Turso and libSQL Adapter) for PayKernel monorepo",
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
        "claim_atomic_ok", "manifest_ok", "conformance_ok", "concurrency_ok",
        "serverless_binding_ok", "libsql_binding_ok", "no_sync_subpath_ok",
        "drizzle_ok", "docs_ok", "compat_ok", "failures", "summary"
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
        "concurrency_ok": #{ "type": "boolean" },
        "serverless_binding_ok": #{ "type": "boolean" },
        "libsql_binding_ok": #{ "type": "boolean" },
        "no_sync_subpath_ok": #{ "type": "boolean" },
        "drizzle_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 15 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 15 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 15 — Turso and libSQL Adapter\" completely\n";
p_critic += "(Package, Objective, Recommended Subpaths, Tasks 15.1-15.4, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  11 atomicity by storage engine not get/set; 13 prepared / bound / scripted only;\n";
p_critic += "  14 no raw payloads by default; 15 portable timestamps/IDs;\n";
p_critic += "  16 every adapter same conformance suite; 17 document crash boundaries;\n";
p_critic += "  19 never auto-migrate on import/prod construction.\n";
p_critic += "Also section 3.2 (Do Not Treat Every SQLite Product as the Same Runtime),\n";
p_critic += "3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings,\n";
p_critic += "3.5 Each Adapter Must Declare Its Guarantees, 3.7 Local SQLite Is a Single-Host Default\n";
p_critic += "(contrast: Turso remote is multi-host shared), 5 Proposed Repository Structure (adapter-turso),\n";
p_critic += "5.1 Package Boundary Rules (adapter root must not import optional drivers),\n";
p_critic += "section 30 Current Runtime Notes: Turso recommends @tursodatabase/serverless for remote\n";
p_critic += "and retains @libsql/client for mature ORM compatibility — transaction/concurrency must be\n";
p_critic += "tested independently, not treated as interchangeable. Recheck official docs if needed.\n";
p_critic += "Phases 0-14 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, store contracts, webhook inbox engine,\n";
p_critic += "private internal/sql-store relational foundation, packages/store-postgres, adapter-redis, adapter-sqlite.\n";
p_critic += "Do NOT start Phase 16+ (adapter-cloudflare-d1, adapter-cloudflare-do),\n";
p_critic += "Phase 18 matrix package-only work as a separate deliverable, reconciliation domain package,\n";
p_critic += "new PSPs, or gateway extraction.\n";
p_critic += "Do NOT implement the optional /sync subpath (roadmap: only after local-first conflict tests).\n";
p_critic += "Do NOT rewrite Phase 5-14 domain/foundation packages unless required for monorepo wiring/docs.\n\n";

p_critic += "CONTEXT already present from Phase 9-14:\n";
p_critic += "- packages/testkit — LeaseAware IdempotencyStore / WebhookInboxStore / ReconciliationStore contracts\n";
p_critic += "- packages/testkit — runIdempotencyStoreConformanceSuite / runWebhookInboxStoreConformanceSuite / runReconciliationStoreConformanceSuite\n";
p_critic += "- packages/testkit — StorageAdapterManifest + assertStorageAdapterManifest + FakeClock\n";
p_critic += "- packages/webhooks — inbox engine; dual-owned WebhookInboxStore\n";
p_critic += "- internal/sql-store — schemas, codecs, migrations (FOUNDATION_SQL_SQLITE), claim templates with sqlite dialect\n";
p_critic += "  (idempotencyReserveTemplates().sqlite, webhookClaimTemplates().sqlite, etc.)\n";
p_critic += "  decideIdempotencyReserve / decideWebhookClaim algorithms\n";
p_critic += "- packages/store-postgres — Phase 12 async remote SQL pattern (subpaths, errors, manifest, migrate, skip-without-env)\n";
p_critic += "  PREFER this structural model for Turso (async executor, multi-host, env-gated live tests)\n";
p_critic += "- packages/store-redis — Phase 13 COMPLETE — preserve\n";
p_critic += "- packages/store-sqlite — Phase 14 COMPLETE single-host local SQLite — preserve; do NOT conflate with Turso\n";
p_critic += "- scripts/check-workspace-boundaries.ts already lists @libsql/client and @tursodatabase/serverless in ADAPTER_OPTIONAL_DRIVERS\n";
p_critic += "- NO packages/store-turso yet; monorepo docs say further adapters (turso/d1/…) land later.\n\n";

p_critic += "Audit against EVERY Phase 15 requirement with evidence (grep/read):\n\n";

p_critic += "Package: @paykernel/store-turso under packages/store-turso\n\n";

p_critic += "Objective: Support globally accessible SQLite-compatible storage WITHOUT conflating it with a local file database.\n";
p_critic += "Remote Turso is a SHARED durable store (multi-host). Local SQLite adapter remains single-host.\n\n";

p_critic += "Recommended Subpath exports (root must contain only shared types and must NOT import a driver):\n";
p_critic += "  @paykernel/store-turso/serverless  — @tursodatabase/serverless (fetch-based)\n";
p_critic += "  @paykernel/store-turso/libsql       — @libsql/client (mature client / ORM path)\n";
p_critic += "Optional future (DO NOT implement):\n";
p_critic += "  @paykernel/store-turso/sync        — forbidden until local-first conflict tests exist\n\n";

p_critic += "15.1 Turso Serverless Binding:\n";
p_critic += "- support current fetch-based Turso serverless client (@tursodatabase/serverless)\n";
p_critic += "  where transaction and statement capabilities satisfy store contracts\n";
p_critic += "- PREFER atomic single-statement claims to reduce dependence on interactive transactions\n";
p_critic += "- prepared/bound parameters only; async-friendly executor\n\n";

p_critic += "15.2 libSQL Binding:\n";
p_critic += "- support @libsql/client for existing applications and ORM compatibility\n";
p_critic += "- use write transactions or transactional batches when multiple statements are unavoidable\n";
p_critic += "- support remote URLs and local file URLs only through appropriate runtime entry points\n";
p_critic += "- document that legacy embedded replica behavior differs from true local-first sync\n";
p_critic += "- do NOT advertise untested embedded-replica / sync guarantees\n\n";

p_critic += "15.3 Concurrency and Consistency tests:\n";
p_critic += "- concurrent remote claims (multi-connection / multi-instance)\n";
p_critic += "- transaction rollback\n";
p_critic += "- read-after-write behavior\n";
p_critic += "- timeout and reconnect behavior (document + test where feasible)\n";
p_critic += "- lease expiry (FakeClock or time-based reclaim)\n";
p_critic += "- multiple application instances (logical multi-client against same DB)\n\n";

p_critic += "15.4 Drizzle Compatibility:\n";
p_critic += "- optional Drizzle schema exports or examples\n";
p_critic += "- correctness-critical claim statements MUST execute through the tested adapter path\n";
p_critic += "- do NOT assume every ORM query builder can express conditional atomic write safely\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) Turso remote deployments can act as a shared durable inbox and reconciliation store\n";
p_critic += "A2) libSQL compatibility remains available\n";
p_critic += "A3) sync or embedded-replica modes are not advertised beyond tested guarantees\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/store-turso depends on testkit + internal/sql-store (workspace:*)\n";
p_critic += "- MAY depend on core only if needed — prefer testkit contracts + sql-store foundation\n";
p_critic += "- core must NOT depend on adapter-turso\n";
p_critic += "- webhooks must NOT depend on adapter-turso\n";
p_critic += "- adapter-postgres / adapter-redis / adapter-sqlite must NOT depend on adapter-turso\n";
p_critic += "- drivers as optional peerDependencies; isolated subpaths only\n";
p_critic += "- @tursodatabase/serverless peer for /serverless\n";
p_critic += "- @libsql/client peer for /libsql\n";
p_critic += "- optional drizzle-orm peer ONLY if drizzle examples/export path exists (still isolated)\n";
p_critic += "- do NOT create adapter-cloudflare-d1 / adapter-cloudflare-do (Phase 16+)\n";
p_critic += "- do NOT create packages/reconciliation domain package\n";
p_critic += "- do NOT implement /sync subpath\n";
p_critic += "- do NOT conflate adapter-turso with adapter-sqlite (local single-host)\n\n";

p_critic += "Critical design constraints to flag as risks if missing plan:\n";
p_critic += "- Injectable clock for conformance (FakeClock.advance must control lease expiry)\n";
p_critic += "- Prefer single-statement atomic UPSERT (ON CONFLICT … RETURNING) for remote Turso;\n";
p_critic += "  multi-statement only inside write transaction / transactional batch — never get-then-set\n";
p_critic += "- generation monotonic on reserve/claim/renew; unguessable leaseToken\n";
p_critic += "- stale lease complete/fail → StoreLeaseLostError\n";
p_critic += "- indeterminate rows block reserve (A4 from Phase 9)\n";
p_critic += "- StorageAdapterManifest honesty: coordinationScope multi-host (or multi-region notes)\n";
p_critic += "  for remote Turso; durability durable; notes on remote latency, transaction limits,\n";
p_critic += "  embedded-replica NOT advertised as local-first sync without tests\n";
p_critic += "- Map StoreErrorCode taxonomy; sanitized error fields max size; no secrets (auth tokens!)\n";
p_critic += "- exactOptionalPropertyTypes ON\n";
p_critic += "- Never auto-migrate on import or default create*Stores construction\n";
p_critic += "- Explicit migrateTursoAdapter using sql-store migrate dialect sqlite\n";
p_critic += "- Live tests skip cleanly without TURSO_DATABASE_URL / LIBSQL_URL / auth token env\n";
p_critic += "- Local file: URL tests via @libsql/client file: for CI without remote Turso when feasible\n";
p_critic += "- Recheck @tursodatabase/serverless and @libsql/client APIs from official docs (section 30)\n";
p_critic += "- Async executor (not sync SQLite IMMEDIATE model) — remote is async\n";
p_critic += "- Do not copy local SQLite BEGIN IMMEDIATE sync assumptions into remote path uncritically\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: root importing drivers; get-then-set claims; conflating with local sqlite; dishonest sync ads;\n";
p_critic += "secrets/auth tokens in errors; core→adapter dep; auto-migrate; missing concurrency tests;\n";
p_critic += "Phase 16+ packages; FakeClock ignored; treating serverless and libsql as interchangeable without tests;\n";
p_critic += "implementing /sync; advertising multi-region without caveats.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase15-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase15-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 15 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 15\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 15 Turso/libSQL Adapter in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Webhooks = packages/webhooks = @paykernel/webhooks (0.1.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — Phase 9 contracts + conformance + FakeClock.\n";
common += "Sql-store = internal/sql-store = @paykernel/internal-sql-store (private Phase 11) — USE for schema/migrations/claim templates.\n";
common += "Postgres adapter = packages/store-postgres (Phase 12 COMPLETE) — MIRROR async remote SQL patterns.\n";
common += "Redis adapter = packages/store-redis (Phase 13 COMPLETE) — preserve; do not break.\n";
common += "SQLite adapter = packages/store-sqlite (Phase 14 COMPLETE, single-host) — preserve; do NOT conflate with Turso.\n";
common += "PHASE 15 ONLY: create packages/store-turso = @paykernel/store-turso.\n";
common += "Do NOT create packages/store-d1 / adapter-cloudflare-do.\n";
common += "Do NOT create packages/reconciliation (later). Do NOT add new PSPs or extract gateways.\n";
common += "Do NOT implement /sync subpath. Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside adapter-turso; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-14 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + claim atomicity + conformance + binding tests).\n";
common += "2) Atomic claims = engine-level single-statement UPSERT preferred for remote Turso;\n";
common += "   multi-statement only inside write transaction / transactional batch;\n";
common += "   NEVER unprotected get-then-set as claim strategy.\n";
common += "3) Never convert uncertain outcomes into failure (respect indeterminate contracts).\n";
common += "4) No secret leakage in error fields (sanitize; never echo authToken / TURSO_AUTH_TOKEN).\n";
common += "5) No framework coupling in portable root; drivers only on subpaths.\n";
common += "6) Root entry must NOT import @tursodatabase/serverless or @libsql/client or drizzle-orm.\n";
common += "7) Keep 0.x compat: core/webhooks/testkit/sql-store/adapter-* public APIs stable; additive only.\n";
common += "8) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "9) exactOptionalPropertyTypes is ON — no undefined assignment to optional props without care.\n";
common += "10) Core/webhooks/adapter-postgres/adapter-redis/adapter-sqlite must NOT depend on adapter-turso.\n";
common += "11) Portable ISO-8601 timestamps and opaque string lease tokens; no JS number for 64-bit IDs.\n";
common += "12) Do not store raw provider payloads/signatures by default.\n";
common += "13) Injectable clock: stores MUST accept clock/now so FakeClock works in conformance.\n";
common += "14) Publish honest StorageAdapterManifest: multi-host for remote shared Turso; durable;\n";
common += "    notes on remote client semantics; NEVER advertise untested sync/embedded-replica local-first.\n";
common += "15) Map driver errors into StoreErrorCode taxonomy (StoreLeaseLostError, StoreUnavailableError, etc.).\n";
common += "16) Never auto-migrate on import or default create*Stores — explicit migrateTursoAdapter only.\n";
common += "17) Prefer sql-store SQLITE dialect schema + claim strategy adapted for async remote (not local IMMEDIATE).\n";
common += "18) Async executor (remote HTTP) — do NOT require sync transaction callbacks like local SQLite.\n";
common += "19) Document crash boundaries, concurrency limits, remote vs local file URL entry points.\n";
common += "20) Mirror Phase 9 contract semantics from packages/testkit/src/storage/contracts.ts.\n";
common += "21) Mirror packages/store-postgres structure (executor/stores/migrate/manifest/errors/clock/drivers)\n";
common += "    adapted for Turso/libSQL (sqlite dialect SQL, ? placeholders typically).\n";
common += "22) Recheck official Turso TS SDK docs: https://docs.turso.tech/sdk/ts/reference — pin tested versions in manifest notes.\n";
common += "23) Serverless binding uses @tursodatabase/serverless (connect/execute/batch/transaction per current API).\n";
common += "24) libSQL binding uses @libsql/client (createClient, execute, batch, transaction).\n";
common += "25) Do not treat serverless and libsql as interchangeable — test both paths independently.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: package scaffold + executor + stores + claims + migrate + manifest
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE SCAFFOLD + TURSO EXECUTOR PORT + STORE FACTORIES + CLAIMS + MIGRATE + MANIFEST (Tasks 15.1 partial, 15.2 partial).\n";
p_a += "OWN primarily: packages/store-turso/** (NEW package).\n";
p_a += "May touch root package.json scripts ONLY if needed — prefer leave monorepo polish to Integrate/Stream C.\n";
p_a += "Do NOT write phase-15-gate-report.md (Gate owns it).\n";
p_a += "Do NOT implement Cloudflare D1/DO adapters or /sync subpath.\n";
p_a += "Do NOT break packages/store-postgres, adapter-redis, or adapter-sqlite.\n\n";

p_a += "### Create package packages/store-turso\n";
p_a += "Name: @paykernel/store-turso\n";
p_a += "version 0.1.0; type module; publishable (NOT private).\n";
p_a += "description: Turso serverless and libSQL stores for PayKernel lease-aware idempotency, webhook inbox, and reconciliation (shared remote SQLite-compatible).\n";
p_a += "dependencies:\n";
p_a += "  @paykernel/testkit: workspace:*\n";
p_a += "  @paykernel/internal-sql-store: workspace:*\n";
p_a += "optional peerDependencies:\n";
p_a += "  @tursodatabase/serverless — for /serverless subpath\n";
p_a += "  @libsql/client — for /libsql subpath\n";
p_a += "  drizzle-orm — optional only if drizzle schema examples are exported (may keep docs-only without peer)\n";
p_a += "peerDependenciesMeta: all optional true\n";
p_a += "devDependencies: @types/bun, typescript, @tursodatabase/serverless, @libsql/client for tests as needed\n";
p_a += "scripts: build multi-entry (root + serverless + libsql) + build:types, typecheck, test\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist\n";
p_a += "LICENSE MIT (copy from sibling). README + CHANGELOG.\n";
p_a += "publishConfig access public + provenance true (match adapter-postgres).\n";
p_a += "paymentsSdk: { portable: false, runtime: \"node-or-bun\" }\n";
p_a += "After package.json exists: bun install from monorepo root.\n\n";

p_a += "### Exports map (CRITICAL — root must not pull drivers)\n";
p_a += "```json\n";
p_a += "{\n";
p_a += "  \".\": { \"types\": \"./dist/index.d.ts\", \"import\": \"./dist/index.js\" },\n";
p_a += "  \"./serverless\": { \"types\": \"./dist/serverless.d.ts\", \"import\": \"./dist/serverless.js\" },\n";
p_a += "  \"./libsql\": { \"types\": \"./dist/libsql.d.ts\", \"import\": \"./dist/libsql.js\" }\n";
p_a += "}\n";
p_a += "```\n";
p_a += "NO ./sync export. Root exports: store factories accepting a narrow TursoExecutor / async port,\n";
p_a += "migrate helpers, manifest, types, clock — ZERO static imports of @tursodatabase/serverless / @libsql/client / drizzle-orm.\n";
p_a += "Subpaths: thin bindings that adapt driver client types to the executor port and re-export factories.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/store-turso/src/\n";
p_a += "  index.ts                 # curated public root exports\n";
p_a += "  manifest.ts              # TURSO_STORAGE_ADAPTER_MANIFEST + getter\n";
p_a += "  types.ts                 # TursoStoreOptions, clock, namespace, TursoExecutor\n";
p_a += "  executor.ts              # narrow async executor: query/execute + optional transaction/batch\n";
p_a += "  errors.ts                # map driver errors → StoreErrorCode; strip auth tokens from messages\n";
p_a += "  clock.ts                 # Clock interface compatible with testkit FakeClock\n";
p_a += "  migrate.ts               # migrateTursoAdapter / verifyTursoAdapterSchema (dialect: sqlite)\n";
p_a += "  stores/\n";
p_a += "    idempotency-store.ts\n";
p_a += "    webhook-inbox-store.ts\n";
p_a += "    reconciliation-store.ts\n";
p_a += "    shared.ts\n";
p_a += "  index-stores.ts          # createTurso* factories + createTursoStores bundle\n";
p_a += "  drivers/\n";
p_a += "    serverless.ts\n";
p_a += "    libsql.ts\n";
p_a += "  serverless.ts / libsql.ts  # subpath re-exports\n";
p_a += "  drizzle-schema.ts        # optional schema examples / table defs (NOT claim path)\n";
p_a += "  public-api.test.ts\n";
p_a += "  import-no-migrate.test.ts\n";
p_a += "  errors.test.ts\n";
p_a += "  stores/*.test.ts\n";
p_a += "  conformance.turso.test.ts\n";
p_a += "  concurrency.turso.test.ts\n";
p_a += "  migrate.turso.test.ts\n";
p_a += "  drivers/*.test.ts\n";
p_a += "  test-utils/turso-env.ts   # env detection + skip helpers\n\n";

p_a += "### Narrow TursoExecutor (async — remote-friendly)\n";
p_a += "Remote clients are ASYNCHRONOUS. Design like PostgresExecutor, not SqliteExecutor sync.\n";
p_a += "Recommended shape (adapt as needed but keep narrow):\n";
p_a += "```ts\n";
p_a += "export interface TursoExecutor {\n";
p_a += "  /** Run SQL with bound params; return rows as plain objects. */\n";
p_a += "  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;\n";
p_a += "  /** Execute write; return changes if useful. */\n";
p_a += "  execute(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;\n";
p_a += "  /**\n";
p_a += "   * Optional: run multiple statements in one write transaction / transactional batch.\n";
p_a += "   * Required when multi-statement claims cannot be reduced to single-statement UPSERT.\n";
p_a += "   */\n";
p_a += "  transaction?<T>(fn: (tx: TursoExecutor) => Promise<T>): Promise<T>;\n";
p_a += "  batch?(statements: Array<{ sql: string; params?: readonly unknown[] }>): Promise<void>;\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Also provide toSqlStoreExecutor adapter for sql-store migrate() which uses async SqlExecutor.\n";
p_a += "Stores MUST depend only on TursoExecutor (+ clock + namespace options), never on a specific driver type.\n\n";

p_a += "### Claim implementation (CRITICAL — prefer single-statement)\n";
p_a += "Implement full Phase 9 contracts for:\n";
p_a += "  createTursoIdempotencyStore\n";
p_a += "  createTursoWebhookInboxStore\n";
p_a += "  createTursoReconciliationStore\n";
p_a += "  createTursoStores (bundle)\n\n";
p_a += "Claim strategy for REMOTE Turso/libSQL:\n";
p_a += "PREFERRED: single-statement INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING\n";
p_a += "  using SQLite-compatible UPSERT + RETURNING (libSQL/Turso support modern SQLite RETURNING).\n";
p_a += "  You may adapt sql-store postgres template logic to SQLite placeholders (?),\n";
p_a += "  OR implement equivalent single-statement SQL that matches decide* algorithm semantics,\n";
p_a += "  OR use sql-store sqlite multi-step templates ONLY inside one write transaction/batch.\n";
p_a += "If multi-statement is unavoidable: use executor.transaction or transactional batch so decision+write is atomic.\n";
p_a += "Do NOT do unprotected get-then-set across round-trips without a transaction.\n";
p_a += "Rules:\n";
p_a += "- generation increments on successful reserve/claim/renew that issues new lease\n";
p_a += "- leaseToken: unguessable from crypto.randomUUID or randomBytes\n";
p_a += "- complete/fail/renew require matching leaseToken; mismatch → StoreLeaseLostError\n";
p_a += "- fingerprint/payloadHash conflicts return explicit conflict kinds\n";
p_a += "- indeterminate: reserve returns kind indeterminate; cleanup does NOT remove by default\n";
p_a += "- prepared/bound only — NEVER string-interpolate user values\n";
p_a += "- injectable clock: lease predicates use clock.now() / nowIso\n";
p_a += "Read packages/store-postgres/src/stores/* as primary structural reference (async).\n";
p_a += "Read packages/store-sqlite/src/stores/* for sqlite template step usage (but convert to async remote).\n";
p_a += "Read packages/testkit/src/memory/memory-stores.ts as behavioral oracle.\n";
p_a += "Read internal/sql-store/src/claims/templates.ts for SQL fragments.\n\n";

p_a += "### Migrate (explicit only)\n";
p_a += "migrateTursoAdapter(executor, options?) → sql-store migrate with dialect: \"sqlite\"\n";
p_a += "verifyTursoAdapterSchema(executor, options?)\n";
p_a += "NEVER call migrate from package import or from createTursoStores by default.\n";
p_a += "import-no-migrate.test.ts must prove this.\n\n";

p_a += "### Manifest (honesty — remote shared store)\n";
p_a += "```ts\n";
p_a += "{\n";
p_a += "  name: \"turso\",\n";
p_a += "  contracts: { idempotency: true, webhookInbox: true, reconciliation: true },\n";
p_a += "  consistency: { claims: \"strong\", readAfterWrite: \"strong\", staleReadsPossible: false },\n";
p_a += "  coordinationScope: \"multi-host\",  // remote shared Turso/libSQL primary\n";
p_a += "  durability: \"durable\",\n";
p_a += "  supportsTransactions: true,\n";
p_a += "  supportsLeases: true,\n";
p_a += "  supportsRetentionCleanup: true,\n";
p_a += "  notes: [\n";
p_a += "    \"Shared durable SQLite-compatible store for multi-host deployments via Turso remote or libSQL remote URL.\",\n";
p_a += "    \"Not the same as packages/store-sqlite local single-host file databases.\",\n";
p_a += "    \"Claims prefer single-statement ON CONFLICT/RETURNING UPSERTs; multi-statement only in write transactions/batches.\",\n";
p_a += "    \"Never unprotected get-then-set across round-trips for claim correctness.\",\n";
p_a += "    \"@tursodatabase/serverless and @libsql/client are NOT interchangeable — use matching subpath; test independently.\",\n";
p_a += "    \"Embedded replica / sync modes are NOT advertised as true local-first sync; /sync subpath is not shipped.\",\n";
p_a += "    \"Legacy embedded replica semantics differ from true local-first sync — do not assume offline conflict resolution.\",\n";
p_a += "    \"Migrations are explicit (migrateTursoAdapter) — never on package import or default factory construction.\",\n";
p_a += "    \"Injectable clock: lease reclaim predicates use injected now; FakeClock works in conformance tests.\",\n";
p_a += "    \"Timestamps stored as TEXT ISO-8601; generation as INTEGER; lease tokens as TEXT.\",\n";
p_a += "    \"Root entry does not import @tursodatabase/serverless / @libsql/client; use isolated subpath bindings.\",\n";
p_a += "    \"Auth tokens must never appear in StoreError messages or logs.\",\n";
p_a += "    \"Pin tested client versions and verification date in docs when live tests run.\",\n";
p_a += "  ]\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Validate with assertStorageAdapterManifest.\n\n";

p_a += "### Public exports (root) — freeze in public-api.test.ts\n";
p_a += "createTursoIdempotencyStore, createTursoWebhookInboxStore, createTursoReconciliationStore,\n";
p_a += "createTursoStores (bundle),\n";
p_a += "migrateTursoAdapter, verifyTursoAdapterSchema,\n";
p_a += "TURSO_STORAGE_ADAPTER_MANIFEST / getTursoStorageAdapterManifest,\n";
p_a += "TursoExecutor type, mapDriverError / StoreError re-exports as needed,\n";
p_a += "clock helpers, optional drizzle schema example export if implemented as pure SQL/TS without driver imports.\n";
p_a += "Assert root source graph has no import of '@tursodatabase/serverless' | '@libsql/client' | 'drizzle-orm'.\n";
p_a += "Assert package.json exports has NO ./sync.\n\n";

p_a += "### Stream A tests\n";
p_a += "- public-api freeze + root no drivers + no sync export\n";
p_a += "- import-no-migrate\n";
p_a += "- store unit tests with mock TursoExecutor (in-memory fake) OR local file: via libsql if available\n";
p_a += "- error mapping unit tests (secrets stripped)\n";
p_a += "- manifest assert + coordinationScope multi-host + no sync advertising\n";
p_a += "- migrate unit tests against mock/local executor\n";
p_a += "Run package typecheck/tests after wiring.\n";

let a_result = agent(p_a, #{
    label: "impl:15-stores-claims",
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

// Parallel: B drivers+conformance+concurrency, C docs+monorepo+drizzle
log("Implementing Phase 15 drivers/tests and docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — DRIVER BINDINGS + CONFORMANCE + CONCURRENCY + LIVE/SKIP TESTS (Tasks 15.1, 15.2, 15.3).\n";
p_b += "OWN: packages/store-turso/src/drivers/**, subpath entries, integration/conformance/concurrency tests.\n";
p_b += "May extend Stream A store/claim files if missing transitions or bugs.\n";
p_b += "Do NOT write gate report. Do NOT create Phase 16+ adapters. Do NOT implement /sync.\n";
p_b += "Do NOT break adapter-postgres/redis/sqlite.\n\n";

p_b += "### 15.1 Serverless binding (/serverless)\n";
p_b += "```ts\n";
p_b += "import { connect } from \"@tursodatabase/serverless\";\n";
p_b += "import { createTursoServerlessStores } from \"@paykernel/store-turso/serverless\";\n";
p_b += "const conn = connect({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });\n";
p_b += "const stores = createTursoServerlessStores({ client: conn /* or connection */ });\n";
p_b += "```\n";
p_b += "Implement (match current @tursodatabase/serverless API — recheck docs):\n";
p_b += "- createTursoServerlessExecutor(client): TursoExecutor\n";
p_b += "- createTursoServerlessStores({ client/connection, clock?, namespace?, ... })\n";
p_b += "- createTursoServerlessIdempotencyStore / WebhookInbox / Reconciliation as needed\n";
p_b += "- bound parameters via execute/prepare as supported\n";
p_b += "- use batch/transaction when multi-statement claims require it\n";
p_b += "- Isolate ALL @tursodatabase/serverless imports in drivers/serverless.ts and serverless.ts entry only\n";
p_b += "- Prefer single-statement claims on this path\n\n";

p_b += "### 15.2 libSQL binding (/libsql)\n";
p_b += "```ts\n";
p_b += "import { createClient } from \"@libsql/client\";\n";
p_b += "import { createLibsqlStores } from \"@paykernel/store-turso/libsql\";\n";
p_b += "const client = createClient({ url: process.env.LIBSQL_URL ?? process.env.TURSO_DATABASE_URL! });\n";
p_b += "const stores = createLibsqlStores({ client });\n";
p_b += "```\n";
p_b += "Implement:\n";
p_b += "- createLibsqlExecutor(client) / createLibsqlStores({ client })\n";
p_b += "- use write transactions or transactional batches when multiple statements unavoidable\n";
p_b += "- support remote URLs (libsql://, https://) and local file: URLs through this entry point only\n";
p_b += "- document embedded replica behavior differs from true local-first sync (docs)\n";
p_b += "- Isolate ALL @libsql/client imports in drivers/libsql.ts and libsql.ts entry only\n";
p_b += "- Tests: local file: URL when @libsql/client is available for CI without remote credentials\n\n";

p_b += "### 15.3 Concurrency and Consistency tests\n";
p_b += "1) runIdempotencyStoreConformanceSuite with libsql file: OR remote + FakeClock\n";
p_b += "2) runWebhookInboxStoreConformanceSuite same\n";
p_b += "3) runReconciliationStoreConformanceSuite same\n";
p_b += "4) Concurrent claims: two clients/executors against same DB → exactly one claim winner\n";
p_b += "5) Transaction rollback test (batch/txn fails atomically)\n";
p_b += "6) Read-after-write smoke after claim\n";
p_b += "7) Timeout / reconnect behavior: document; unit-map StoreTimeoutError / StoreUnavailableError where mappable\n";
p_b += "8) Lease expiry reclaim with FakeClock\n";
p_b += "9) Multiple application instances: two store instances same DB different owners\n";
p_b += "10) Migration tests: migrate then verifySchema; no auto-migrate on import\n";
p_b += "11) Stale lease complete/fail → StoreLeaseLostError\n";
p_b += "12) Serverless live tests skip cleanly without TURSO_DATABASE_URL (+ auth if required)\n";
p_b += "13) libSQL remote skip cleanly; file: path runs when native module works\n";
p_b += "14) Driver unit tests for executor mapping without claiming untested sync guarantees\n";
p_b += "Use unique table namespaces/prefixes per test run to avoid collisions on shared remote DBs.\n";
p_b += "Env helpers: PAYMENTS_SDK_TURSO_URL, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LIBSQL_URL — document all.\n\n";

p_b += "### After implementation\n";
p_b += "bun install; typecheck package; bun test packages/store-turso\n";
p_b += "Also run full monorepo safety including adapter-turso:\n";
p_b += "bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCS + DRIZZLE EXAMPLES + MONOREPO WIRING for Phase 15 (Tasks 15.4 + docs).\n";
p_c += "OWN: packages/store-turso/README.md, packages/store-turso/docs/**,\n";
p_c += "packages/store-turso/CHANGELOG.md Unreleased Phase 15,\n";
p_c += "packages/store-turso/src/drizzle-schema.ts or docs/drizzle-examples.md (15.4),\n";
p_c += "docs/monorepo.md (layout: packages/store-turso present),\n";
p_c += "docs/workspace-boundaries.md (adapter-turso rules, root no drivers, multi-host remote honesty),\n";
p_c += "docs/releases.md note if adapters publish separately,\n";
p_c += "root package.json scripts: include adapter-turso in build/typecheck/test filters AFTER adapter-sqlite,\n";
p_c += "root package.json description lists adapter-turso,\n";
p_c += "packages/testkit/docs/store-contracts.md short pointer that Phase 15 turso adapter exists,\n";
p_c += "root README if it lists packages.\n";
p_c += "Do NOT write phase-15-gate-report.md (Gate owns it).\n\n";

p_c += "### Docs that MUST exist under packages/store-turso/docs/\n";
p_c += "1) overview.md — purpose, remote shared store, NOT local SQLite, subpaths serverless/libsql, no /sync\n";
p_c += "2) crash-boundaries.md — crash before/after side effect; lease reclaim; remote network failure indeterminate\n";
p_c += "3) drivers.md — /serverless vs /libsql; APIs; not interchangeable; remote vs file: URLs; tested versions\n";
p_c += "4) claims.md — prefer single-statement UPSERT; multi-statement only in txn/batch; no get-then-set\n";
p_c += "5) concurrency.md — multi-instance, concurrent claims, rollback, read-after-write, timeout/reconnect\n";
p_c += "6) migrations.md — explicit migrate; never on import; sql-store foundation dialect sqlite\n";
p_c += "7) testing.md — env vars, skip-without-env, file: local libsql, FakeClock, namespaces\n";
p_c += "8) guarantees.md / manifest notes aligned with TURSO_STORAGE_ADAPTER_MANIFEST\n";
p_c += "9) embedded-replicas.md or section — legacy embedded replica ≠ true local-first sync; /sync not shipped\n";
p_c += "10) drizzle.md or drizzle-examples — schema examples; claims MUST use adapter path not ORM builders alone\n\n";

p_c += "### 15.4 Drizzle\n";
p_c += "Provide optional schema table definitions / examples matching sql-store foundation columns.\n";
p_c += "Clearly state: correctness-critical claims go through createTurso*Stores, not raw Drizzle query builders.\n";
p_c += "Do not require drizzle-orm for core adapter operation (optional peer or docs-only is fine).\n\n";

p_c += "### monorepo wiring (required)\n";
p_c += "Root workspaces already packages/* so adapter-turso is auto-discovered.\n";
p_c += "Update scripts:\n";
p_c += "  build: ... && bun run --filter @paykernel/store-turso build\n";
p_c += "    (order: ... → adapter-sqlite → adapter-turso)\n";
p_c += "  typecheck: include adapter-turso filter\n";
p_c += "  test: include packages/store-turso path\n";
p_c += "  test:adapter-turso script recommended\n";
p_c += "  lint already covers packages/*/src\n";
p_c += "Run bun install after package creation.\n";
p_c += "Run bun run check:boundaries — must pass.\n";
p_c += "Emphasize multi-host remote; not local single-host SQLite; no untested sync ads.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:15-drivers-tests", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:15-docs-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 15 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 16+ adapters or reconciliation package or /sync.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/store-turso exists as @paykernel/store-turso (publishable).\n";
p_int += "2) createTursoIdempotencyStore / createTursoWebhookInboxStore / createTursoReconciliationStore implement full Phase 9 contracts.\n";
p_int += "3) Subpath exports: /serverless, /libsql present in package.json exports; NO ./sync.\n";
p_int += "4) Root entry has ZERO static imports of @tursodatabase/serverless, @libsql/client, drizzle-orm.\n";
p_int += "5) Depends on testkit + sql-store; core/webhooks/adapter-postgres/redis/sqlite do NOT depend on adapter-turso.\n";
p_int += "6) Claims prefer single-statement UPSERT and/or write transaction/batch — not unprotected get-then-set.\n";
p_int += "7) Injectable clock for FakeClock conformance.\n";
p_int += "8) StorageAdapterManifest: multi-host, strong claims, honest notes (no untested sync ads).\n";
p_int += "9) migrateTursoAdapter explicit; never auto on import/create.\n";
p_int += "10) Conformance suites pass on at least one binding (prefer libsql file: for CI; remote skip-clean).\n";
p_int += "11) Concurrency tests: concurrent claims, rollback, multi-instance, lease expiry exist.\n";
p_int += "12) Docs: overview, crash-boundaries, drivers, claims, concurrency, migrations, testing, guarantees,\n";
p_int += "    embedded-replicas honesty, drizzle examples, README, CHANGELOG.\n";
p_int += "13) monorepo.md + workspace-boundaries.md updated; root scripts include package.\n";
p_int += "14) Phase 0-14 safety: typecheck, tests core+testkit+webhooks+sql-store+adapter-postgres+redis+sqlite+turso,\n";
p_int += "    build, boundaries, runtime portability green.\n";
p_int += "15) exactOptionalPropertyTypes clean.\n";
p_int += "16) public-api.test freezes exports; root no-driver assertion; no sync export.\n";
p_int += "17) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "18) If Stream A failed, implement the full adapter package yourself — Phase 15 cannot ship without it.\n";
p_int += "19) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap).\n";
p_int += "20) Ensure package builds dist for root + 2 subpaths (serverless, libsql).\n";
p_int += "21) Never advertise untested local-first sync or conflate with adapter-sqlite single-host.\n";
p_int += "22) Auth tokens never appear in errors.\n";
p_int += "23) Drizzle examples must NOT be the claim execution path.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase15",
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
p_ver += "Verify Phase 15 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/store-turso/dist/index.js && test -f packages/core/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence package @paykernel/store-turso exists with three store factories\n";
p_ver += "12) Evidence package.json exports ./serverless ./libsql and NOT ./sync\n";
p_ver += "13) Evidence root entry does not import @tursodatabase/serverless/@libsql/client/drizzle-orm (grep)\n";
p_ver += "14) Evidence claim paths use single-statement UPSERT and/or transactional batch — not get-then-set alone\n";
p_ver += "15) Evidence StorageAdapterManifest multi-host + honest notes (no untested sync)\n";
p_ver += "16) Evidence migrate is explicit; import-no-migrate test exists\n";
p_ver += "17) Evidence conformance tests pass on at least one binding (file: or remote)\n";
p_ver += "18) Evidence concurrency tests (concurrent claims, multi-instance, lease expiry, rollback)\n";
p_ver += "19) Evidence docs: overview, drivers, claims, concurrency, crash-boundaries, migrations, testing, embedded-replicas honesty, drizzle\n";
p_ver += "20) Evidence core/webhooks/adapter-postgres/redis/sqlite package.json have no adapter-turso dep\n";
p_ver += "21) Evidence monorepo scripts include adapter-turso\n";
p_ver += "22) Evidence serverless and libsql bindings exist\n";
p_ver += "23) Evidence no Phase 16 cloudflare adapter packages created\n";
p_ver += "24) Evidence drizzle examples do not claim ORM is the atomic claim path\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- package_ok: package exists with correct name and build\n";
p_ver += "- factories_ok: three createTurso* factories implement contracts\n";
p_ver += "- driver_subpaths_ok: serverless + libsql exported\n";
p_ver += "- root_no_drivers_ok: root has no optional driver static imports\n";
p_ver += "- claim_atomic_ok: UPSERT/txn claims; not unprotected get-set\n";
p_ver += "- manifest_ok: multi-host honest notes; no untested sync ads\n";
p_ver += "- conformance_ok: suites pass on available binding\n";
p_ver += "- concurrency_ok: 15.3 tests present and pass (or skip-clean for remote-only)\n";
p_ver += "- serverless_binding_ok: /serverless binding isolated\n";
p_ver += "- libsql_binding_ok: /libsql binding isolated; file: and/or remote\n";
p_ver += "- no_sync_subpath_ok: no ./sync export; docs do not ship sync as guaranteed\n";
p_ver += "- drizzle_ok: examples or schema present; claims through adapter path\n";
p_ver += "- docs_ok: full docs set + monorepo links\n";
p_ver += "- compat_ok: Phase 0-14 green; boundaries; no illegal deps\n";
p_ver += "Set ok=true only if typecheck, tests (all packages), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase15",
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
    write_scratch_file("phase15-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 15 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 15 — each PASS or BLOCKING:\n";
p_gate += "A1) Turso remote deployments can act as a shared durable inbox and reconciliation store.\n";
p_gate += "    Evidence: package + multi-host manifest; createTurso* factories; migrate; concurrency/conformance;\n";
p_gate += "    durable notes; serverless and/or remote libsql path; crash-boundaries docs.\n";
p_gate += "A2) libSQL compatibility remains available.\n";
p_gate += "    Evidence: /libsql subpath; createLibsqlStores; @libsql/client isolated; file: and/or remote docs.\n";
p_gate += "A3) sync or embedded-replica modes are not advertised beyond tested guarantees.\n";
p_gate += "    Evidence: no ./sync export; docs state embedded replica ≠ local-first sync; manifest honesty.\n\n";
p_gate += "Also require Phase 15 sections 15.1-15.4 deliverables:\n";
p_gate += "- 15.1 Turso serverless binding complete (prefer single-statement claims)\n";
p_gate += "- 15.2 libSQL binding complete (tx/batch; remote + file URLs; replica honesty)\n";
p_gate += "- 15.3 concurrency tests: concurrent claims, rollback, read-after-write, timeout/reconnect, lease expiry, multi-instance\n";
p_gate += "- 15.4 drizzle optional schema/examples; claims via tested adapter path\n";
p_gate += "- Injectable clock for conformance\n";
p_gate += "- Explicit migrate only; never on import\n";
p_gate += "- Phase 0-14 safety net still green; boundaries; no illegal deps\n";
p_gate += "- No Phase 16 packages\n";
p_gate += "- No logical bugs: get/set claim race; root importing drivers; secrets/auth tokens in errors;\n";
p_gate += "  FakeClock ignored; auto-migrate; conflating local sqlite with turso; untested sync advertised;\n";
p_gate += "  treating serverless and libsql as identical without independent bindings.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso\n";
p_gate += "  bun run typecheck; check:boundaries; focused adapter-turso tests.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/store-turso/docs/phase-15-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-15-gate-report.md (full or pointer + verdict summary).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase15-adversarial",
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
    write_scratch_file("phase15-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 15 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 15 only — no Phase 16 adapters, no reconciliation package, no /sync.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete packages/store-turso: factories, subpaths serverless/libsql, atomic claims,\n";
    p_fix += "manifest honesty, concurrency, conformance, drizzle examples, docs, monorepo wiring as needed.\n";
    p_fix += "Preserve Phase 0-14, adapter-postgres, adapter-redis, adapter-sqlite.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase15-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 15 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm all 15.1-15.4 deliverables and acceptance criteria A1-A3 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase15-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase15-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 15 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/store-turso/docs/phase-15-gate-report.md and packages/core/docs/baseline/phase-15-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 15.1-15.4 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase15-final",
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
        write_scratch_file("phase15-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 15 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 15,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
