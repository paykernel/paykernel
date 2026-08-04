let meta = #{
    name: "phase-12-postgres-adapter",
    description: "Phase 12 PostgreSQL Adapter: critic, implement @paykernel/store-postgres (stores, drivers, migrations, conformance, multi-connection tests), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 12 roadmap 12.1-12.4 and acceptance criteria" },
        #{ title: "Implement", detail: "adapter-postgres package: stores, subpaths, migrations, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-11 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 12 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 12" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 12 (PostgreSQL Adapter) for payments-sdk monorepo",
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
        "conformance_ok", "multi_connection_ok", "migration_ok", "manifest_ok",
        "pg_strengths_ok", "docs_ok", "compat_ok",
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
        "driver_subpaths_ok": #{ "type": "boolean" },
        "root_no_drivers_ok": #{ "type": "boolean" },
        "conformance_ok": #{ "type": "boolean" },
        "multi_connection_ok": #{ "type": "boolean" },
        "migration_ok": #{ "type": "boolean" },
        "manifest_ok": #{ "type": "boolean" },
        "pg_strengths_ok": #{ "type": "boolean" },
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
    "/home/shahin/Documents/projects/personal/packages/payments-sdk"
} else {
    args.root
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 12 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 12 critic for the payments-sdk monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 12 — PostgreSQL Adapter\" completely\n";
p_critic += "(Package, Objective, Driver Bindings, Tasks 12.1-12.4, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  11 atomicity by storage engine not get/set; 13 prepared statements only;\n";
p_critic += "  14 no raw payloads by default; 15 portable timestamps/IDs;\n";
p_critic += "  16 every adapter same conformance suite; 17 document crash boundaries;\n";
p_critic += "  19 never auto-migrate on import/prod construction.\n";
p_critic += "Also section 3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings,\n";
p_critic += "3.5 Each Adapter Must Declare Its Guarantees, 5 Proposed Repository Structure (adapter-postgres),\n";
p_critic += "5.1 Package Boundary Rules (adapter root must not import optional drivers; adapters may depend on internal/sql-store).\n";
p_critic += "Phases 0-11 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, store contracts, webhook inbox engine,\n";
p_critic += "and private internal/sql-store relational foundation.\n";
p_critic += "Do NOT start Phase 13+ (adapter-redis, adapter-sqlite, adapter-turso, adapter-cloudflare-d1/do),\n";
p_critic += "Phase 14 reconciliation package, new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-11 domain/foundation packages unless required for monorepo wiring/docs.\n\n";

p_critic += "CONTEXT already present from Phase 9-11:\n";
p_critic += "- packages/testkit — LeaseAware IdempotencyStore / WebhookInboxStore / ReconciliationStore contracts\n";
p_critic += "- packages/testkit — runIdempotencyStoreConformanceSuite / runWebhookInboxStoreConformanceSuite / runReconciliationStoreConformanceSuite\n";
p_critic += "- packages/testkit — StorageAdapterManifest + assertStorageAdapterManifest\n";
p_critic += "- packages/testkit — memory stores (NON-PRODUCTION) + FakeClock for lease tests\n";
p_critic += "- packages/webhooks — inbox engine; dual-owned WebhookInboxStore (structurally compatible)\n";
p_critic += "- internal/sql-store — private foundation: tables, codecs, namespace, migrate/verify, claim templates (postgres dialect),\n";
p_critic += "  pure evaluateClaim / decide*, contention harness\n";
p_critic += "- NO packages/store-postgres yet; monorepo docs still say adapters are future.\n\n";

p_critic += "Audit against EVERY Phase 12 requirement with evidence (grep/read):\n\n";

p_critic += "Package: @paykernel/store-postgres under packages/store-postgres\n\n";

p_critic += "12.1 Implement Store Factories:\n";
p_critic += "- createPostgresIdempotencyStore(...)\n";
p_critic += "- createPostgresWebhookInboxStore(...)\n";
p_critic += "- createPostgresReconciliationStore(...)\n";
p_critic += "Implement full Phase 9 lease-aware contracts (reserve/claim/renew/complete/fail/etc.).\n\n";

p_critic += "12.2 Use PostgreSQL strengths:\n";
p_critic += "- unique constraints; INSERT ... ON CONFLICT; conditional UPDATE ... RETURNING\n";
p_critic += "- TIMESTAMPTZ where appropriate (or foundation TEXT ISO with documented policy)\n";
p_critic += "- transactions; row locking / advisory locks ONLY when necessary\n";
p_critic += "- SKIP LOCKED for batch reconciliation workers when appropriate\n";
p_critic += "- Do NOT use advisory locks as the only durable record of work\n";
p_critic += "- Prefer single conditional write claims from sql-store postgres templates\n";
p_critic += "- FORBIDDEN: get-then-set as claim strategy\n\n";

p_critic += "12.3 Support Bun SQL and Drizzle:\n";
p_critic += "Recommended subpath exports:\n";
p_critic += "  @paykernel/store-postgres/bun-sql\n";
p_critic += "  @paykernel/store-postgres/postgres-js\n";
p_critic += "  @paykernel/store-postgres/pg\n";
p_critic += "  @paykernel/store-postgres/drizzle\n";
p_critic += "A generic narrow executor may be exported only if it preserves transaction and error semantics.\n";
p_critic += "Root entry MUST NOT statically import pg, postgres, bun SQL, drizzle-orm, etc.\n";
p_critic += "Drizzle optional schema exports — do NOT make Drizzle mandatory.\n\n";

p_critic += "12.4 Integration Tests (real PostgreSQL when available):\n";
p_critic += "- many concurrent claims (multi-connection, not just same-isolate)\n";
p_critic += "- transaction rollback\n";
p_critic += "- stale lease rejection\n";
p_critic += "- database restart or connection drop simulations where practical\n";
p_critic += "- migration upgrades\n";
p_critic += "Unit/conformance must still run without live PG via skip-when-unset pattern OR an in-process\n";
p_critic += "mock executor ONLY for pure unit paths — production correctness proof requires real PG when env set.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) safe for multi-process deployments\n";
p_critic += "A2) audit history and retry scheduling are durable\n";
p_critic += "A3) all driver bindings pass the same store conformance suites\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/store-postgres depends on testkit (contracts/conformance) + internal/sql-store (foundation)\n";
p_critic += "- MAY depend on core only if needed for shared types — prefer testkit contracts\n";
p_critic += "- core must NOT depend on adapter-postgres\n";
p_critic += "- webhooks must NOT depend on adapter-postgres\n";
p_critic += "- drivers as optional peerDependencies; isolated subpaths only\n";
p_critic += "- update scripts/check-workspace-boundaries.ts ADAPTER_OPTIONAL_DRIVERS if needed\n";
p_critic += "  (add postgres for postgres.js; consider drizzle-orm)\n";
p_critic += "- do NOT create adapter-redis / adapter-sqlite / adapter-turso / adapter-cloudflare-* (Phase 13+)\n";
p_critic += "- do NOT create packages/reconciliation domain package (Phase 14)\n\n";

p_critic += "Critical design constraints to flag as risks if missing plan:\n";
p_critic += "- Injectable clock for conformance (FakeClock.advance must control lease expiry via bound now params;\n";
p_critic += "  never rely only on SQL NOW() for lease comparisons in testable paths)\n";
p_critic += "- Explicit migrate helper; never auto-migrate on import or factory construction by default\n";
p_critic += "- StorageAdapterManifest: multi-host, durable, strong claims, honest notes + crash boundaries\n";
p_critic += "- Map StoreErrorCode taxonomy (lease_lost, unavailable, etc.)\n";
p_critic += "- Sanitized error fields max size; no secrets/raw payloads\n";
p_critic += "- prepared statements / bound params only; validated table names via sql-store namespace\n";
p_critic += "- exactOptionalPropertyTypes ON\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: root importing drivers; get-then-set claims; auto-migrate; no multi-connection proof;\n";
p_critic += "fake clock ignored; secrets in errors; core→adapter dep; publishing internal sql-store;\n";
p_critic += "making drizzle mandatory; advisory-lock-only durability; Phase 13+ packages.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase12-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase12-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 12 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 12\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 12 PostgreSQL Adapter in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Webhooks = packages/webhooks = @paykernel/webhooks (0.1.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — Phase 9 contracts + conformance + FakeClock.\n";
common += "Sql-store = internal/sql-store = @paykernel/internal-sql-store (private Phase 11 foundation).\n";
common += "PHASE 12 ONLY: create packages/store-postgres = @paykernel/store-postgres.\n";
common += "Do NOT create packages/store-redis / adapter-sqlite / adapter-turso / adapter-cloudflare-d1 / adapter-cloudflare-do.\n";
common += "Do NOT create packages/reconciliation (Phase 14). Do NOT add new PSPs or extract gateways.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside adapter-postgres; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-11 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + conformance + multi-connection + migration).\n";
common += "2) Atomic claims = single conditional write / engine-level; NEVER get-then-set as claim strategy.\n";
common += "3) Never convert uncertain outcomes into failure (not primary here, but respect contracts).\n";
common += "4) Do not hide provider differences — but this is storage, not PSP.\n";
common += "5) No secret leakage in error fields (sanitized, max size from sql-store).\n";
common += "6) No framework coupling in portable root; drivers only on subpaths.\n";
common += "7) Root entry must NOT import optional peer drivers (pg, postgres, bun:sql, drizzle-orm).\n";
common += "8) Keep 0.x compat: core/webhooks/testkit/sql-store public APIs stable; additive only.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) exactOptionalPropertyTypes is ON — no undefined assignment to optional props without care.\n";
common += "11) Core must NOT depend on adapter-postgres. Webhooks must NOT depend on adapter-postgres.\n";
common += "12) Use prepared statements / bound params — never interpolate user values into SQL strings.\n";
common += "13) Table/schema names ONLY via sql-store createSchemaNamespace / resolveTableName.\n";
common += "14) Portable ISO-8601 timestamps and opaque string lease tokens; no JS number for 64-bit IDs.\n";
common += "15) Do not store raw provider payloads/signatures by default.\n";
common += "16) Do not run migrations automatically on package import or default factory construction.\n";
common += "17) Injectable clock: stores MUST accept clock/now for lease comparisons so FakeClock works in conformance.\n";
common += "    Bind `now` into SQL templates; do NOT hard-depend on SQL NOW() for reclaim predicates in test paths.\n";
common += "18) Reuse sql-store postgres claim templates (idempotencyReserveTemplates etc.) — do not invent divergent claim SQL.\n";
common += "19) Publish honest StorageAdapterManifest: multi-host, durable, strong claims, crash boundary notes.\n";
common += "20) Map driver errors into StoreErrorCode taxonomy (StoreLeaseLostError, StoreUnavailableError, etc.).\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: package scaffold + core stores + migrations + executor port
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE SCAFFOLD + STORE FACTORIES + MIGRATIONS + NARROW EXECUTOR (Tasks 12.1, 12.2 partial).\n";
p_a += "OWN primarily: packages/store-postgres/** (NEW package).\n";
p_a += "May touch root package.json scripts/workspaces ONLY if needed — prefer leave monorepo polish to Integrate/Stream C.\n";
p_a += "Do NOT write phase-12-gate-report.md (Gate owns it).\n";
p_a += "Do NOT implement Redis/SQLite/Turso/D1/DO adapters.\n\n";

p_a += "### Create package packages/store-postgres\n";
p_a += "Name: @paykernel/store-postgres\n";
p_a += "version 0.1.0; type module; publishable (NOT private).\n";
p_a += "description: PostgreSQL durable stores for payments-sdk lease-aware idempotency, webhook inbox, reconciliation.\n";
p_a += "dependencies:\n";
p_a += "  @paykernel/testkit: workspace:*  (contracts, conformance, FakeClock types)\n";
p_a += "  @paykernel/internal-sql-store: workspace:*  (schema, codecs, migrate, claim templates)\n";
p_a += "optional peerDependencies (document versions):\n";
p_a += "  pg, postgres (postgres.js), drizzle-orm — as optional peers for subpaths\n";
p_a += "  Bun SQL needs no npm peer (runtime-provided) but isolate behind /bun-sql\n";
p_a += "devDependencies: @types/bun, typescript, @types/pg if used, postgres for tests, etc.\n";
p_a += "scripts: build (bun build multi-entry OR build root + subpaths carefully + build:types), typecheck, test.\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist.\n";
p_a += "LICENSE MIT (copy from sibling packages). README + CHANGELOG.\n";
p_a += "publishConfig access public + provenance true (match testkit).\n";
p_a += "After package.json exists: bun install from monorepo root.\n\n";

p_a += "### Exports map (CRITICAL — root must not pull drivers)\n";
p_a += "```json\n";
p_a += "{\n";
p_a += "  \".\": { \"types\": \"./dist/index.d.ts\", \"import\": \"./dist/index.js\" },\n";
p_a += "  \"./bun-sql\": { \"types\": \"./dist/bun-sql.d.ts\", \"import\": \"./dist/bun-sql.js\" },\n";
p_a += "  \"./postgres-js\": { \"types\": \"./dist/postgres-js.d.ts\", \"import\": \"./dist/postgres-js.js\" },\n";
p_a += "  \"./pg\": { \"types\": \"./dist/pg.d.ts\", \"import\": \"./dist/pg.js\" },\n";
p_a += "  \"./drizzle\": { \"types\": \"./dist/drizzle.d.ts\", \"import\": \"./dist/drizzle.js\" }\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Root exports: store factories that accept a narrow PostgresExecutor / client port,\n";
p_a += "manifest, migrate helpers, types — ZERO static imports of pg/postgres/drizzle/bun SQL.\n";
p_a += "Subpaths: thin bindings that adapt driver clients to the narrow executor and re-export factories.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/store-postgres/src/\n";
p_a += "  index.ts                    # curated public root exports\n";
p_a += "  manifest.ts                 # POSTGRES_STORAGE_ADAPTER_MANIFEST + getter\n";
p_a += "  types.ts                    # PostgresStoreOptions, clock, namespace, executor port\n";
p_a += "  executor.ts                 # narrow PostgresExecutor interface (query/execute/transaction)\n";
p_a += "  errors.ts                   # map driver errors → StoreErrorCode / StoreLeaseLostError / etc.\n";
p_a += "  clock.ts                    # Clock interface compatible with testkit FakeClock (nowMs)\n";
p_a += "  migrate.ts                  # explicit migratePostgres / verifyPostgresSchema wrappers\n";
p_a += "  stores/\n";
p_a += "    idempotency-store.ts      # createPostgresIdempotencyStore\n";
p_a += "    webhook-inbox-store.ts    # createPostgresWebhookInboxStore\n";
p_a += "    reconciliation-store.ts   # createPostgresReconciliationStore\n";
p_a += "    shared.ts                 # row mapping, lease helpers, bind params\n";
p_a += "  drivers/\n";
p_a += "    bun-sql.ts                # createPostgresStoresFromBunSql / executor adapter\n";
p_a += "    postgres-js.ts            # postgres.js binding\n";
p_a += "    pg.ts                     # node-postgres Pool/Client binding\n";
p_a += "    drizzle.ts                # optional schema export + notes; optional executor if practical\n";
p_a += "  bun-sql.ts                  # package subpath entry re-export drivers/bun-sql\n";
p_a += "  postgres-js.ts\n";
p_a += "  pg.ts\n";
p_a += "  drizzle.ts\n";
p_a += "  public-api.test.ts\n";
p_a += "  stores/*.test.ts            # unit tests with fake executor where possible\n";
p_a += "  conformance.postgres.test.ts  # runs testkit suites when PAYMENTS_SDK_PG_URL or DATABASE_URL set\n";
p_a += "  multi-connection.test.ts      # concurrent claims across connections (skip if no PG)\n";
p_a += "  migrate.integration.test.ts\n\n";

p_a += "### Narrow PostgresExecutor (generic port)\n";
p_a += "Must preserve transaction + error semantics. Example shape:\n";
p_a += "```ts\n";
p_a += "type PostgresExecutor = {\n";
p_a += "  // bound params only; never interpolate user values\n";
p_a += "  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;\n";
p_a += "  execute(sql: string, params?: readonly unknown[]): Promise<{ rowCount: number }>;\n";
p_a += "  // optional: begin work unit; nested not required\n";
p_a += "  withTransaction?<T>(fn: (tx: PostgresExecutor) => Promise<T>): Promise<T>;\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Also provide adapter to sql-store SqlExecutor for migrate/verifySchema.\n\n";

p_a += "### 12.1 Store factories — implement FULL Phase 9 contracts\n";
p_a += "Read packages/testkit/src/storage/contracts.ts completely and implement every method:\n";
p_a += "IdempotencyStore: reserve, renew, complete, markIndeterminate, get, deleteExpired, withTransaction?\n";
p_a += "WebhookInboxStore: claim, renew, complete, fail, get, listRetryable, deleteExpired, withTransaction?\n";
p_a += "ReconciliationStore: schedule, claim, renew, complete, fail, markManualReview, get, listDue, deleteExpired, withTransaction?\n";
p_a += "Use sql-store codecs (idempotencyRowToRecord etc.) and validation (enforceMaxSanitizedError).\n";
p_a += "Use sql-store postgres claim templates for atomic reserve/claim.\n";
p_a += "Implement complete/fail/renew/indeterminate/manual-review with conditional UPDATE WHERE lease_token = $n\n";
p_a += "  (and generation checks if templates provide them); throw StoreLeaseLostError on 0 rows.\n";
p_a += "Generate unguessable lease tokens (crypto random / portable).\n";
p_a += "generation MUST increment on successful reserve/claim/renew that issues a new lease.\n";
p_a += "indeterminate rows: reserve returns kind indeterminate; deleteExpired must NOT remove them by default.\n";
p_a += "Options: { executor, clock?, namespace?: SchemaNamespaceConfig, leaseMsDefault?, ... }\n";
p_a += "validate namespace via createSchemaNamespace — NEVER interpolate unvalidated names.\n\n";

p_a += "### 12.2 PostgreSQL strengths\n";
p_a += "- Prefer sql-store postgres templates: INSERT ON CONFLICT DO UPDATE ... WHERE ... RETURNING\n";
p_a += "- Unique PK on key; CHECK constraints from foundation migration\n";
p_a += "- listDue / batch claim may use FOR UPDATE SKIP LOCKED inside a transaction for multi-worker fairness\n";
p_a += "  Document: SKIP LOCKED is for batch claim efficiency; durable work record is the row itself, not advisory locks\n";
p_a += "- Do NOT use advisory locks as the only durable record of work\n";
p_a += "- Timestamps: foundation uses TEXT ISO-8601 (compatible with FakeClock + lexical compare).\n";
p_a += "  Acceptable for Phase 12. If you use TIMESTAMPTZ, bind injectable now as timestamptz and document casting.\n";
p_a += "  Document policy in adapter docs either way.\n";
p_a += "- withTransaction on stores should use executor.withTransaction when present.\n\n";

p_a += "### Migrations\n";
p_a += "Export explicit helpers wrapping sql-store migrate/verifySchema with dialect: 'postgres':\n";
p_a += "  migratePostgresAdapter(executor, options?)\n";
p_a += "  verifyPostgresAdapterSchema(executor, options?)\n";
p_a += "NEVER call migrate at import time or inside createPostgres*Store by default.\n";
p_a += "Optional opt-in flag applySchemaOnCreate ONLY if named clearly NON-DEFAULT and documented for tests;\n";
p_a += "  prefer test helpers that call migrate explicitly.\n";
p_a += "Tests: migrate applies v1; second migrate no-op; verify fails if table missing; import does not migrate.\n\n";

p_a += "### Manifest\n";
p_a += "```ts\n";
p_a += "{\n";
p_a += "  name: \"postgres\",\n";
p_a += "  contracts: { idempotency: true, webhookInbox: true, reconciliation: true },\n";
p_a += "  consistency: { claims: \"strong\", readAfterWrite: \"strong\", staleReadsPossible: false },\n";
p_a += "  coordinationScope: \"multi-host\",  // when using shared PG cluster\n";
p_a += "  durability: \"durable\",\n";
p_a += "  supportsTransactions: true,\n";
p_a += "  supportsLeases: true,\n";
p_a += "  supportsRetentionCleanup: true,\n";
p_a += "  notes: [ crash boundaries, multi-process safety, migrate explicit, no auto-migrate, ... ]\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Validate with assertStorageAdapterManifest from testkit.\n\n";

p_a += "### Public exports (root) — freeze in public-api.test.ts\n";
p_a += "createPostgresIdempotencyStore, createPostgresWebhookInboxStore, createPostgresReconciliationStore,\n";
p_a += "createPostgresStores (optional convenience bundle),\n";
p_a += "migratePostgresAdapter, verifyPostgresAdapterSchema,\n";
p_a += "POSTGRES_STORAGE_ADAPTER_MANIFEST / getPostgresStorageAdapterManifest,\n";
p_a += "types for options/executor.\n";
p_a += "Do NOT export a general SQL query builder.\n";
p_a += "Assert root source has no import of 'pg' | 'postgres' | 'drizzle-orm' | bun sql modules.\n\n";

p_a += "### Stream A tests\n";
p_a += "- public-api freeze + root no drivers\n";
p_a += "- namespace validation rejection (via factory)\n";
p_a += "- fake executor unit tests for error mapping / token-required paths if practical\n";
p_a += "- migrate + no auto-migrate on import\n";
p_a += "- manifest assert\n";
p_a += "Run package typecheck/tests after wiring.\n";

let a_result = agent(p_a, #{
    label: "impl:12-stores-core",
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

// Parallel: B drivers+conformance+multi-conn, C docs+monorepo
log("Implementing Phase 12 drivers/tests and docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — DRIVER BINDINGS + CONFORMANCE + MULTI-CONNECTION + INTEGRATION TESTS (Tasks 12.2 remaining, 12.3, 12.4).\n";
p_b += "OWN: packages/store-postgres/src/drivers/**, subpath entries, integration/conformance tests,\n";
p_b += "boundaries checker updates for optional drivers if needed.\n";
p_b += "May extend Stream A store files if missing complete/fail SQL or bugs.\n";
p_b += "Do NOT write gate report. Do NOT create Phase 13+ adapters.\n\n";

p_b += "### 12.3 Driver bindings (subpaths)\n";
p_b += "1) /bun-sql — adapt Bun SQL (Bun.sql / SQL client) to PostgresExecutor.\n";
p_b += "   Isolate ALL Bun SQL imports behind this entry only.\n";
p_b += "   Export helpers e.g. createBunSqlPostgresExecutor(sql), createPostgresStoresFromBunSql(...).\n";
p_b += "2) /postgres-js — adapt `postgres` package (postgres.js) to PostgresExecutor.\n";
p_b += "3) /pg — adapt `pg` Pool or Client to PostgresExecutor (parameterized queries).\n";
p_b += "4) /drizzle — optional Drizzle schema table definitions aligning with canonical columns\n";
p_b += "   (or re-export notes + example schema). Do NOT make drizzle-orm a hard dependency of root.\n";
p_b += "   Document that Drizzle is optional; apps may use raw SQL stores without it.\n";
p_b += "   Prefer peerDependencyOptional; subpath may import drizzle-orm only when used.\n\n";

p_b += "Update scripts/check-workspace-boundaries.ts ADAPTER_OPTIONAL_DRIVERS to include:\n";
p_b += "  \"postgres\" (postgres.js), and \"drizzle-orm\" if not already present.\n";
p_b += "  Keep existing: pg, ioredis, better-sqlite3, bun:sqlite, node:sqlite, mysql2, sqlite3, @libsql/client, ...\n";
p_b += "Update scripts/check-workspace-boundaries.test.ts if needed for new drivers.\n";
p_b += "Ensure adapter root fails boundary check if it imports these drivers.\n\n";

p_b += "### 12.4 Tests — conformance + integration\n";
p_b += "Env: PAYMENTS_SDK_PG_URL or DATABASE_URL (document both; prefer PAYMENTS_SDK_PG_URL).\n";
p_b += "When unset: integration/conformance tests SKIP cleanly (ok:true skipped) so CI without PG still green.\n";
p_b += "When set: MUST run and PASS:\n";
p_b += "1) runIdempotencyStoreConformanceSuite with createStore using real PG + injectable FakeClock\n";
p_b += "2) runWebhookInboxStoreConformanceSuite same\n";
p_b += "3) runReconciliationStoreConformanceSuite same\n";
p_b += "4) Multi-connection concurrent reserve/claim on same key → exactly one acquired\n";
p_b += "5) Stale lease token complete/fail rejected (StoreLeaseLostError)\n";
p_b += "6) Transaction rollback: start tx, write, throw/rollback, assert no durable partial claim\n";
p_b += "7) Migration upgrade: empty DB → migrate → verifySchema ok; migrate again idempotent\n";
p_b += "8) Connection drop / unavailable error mapping to StoreUnavailableError where practical\n";
p_b += "Use unique schema or table prefix per test run to avoid collisions (namespace tablePrefix or sqlSchema).\n";
p_b += "Prefer one driver binding for live tests (postgres-js OR pg OR bun-sql) but ensure each binding has\n";
p_b += "at least a unit/smoke that constructs an executor without connecting if possible;\n";
p_b += "live tests may focus on one primary binding + assert other bindings export factories.\n";
p_b += "A3 acceptance: all driver bindings pass same store conformance — implement shared suite runner\n";
p_b += "invoked per binding when PG available, OR structure so primary binding proves stores and each\n";
p_b += "binding proves executor parity (same SQL/params). Prefer running conformance once against stores\n";
p_b += "built via each available binding when env set.\n\n";

p_b += "### Concurrent multi-connection proof (A1 multi-process)\n";
p_b += "Open ≥2 connections/pools; N parallel reserve/claim same key; assert exactly one acquired.\n";
p_b += "Document this as multi-process safety evidence (engine-level ON CONFLICT, not process mutex).\n\n";

p_b += "### docker-compose / CI notes (docs can land in Stream C, but tests must document env)\n";
p_b += "Provide packages/store-postgres/docker-compose.yml optional postgres:16 service for local/CI.\n";
p_b += "Or document connection string in README.\n\n";

p_b += "### After implementation\n";
p_b += "bun install; typecheck package; bun test packages/store-postgres\n";
p_b += "If PG available locally, export PAYMENTS_SDK_PG_URL and run integration tests.\n";
p_b += "If not available, ensure skips do not fail the suite.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCS + MONOREPO WIRING for Phase 12.\n";
p_c += "OWN: packages/store-postgres/README.md, packages/store-postgres/docs/**,\n";
p_c += "packages/store-postgres/CHANGELOG.md Unreleased Phase 12,\n";
p_c += "docs/monorepo.md (layout: packages/store-postgres present),\n";
p_c += "docs/workspace-boundaries.md (adapter-postgres rules, may depend on sql-store + testkit),\n";
p_c += "docs/releases.md note if adapters publish separately,\n";
p_c += "root package.json scripts: include adapter-postgres in build/typecheck/test filters,\n";
p_c += "packages/testkit/docs/store-contracts.md short pointer that Phase 12 postgres adapter exists,\n";
p_c += "internal/sql-store/docs/relational-foundation.md update \"Phase 12+\" consumers now include adapter-postgres,\n";
p_c += "root README if it lists packages.\n";
p_c += "Do NOT write phase-12-gate-report.md (Gate owns it).\n\n";

p_c += "### Docs that MUST exist under packages/store-postgres/docs/\n";
p_c += "1) overview.md or README covers: purpose, multi-process durability, explicit migrate, driver subpaths\n";
p_c += "2) crash-boundaries.md — what happens if process crashes before/after side effect and before complete persistence\n";
p_c += "3) drivers.md — bun-sql / postgres-js / pg / drizzle usage examples; root has no drivers\n";
p_c += "4) migrations.md — migratePostgresAdapter / verify; never auto on import\n";
p_c += "5) testing.md — PAYMENTS_SDK_PG_URL, docker-compose, conformance + multi-connection\n";
p_c += "6) guarantees / manifest notes — multi-host, durable, strong claims; advisory locks not sole durability\n\n";

p_c += "### monorepo wiring (required)\n";
p_c += "Root workspaces already packages/* so adapter-postgres is auto-discovered.\n";
p_c += "Update scripts:\n";
p_c += "  build: ... && bun run --filter @paykernel/store-postgres build\n";
p_c += "    (order: core → webhooks → testkit → sql-store → adapter-postgres)\n";
p_c += "  typecheck: include adapter-postgres filter\n";
p_c += "  test: include packages/store-postgres path\n";
p_c += "  lint already covers packages/*/src\n";
p_c += "Run bun install after package creation.\n";
p_c += "Run bun run check:boundaries — must pass.\n\n";

p_c += "### Boundaries docs\n";
p_c += "State: adapter-postgres may depend on testkit contracts + internal/sql-store.\n";
p_c += "core/webhooks must not depend on it. Root entry must not import optional drivers.\n";
p_c += "Drivers on optional peers + isolated subpaths only.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:12-drivers-tests", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:12-docs-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 12 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 13+ adapters or reconciliation package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/store-postgres exists as @paykernel/store-postgres (publishable).\n";
p_int += "2) createPostgresIdempotencyStore / createPostgresWebhookInboxStore / createPostgresReconciliationStore exist and implement full Phase 9 contracts.\n";
p_int += "3) Subpath exports: /bun-sql, /postgres-js, /pg, /drizzle present in package.json exports.\n";
p_int += "4) Root entry has ZERO static imports of optional drivers (pg, postgres, drizzle-orm, bun sql).\n";
p_int += "5) Depends on testkit + internal/sql-store; core/webhooks do NOT depend on adapter-postgres.\n";
p_int += "6) Explicit migratePostgresAdapter + verify; NO auto-migrate on import/default construction.\n";
p_int += "7) Atomic claims use conditional INSERT ON CONFLICT / UPDATE RETURNING (sql-store templates); not get-then-set.\n";
p_int += "8) Injectable clock for FakeClock conformance.\n";
p_int += "9) StorageAdapterManifest: multi-host, durable, strong claims, validated.\n";
p_int += "10) Conformance suites wired (skip without PG; pass with PG).\n";
p_int += "11) Multi-connection concurrent claim tests exist.\n";
p_int += "12) SKIP LOCKED only for batch efficiency if used; not sole durability; no advisory-lock-only work records.\n";
p_int += "13) Docs: README, crash-boundaries, drivers, migrations, testing, CHANGELOG.\n";
p_int += "14) monorepo.md + workspace-boundaries.md updated; root scripts include package.\n";
p_int += "15) boundaries checker includes postgres/drizzle-orm in adapter optional drivers if needed.\n";
p_int += "16) Phase 0-11 safety: typecheck, tests core+testkit+webhooks+sql-store+adapter-postgres, build, boundaries, runtime portability green.\n";
p_int += "17) exactOptionalPropertyTypes clean.\n";
p_int += "18) public-api.test freezes exports; root no-driver assertion.\n";
p_int += "19) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "20) If Stream A failed, implement the full adapter package yourself — Phase 12 cannot ship without it.\n";
p_int += "21) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap).\n";
p_int += "22) If live PG is available (check env or start docker), run integration suite and fix failures.\n";
p_int += "    If not available, ensure skip path is correct and document how CI enables it.\n";
p_int += "23) Ensure package builds dist for root + subpaths.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase12",
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
p_ver += "Verify Phase 12 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/store-postgres/dist/index.js && test -f packages/core/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence package @paykernel/store-postgres exists with three store factories\n";
p_ver += "12) Evidence package.json exports ./bun-sql ./postgres-js ./pg ./drizzle\n";
p_ver += "13) Evidence root entry does not import pg/postgres/drizzle-orm (grep)\n";
p_ver += "14) Evidence sql-store postgres templates or ON CONFLICT used for claims\n";
p_ver += "15) Evidence migrate helpers + no auto-migrate on import\n";
p_ver += "16) Evidence StorageAdapterManifest multi-host durable strong\n";
p_ver += "17) Evidence conformance tests exist (skip or pass with PG)\n";
p_ver += "18) Evidence multi-connection concurrent claim tests exist\n";
p_ver += "19) Evidence docs crash-boundaries drivers migrations testing\n";
p_ver += "20) Evidence core/webhooks package.json have no adapter-postgres dep\n";
p_ver += "21) Evidence monorepo scripts include adapter-postgres\n";
p_ver += "22) Evidence no Phase 13 adapter packages created\n";
p_ver += "23) If PAYMENTS_SDK_PG_URL or DATABASE_URL is set, integration tests must pass not skip\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- package_ok: package exists with correct name and build\n";
p_ver += "- factories_ok: three createPostgres* factories implement contracts\n";
p_ver += "- driver_subpaths_ok: four recommended subpaths exported\n";
p_ver += "- root_no_drivers_ok: root has no optional driver static imports\n";
p_ver += "- conformance_ok: suites wired and pass (or skip without PG, pass with PG)\n";
p_ver += "- multi_connection_ok: multi-connection concurrent claim evidence\n";
p_ver += "- migration_ok: explicit migrate/verify; no auto on import\n";
p_ver += "- manifest_ok: honest multi-host durable strong claims manifest\n";
p_ver += "- pg_strengths_ok: ON CONFLICT / RETURNING / transactions; no advisory-lock-only durability\n";
p_ver += "- docs_ok: README + crash + drivers + migrations + testing + monorepo links\n";
p_ver += "- compat_ok: Phase 0-11 green; boundaries; no illegal deps\n";
p_ver += "Set ok=true only if typecheck, tests (all packages), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase12",
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
    write_scratch_file("phase12-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 12 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 12 — each PASS or BLOCKING:\n";
p_gate += "A1) safe for multi-process deployments.\n";
p_gate += "    Evidence: multi-host manifest; engine-level ON CONFLICT claims; multi-connection concurrent tests;\n";
p_gate += "    not process-local mutex; docs crash boundaries for multi-process.\n";
p_gate += "A2) audit history and retry scheduling are durable.\n";
p_gate += "    Evidence: rows in PostgreSQL tables; listRetryable/listDue/fail retry; durability: durable in manifest;\n";
p_gate += "    not advisory-lock-only; no ephemeral-only store.\n";
p_gate += "A3) all driver bindings pass the same store conformance suites.\n";
p_gate += "    Evidence: /bun-sql /postgres-js /pg (/drizzle optional schema) exist;\n";
p_gate += "    shared store implementation + per-binding executor adapters;\n";
p_gate += "    conformance suite runners for bindings when PG available; same contracts.\n\n";
p_gate += "Also require Phase 12 sections 12.1-12.4 deliverables:\n";
p_gate += "- 12.1 three store factories implementing full Phase 9 contracts\n";
p_gate += "- 12.2 PG strengths: unique constraints, ON CONFLICT, RETURNING, transactions; SKIP LOCKED if used correctly;\n";
p_gate += "      no advisory locks as only durable work record\n";
p_gate += "- 12.3 Bun SQL + optional Drizzle; subpaths; root no drivers; drizzle not mandatory\n";
p_gate += "- 12.4 integration tests: concurrent claims, rollback, stale lease, migrations, connection issues where practical\n";
p_gate += "- Uses internal/sql-store foundation (templates/migrate/namespace)\n";
p_gate += "- Explicit migrations; never auto on import\n";
p_gate += "- Injectable clock for conformance\n";
p_gate += "- Prepared statements; validated identifiers\n";
p_gate += "- Phase 0-11 safety net still green; boundaries; no core/webhooks → adapter-postgres\n";
p_gate += "- No Phase 13 packages/store-redis etc.\n";
p_gate += "- No logical bugs: auto-migrate; get/set claim race; SQL injection via table names;\n";
p_gate += "  secrets unbounded in errors; JS number 64-bit IDs; root importing drivers;\n";
p_gate += "  FakeClock ignored (lease tests would be flaky or wrong); drizzle mandatory.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres;\n";
p_gate += "bun run typecheck; check:boundaries; focused adapter-postgres tests.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/store-postgres/docs/phase-12-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-12-gate-report.md (full or pointer + verdict summary).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase12-adversarial",
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
    write_scratch_file("phase12-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 12 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 12 only — no Phase 13 adapters, no reconciliation package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete packages/store-postgres: factories, subpaths, migrations, atomic claims,\n";
    p_fix += "conformance, multi-connection tests, docs, monorepo wiring as needed.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase12-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 12 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm all 12.1-12.4 deliverables and acceptance criteria A1-A3 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase12-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase12-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 12 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/store-postgres/docs/phase-12-gate-report.md and packages/core/docs/baseline/phase-12-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 12.1-12.4 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase12-final",
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
        write_scratch_file("phase12-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 12 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 12,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
