let meta = #{
    name: "phase-11-relational-foundation",
    description: "Phase 11 Relational Adapter Foundation: critic, implement private internal/sql-store (schemas, codecs, namespace config, migrations, atomic claim algorithms), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 11 roadmap 11.1-11.5 and acceptance criteria" },
        #{ title: "Implement", detail: "private sql-store package: schema, codecs, namespace, migrations, atomic claims, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-10 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 11 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 11" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 11 (Relational Adapter Foundation) for payments-sdk monorepo",
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
        "private_sql_layer_ok", "canonical_schema_ok", "namespace_config_ok",
        "migration_policy_ok", "atomic_claim_ok", "contention_ok",
        "docs_ok", "compat_ok", "no_public_sql_abstraction_ok",
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
        "private_sql_layer_ok": #{ "type": "boolean" },
        "canonical_schema_ok": #{ "type": "boolean" },
        "namespace_config_ok": #{ "type": "boolean" },
        "migration_policy_ok": #{ "type": "boolean" },
        "atomic_claim_ok": #{ "type": "boolean" },
        "contention_ok": #{ "type": "boolean" },
        "docs_ok": #{ "type": "boolean" },
        "compat_ok": #{ "type": "boolean" },
        "no_public_sql_abstraction_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 11 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 11 critic for the payments-sdk monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 11 — Relational Adapter Foundation\" completely\n";
p_critic += "(Objective, 11.1 Private Shared SQL Layer, 11.2 Canonical Schema,\n";
p_critic += "11.3 Schema Namespace Configuration, 11.4 Migration Policy,\n";
p_critic += "11.5 Atomic Claim Algorithm, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  11 atomicity by storage engine not get/set; 12 no await inside sync SQLite tx;\n";
p_critic += "  13 prepared statements only; 14 no raw payloads by default;\n";
p_critic += "  15 portable timestamps/IDs; 16 every adapter same conformance suite;\n";
p_critic += "  17 document crash boundaries; 19 never auto-migrate on import/prod construction.\n";
p_critic += "Also section 3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings,\n";
p_critic += "3.5 Each Adapter Must Declare Its Guarantees, 5 Proposed Repository Structure (internal/sql-store),\n";
p_critic += "5.1 Package Boundary Rules (private internal/* must not be published).\n";
p_critic += "Phases 0-10 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, store contracts, webhook inbox engine.\n";
p_critic += "Do NOT start Phase 12+ production adapter packages (adapter-postgres, adapter-sqlite, adapter-redis,\n";
p_critic += "adapter-turso, adapter-cloudflare-d1, adapter-cloudflare-do),\n";
p_critic += "Phase 14 reconciliation package, new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-10 domain packages unless required for wiring (e.g. monorepo docs).\n\n";

p_critic += "CONTEXT already present from Phase 9-10:\n";
p_critic += "- packages/testkit/src/storage/contracts.ts — lease-aware IdempotencyStore / WebhookInboxStore / ReconciliationStore\n";
p_critic += "- packages/testkit/src/memory/memory-stores.ts — NON-PRODUCTION memory reference\n";
p_critic += "- packages/testkit/src/storage/*-conformance.ts — adapter conformance suites\n";
p_critic += "- packages/testkit/src/storage/adapter-manifest.ts — StorageAdapterManifest\n";
p_critic += "- packages/webhooks — inbox engine consuming WebhookInboxStore\n";
p_critic += "- NO internal/ directory yet; NO internal/sql-store; NO production SQL adapters.\n";
p_critic += "- Root workspaces: packages/* only (must extend for internal/*).\n\n";

p_critic += "Audit against EVERY Phase 11 requirement with evidence (grep/read):\n\n";

p_critic += "11.1 Private Shared SQL Layer — private workspace containing:\n";
p_critic += "- canonical table and column definitions\n";
p_critic += "- normalized row codecs\n";
p_critic += "- query templates where syntax is portable\n";
p_critic += "- schema version constants\n";
p_critic += "- migration test fixtures\n";
p_critic += "- shared record validation\n";
p_critic += "MUST NOT publish a general SQL abstraction as public API (private: true package).\n\n";

p_critic += "11.2 Canonical Schema — logical tables:\n";
p_critic += "payment_idempotency, payment_webhook_inbox, payment_reconciliation_jobs, payment_storage_migrations\n";
p_critic += "Common requirements: unique PKs; state check constraints where supported;\n";
p_critic += "indexes for due retries and expired leases; payload hashes as text/binary consistently;\n";
p_critic += "timestamps ISO 8601 text or DB-native per adapter policy; sanitized error fields with strict max size;\n";
p_critic += "optional tenant/namespace key.\n\n";

p_critic += "11.3 Schema Namespace Configuration — validated config for:\n";
p_critic += "table prefix; SQL schema (PostgreSQL); tenant namespace column.\n";
p_critic += "NEVER interpolate an unvalidated arbitrary table name.\n\n";

p_critic += "11.4 Migration Policy — each relational adapter foundation must export:\n";
p_critic += "raw migration files; migration metadata; explicit migrate() helper (dev/user-invoked);\n";
p_critic += "schema verification helper. Do NOT run migrations automatically on package import or production construction.\n\n";

p_critic += "11.5 Atomic Claim Algorithm — prefer single conditional write that:\n";
p_critic += "inserts when absent; reclaims only expired/retryable; increments generation/attempt safely;\n";
p_critic += "returns resulting lease token and state.\n";
p_critic += "Each dialect must prove equivalent behavior through conformance/contention tests.\n";
p_critic += "FORBIDDEN: get-then-set as the claim strategy.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) relational adapters share behavior and schema intent without unsafe driver abstraction\n";
p_critic += "A2) migrations are explicit and versioned\n";
p_critic += "A3) atomic claims are validated under contention\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- internal/sql-store = private workspace (@paykernel/internal-sql-store or similar)\n";
p_critic += "- private: true; must NOT be published; must NOT be in public npm surface\n";
p_critic += "- may depend on testkit contracts for type alignment / conformance harness hooks\n";
p_critic += "- core must NOT depend on internal/sql-store\n";
p_critic += "- webhooks must NOT depend on internal/sql-store\n";
p_critic += "- do NOT create packages/store-postgres etc. (Phase 12+)\n";
p_critic += "- do NOT pretend all SQL engines are identical — dialect-specific SQL where needed\n\n";

p_critic += "Also check monorepo wiring gaps: root workspaces only packages/*;\n";
p_critic += "docs/monorepo.md, workspace-boundaries.md mention internal as future;\n";
p_critic += "no sql-store docs/gate report.\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: publishing SQL abstraction; auto-migrate on import; get-then-set claims;\n";
p_critic += "interpolating unvalidated table names; await in sync SQLite tx; core depending on sql-store;\n";
p_critic += "Phase 12 adapters; secrets in error columns; non-portable 64-bit IDs as JS numbers;\n";
p_critic += "pretending postgres === sqlite syntax.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase11-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase11-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 11 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 11\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 11 Relational Adapter Foundation in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Webhooks = packages/webhooks = @paykernel/webhooks (0.1.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — Phase 9 store contracts + memory + conformance.\n";
common += "PHASE 11 ONLY: create private internal/sql-store relational foundation.\n";
common += "Do NOT create packages/store-postgres / adapter-sqlite / adapter-redis / adapter-d1 / adapter-turso / adapter-do (Phase 12+).\n";
common += "Do NOT create packages/reconciliation (Phase 14). Do NOT add new PSPs or extract gateways.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside internal/sql-store; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-10 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + namespace validation + migration + claim contention).\n";
common += "2) Atomic claims = single conditional write / engine-level; NEVER get-then-set as claim strategy.\n";
common += "3) Never convert uncertain outcomes into failure.\n";
common += "4) Do not pretend all SQL dialects are identical — share intent, dialectize syntax.\n";
common += "5) No secret leakage in error fields (sanitized, max size).\n";
common += "6) No framework coupling.\n";
common += "7) Private package may use bun:sqlite ONLY in isolated reference/test subpath or test files —\n";
common += "   production portable shared helpers must remain dialect-agnostic pure TS where possible.\n";
common += "8) Keep 0.x compat: core/webhooks/testkit public APIs stable; additive only.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) exactOptionalPropertyTypes is ON — no undefined assignment to optional props without care.\n";
common += "11) Core must NOT depend on internal/sql-store or testkit/webhooks.\n";
common += "12) Webhooks must NOT depend on internal/sql-store.\n";
common += "13) Use prepared statements / bound params — never interpolate user values into SQL strings.\n";
common += "14) No await inside synchronous SQLite transaction callbacks (if using bun:sqlite reference).\n";
common += "15) Portable ISO-8601 timestamps and opaque string lease tokens; no JS number for 64-bit IDs.\n";
common += "16) Do not store raw provider payloads/signatures by default.\n";
common += "17) Do not run migrations automatically on package import or production construction.\n";
common += "18) Never interpolate unvalidated arbitrary table names — validate namespace/prefix/schema first.\n";
common += "19) Package must be private: true and not published.\n";
common += "20) Do not publish a general public SQL abstraction API.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: Package scaffold + schema + codecs + namespace + migrations
let p_a = "";
p_a += common;
p_a += "STREAM A — PRIVATE SQL LAYER + CANONICAL SCHEMA + NAMESPACE + MIGRATIONS (Tasks 11.1, 11.2, 11.3, 11.4).\n";
p_a += "OWN primarily: internal/sql-store/** (NEW private package).\n";
p_a += "May touch root package.json workspaces ONLY if needed for package discovery — prefer leave monorepo polish to Integrate.\n";
p_a += "Do NOT write phase-11-gate-report.md (Gate owns it).\n\n";

p_a += "### Create package internal/sql-store\n";
p_a += "Name: @paykernel/internal-sql-store\n";
p_a += "CRITICAL: \"private\": true — MUST NOT publish. No publishConfig access public.\n";
p_a += "type module; exports \".\" for foundation helpers only (NOT a public npm product).\n";
p_a += "version 0.1.0; description: private shared relational schemas, codecs, migrations, claim algorithms.\n";
p_a += "Optional dependency: @paykernel/testkit workspace:* for contract type alignment and reusing conformance patterns.\n";
p_a += "OR keep zero workspace deps and define pure schema/codec types that map to Phase 9 contracts by field names — either OK if documented.\n";
p_a += "Prefer depending on testkit for LeaseAware contracts type import ONLY if it simplifies row codecs; avoid coupling to memory stores.\n";
p_a += "devDependencies: @types/bun, typescript (mirror testkit).\n";
p_a += "scripts: build (bun build + build:types OR tsc), typecheck, test.\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist, exclude tests from emit.\n";
p_a += "After package.json exists: ensure root workspaces include \"internal/*\" and run bun install from monorepo root.\n";
p_a += "Root package.json currently has workspaces: [\"packages/*\"] — MUST add \"internal/*\".\n\n";

p_a += "### Recommended source layout\n";
p_a += "internal/sql-store/src/\n";
p_a += "  index.ts                      # public (private-package) exports — curated, not a dump\n";
p_a += "  schema/\n";
p_a += "    versions.ts                 # SCHEMA_VERSION / migration version constants\n";
p_a += "    tables.ts                   # canonical table + column definitions (logical)\n";
p_a += "    namespace.ts                # validated SchemaNamespaceConfig\n";
p_a += "    namespace.test.ts\n";
p_a += "  codecs/\n";
p_a += "    rows.ts                     # normalized row <-> record codecs\n";
p_a += "    validation.ts               # shared record validation + error field max size\n";
p_a += "    validation.test.ts\n";
p_a += "  migrations/\n";
p_a += "    metadata.ts                 # migration list, versions, checksums\n";
p_a += "    definitions.ts              # raw SQL migration bodies (portable + dialect variants)\n";
p_a += "    migrate.ts                  # explicit migrate(executor, options) — NEVER auto-run on import\n";
p_a += "    verify.ts                   # verifySchema(executor) helper\n";
p_a += "    migrate.test.ts\n";
p_a += "  claims/\n";
p_a += "    algorithm.ts                # pure claim decision + generation/attempt rules\n";
p_a += "    templates.ts                # portable intent + dialect SQL templates with placeholders\n";
p_a += "    dialect.ts                  # DialectId: 'postgres' | 'sqlite' | 'generic'\n";
p_a += "    algorithm.test.ts\n";
p_a += "  reference/\n";
p_a += "    memory-relational-store.ts  # in-process reference applying claim algorithm under mutex\n";
p_a += "    # OR bun-sqlite-reference.ts isolated for real contention tests (optional but valuable)\n";
p_a += "  fixtures/\n";
p_a += "    migration-fixtures.ts       # migration test fixtures\n";
p_a += "  public-api.test.ts            # freeze exports; assert private package shape\n";
p_a += "  claim-contention.test.ts      # concurrent claim tests (A3)\n\n";

p_a += "### 11.2 Canonical tables (logical names before prefix)\n";
p_a += "payment_idempotency — maps to LeaseAwareIdempotencyStore records:\n";
p_a += "  key (PK), status, fingerprint?, result_json?, lease_owner, lease_token, lease_expires_at,\n";
p_a += "  attempts, generation, created_at, updated_at, tenant_id? (optional),\n";
p_a += "  completed_at?, indeterminate_at?, error_sanitized? (max length enforced)\n";
p_a += "payment_webhook_inbox — maps to WebhookInboxStore:\n";
p_a += "  key (PK), status, payload_hash, gateway?, provider_event_id?, payload_ref?,\n";
p_a += "  lease_owner, lease_token, lease_expires_at, attempts, generation,\n";
p_a += "  available_at?, first_received_at?, last_received_at?, completed_at?,\n";
p_a += "  last_error_sanitized? (max size), tenant_id?, created_at, updated_at\n";
p_a += "payment_reconciliation_jobs — maps to ReconciliationStore:\n";
p_a += "  key (PK), status, subject_id?, due_at, lease_owner, lease_token, lease_expires_at,\n";
p_a += "  attempts, generation, last_error_sanitized?, tenant_id?, created_at, updated_at, completed_at?\n";
p_a += "payment_storage_migrations — version tracking:\n";
p_a += "  version (PK or unique), name, applied_at, checksum?\n";
p_a += "Document check constraints (status enums), indexes (lease_expires_at, available_at/due_at, tenant_id+key),\n";
p_a += "payload_hash as TEXT consistently, timestamps as TEXT ISO-8601 in portable templates (adapters may map to TIMESTAMPTZ).\n\n";

p_a += "### 11.3 SchemaNamespaceConfig — MUST validate\n";
p_a += "```ts\n";
p_a += "type SchemaNamespaceConfig = {\n";
p_a += "  tablePrefix?: string;      // e.g. \"pay_\" — validated identifier fragment only\n";
p_a += "  sqlSchema?: string;        // PostgreSQL schema e.g. \"payments\" — validated identifier\n";
p_a += "  tenantColumn?: boolean | string; // enable tenant column; optional custom name if string\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Validation rules (strict):\n";
p_a += "- identifiers: /^[A-Za-z_][A-Za-z0-9_]*$/ and max length (e.g. 63 for PG)\n";
p_a += "- tablePrefix: only [A-Za-z0-9_], no dots/spaces/quotes/semicolons\n";
p_a += "- reject empty string when provided; reject SQL injection characters\n";
p_a += "- resolveTableName(logical, config) returns qualified name ONLY after validation\n";
p_a += "- NEVER string-interpolate unvalidated names into SQL\n";
p_a += "Tests: valid configs accepted; injection attempts rejected; resolveTableName stable.\n\n";

p_a += "### 11.4 Migration policy\n";
p_a += "Export:\n";
p_a += "- MIGRATIONS: readonly array of { version: number; name: string; sql: { portable?: string; postgres?: string; sqlite?: string }; checksum?: string }\n";
p_a += "- CURRENT_SCHEMA_VERSION constant\n";
p_a += "- migrate(executor, { dialect, namespace?, direction?: 'up' }) — explicit only\n";
p_a += "- verifySchema(executor, { dialect, namespace?, expectedVersion? }) → { ok, missing[], extra?, version }\n";
p_a += "Executor interface (narrow, NOT a full ORM):\n";
p_a += "  { execute(sql: string, params?: readonly unknown[]): Promise<unknown> | unknown;\n";
p_a += "    query?<T>(sql: string, params?: readonly unknown[]): Promise<T[]> | T[] }\n";
p_a += "CRITICAL: migrate is never called from index.ts top-level or from a constructor that runs on import.\n";
p_a += "Migration 001 creates the four logical tables (+ indexes). Use dialect-specific DDL where needed\n";
p_a += "(e.g. PostgreSQL CHECK constraints / TIMESTAMPTZ optional notes; SQLite TEXT + CHECK).\n";
p_a += "Tests: migrate applies versions; second migrate is no-op/idempotent for applied; verifySchema fails if table missing;\n";
p_a += "importing package does not apply migrations (spy/assert no execute on import).\n\n";

p_a += "### Shared record validation\n";
p_a += "- MAX_SANITIZED_ERROR_LENGTH (e.g. 512 or 1024) — truncate + document\n";
p_a += "- validate lease token non-empty for mutators\n";
p_a += "- validate status enums per table\n";
p_a += "- payload hash non-empty string when required\n";
p_a += "- timestamps look like ISO-8601 (basic check)\n";
p_a += "No secrets patterns required in storage of error field (callers sanitize; still enforce max size).\n\n";

p_a += "### Public exports (curated)\n";
p_a += "Schema version constants, table definitions, createSchemaNamespace / resolveTableName,\n";
p_a += "row codecs, validation helpers, MIGRATIONS, migrate, verifySchema, claim algorithm + templates,\n";
p_a += "dialect types, optional reference store factory for tests.\n";
p_a += "public-api.test.ts freezes export names.\n";
p_a += "Do NOT export a general-purpose SQL query builder or ORM.\n\n";

p_a += "### Stream A tests (must pass)\n";
p_a += "- namespace validation rejects injection / invalid identifiers\n";
p_a += "- resolveTableName with prefix and schema\n";
p_a += "- codecs round-trip for each table shape\n";
p_a += "- error field max size enforced\n";
p_a += "- migrate + verifySchema with a fake executor or memory-relational reference\n";
p_a += "- package private: true in package.json\n";
p_a += "- import does not auto-migrate\n";
p_a += "Run: after workspace wiring, bun test internal/sql-store OR bun run --filter @paykernel/internal-sql-store test\n";
p_a += "Also typecheck the package.\n";

let a_result = agent(p_a, #{
    label: "impl:11-schema-migrations",
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

// Parallel streams B (atomic claims + contention) and C (docs + monorepo)
log("Implementing Phase 11 atomic claims and docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — ATOMIC CLAIM ALGORITHM + DIALECT TEMPLATES + CONTENTION PROOF (Task 11.5).\n";
p_b += "OWN: internal/sql-store/src/claims/**, internal/sql-store/src/reference/**,\n";
p_b += "internal/sql-store/src/claim-contention.test.ts (or under claims/),\n";
p_b += "any algorithm tests. May extend Stream A files if missing claim pieces.\n";
p_b += "Do NOT write gate report. Do NOT create Phase 12 adapter packages.\n\n";

p_b += "### Atomic claim algorithm (authoritative semantics)\n";
p_b += "Prefer a SINGLE conditional write path that:\n";
p_b += "1) INSERT new row when key absent → acquired with generation=1 (or 0→1), attempts=1, new leaseToken\n";
p_b += "2) Reclaim ONLY when existing lease expired OR row is retryable-pending (document rules per store)\n";
p_b += "3) On reclaim: increment generation, increment attempts, issue NEW leaseToken, update lease_owner/expiry\n";
p_b += "4) If active lease held by another worker → in_progress (no mutation of ownership)\n";
p_b += "5) If terminal completed → already_completed (idempotency/webhook)\n";
p_b += "6) If payload_hash mismatch on webhook → payload_hash_conflict\n";
p_b += "7) If indeterminate (idempotency) → indeterminate (do NOT re-lease)\n";
p_b += "8) Return resulting lease token and state on acquire\n\n";

p_b += "Implement:\n";
p_b += "1) Pure decision function evaluateClaim(...) for unit tests of transitions without SQL.\n";
p_b += "2) Dialect SQL templates for postgres and sqlite that express conditional INSERT/UPDATE intent\n";
p_b += "   (e.g. INSERT ... ON CONFLICT DO UPDATE WHERE lease_expires_at < $now OR status IN (...)\n";
p_b += "   RETURNING ...). Document that adapters must execute these as prepared statements.\n";
p_b += "3) A reference implementation that applies the algorithm under a process-local mutex OR\n";
p_b += "   bun:sqlite with a SINGLE synchronous transaction for claim (NO await inside tx callback).\n";
p_b += "   Reference is for foundation tests only — mark NON-PRODUCTION / NOT multi-host.\n";
p_b += "   If using bun:sqlite, isolate under reference/bun-sqlite* and only import bun:sqlite there\n";
p_b += "   (not from root index if that would pull bun into portable consumers — fine for private package,\n";
p_b += "   but prefer exporting reference behind explicit path or factory that documents bun requirement).\n\n";

p_b += "### Contention tests (Acceptance A3) — REQUIRED\n";
p_b += "Using the reference store (memory-relational with sync critical section OR bun:sqlite):\n";
p_b += "- N concurrent claim/reserve calls on same key → exactly one acquired; others in_progress/already_*\n";
p_b += "- after lease expiry (fake clock or past expires_at), reclaim succeeds with higher generation and new token\n";
p_b += "- stale token complete/fail rejected\n";
p_b += "- webhook payload_hash conflict under concurrent different hashes\n";
p_b += "- generation monotonic across reclaim chain\n";
p_b += "- prove algorithm is NOT get-then-set race: document that reference uses sync section / single SQL statement\n";
p_b += "Also unit-test pure evaluateClaim for each branch.\n";
p_b += "Optionally export a small harness that future Phase 12 adapters call to prove dialect equivalence.\n\n";

p_b += "### Equivalence notes\n";
p_b += "Document that postgres and sqlite templates implement the SAME logical transitions;\n";
p_b += "Phase 12 adapters must pass testkit conformance suites using these templates.\n";
p_b += "Do not hide dialect differences in a leaky abstraction that loses atomicity.\n\n";

p_b += "### After implementation run tests\n";
p_b += "bun test internal/sql-store (or package filter). Fix until green.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCS + MONOREPO WIRING for Phase 11.\n";
p_c += "OWN: internal/sql-store/README.md, internal/sql-store/docs/relational-foundation.md (NEW),\n";
p_c += "internal/sql-store/docs/migrations.md (NEW),\n";
p_c += "internal/sql-store/docs/atomic-claims.md (NEW),\n";
p_c += "internal/sql-store/CHANGELOG.md Unreleased Phase 11,\n";
p_c += "docs/monorepo.md layout update (internal/sql-store present),\n";
p_c += "docs/workspace-boundaries.md (internal packages private; sql-store role),\n";
p_c += "docs/releases.md note that internal packages are never published,\n";
p_c += "root package.json workspaces include internal/*; scripts optionally include sql-store typecheck/test,\n";
p_c += "packages/testkit/docs/store-contracts.md short pointer that relational foundation is Phase 11 internal/sql-store,\n";
p_c += "scripts/check-workspace-boundaries.ts already has internal private rule — verify still works.\n";
p_c += "Do NOT write phase-11-gate-report.md (Gate owns it).\n\n";

p_c += "### relational-foundation.md MUST cover\n";
p_c += "1) Purpose: shared schemas/algorithms without unsafe driver abstraction\n";
p_c += "2) Package is PRIVATE — not published; not a public SQL ORM\n";
p_c += "3) Canonical tables and column intent (map to Phase 9 contracts)\n";
p_c += "4) Namespace configuration validation rules\n";
p_c += "5) Migration policy: explicit migrate/verify; never auto on import\n";
p_c += "6) Atomic claim algorithm overview + dialect templates\n";
p_c += "7) How Phase 12+ adapters consume this package\n";
p_c += "8) Crash / claim boundaries for relational claims\n";
p_c += "9) Prepared statements only; no unvalidated table name interpolation\n\n";

p_c += "### monorepo wiring (required)\n";
p_c += "Root workspaces: [\"packages/*\", \"internal/*\"]\n";
p_c += "typecheck: include sql-store filter if feasible\n";
p_c += "test: include internal/sql-store in bun test paths (e.g. packages/core packages/testkit packages/webhooks internal/sql-store)\n";
p_c += "build: optional — private package should still build for consumers in-workspace\n";
p_c += "Build order: core → webhooks → testkit → (sql-store if depends on testkit)\n";
p_c += "Update description of monorepo package if needed.\n";
p_c += "Run bun install after workspaces change.\n";
p_c += "Run bun run check:boundaries — must pass; internal package private:true enforced.\n\n";

p_c += "### Boundaries docs\n";
p_c += "State: internal/sql-store is private shared foundation for future relational adapters.\n";
p_c += "core/webhooks must not depend on it. Adapters (Phase 12+) may depend on it.\n";
p_c += "sql-store must not depend on core webhooks engine; testkit optional for types only.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:11-claims", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:11-docs-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 11 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 12+ production adapter packages or reconciliation package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) internal/sql-store exists as @paykernel/internal-sql-store with private: true.\n";
p_int += "2) Root workspaces include \"internal/*\"; bun install succeeds.\n";
p_int += "3) Canonical tables defined: payment_idempotency, payment_webhook_inbox,\n";
p_int += "   payment_reconciliation_jobs, payment_storage_migrations with columns, indexes, constraints intent.\n";
p_int += "4) Normalized row codecs + shared record validation (error max size) exist and tested.\n";
p_int += "5) SchemaNamespaceConfig validates table prefix, SQL schema, tenant column; rejects injection.\n";
p_int += "6) resolveTableName never interpolates unvalidated names.\n";
p_int += "7) Raw migrations + metadata + explicit migrate() + verifySchema() exist; NO auto-migrate on import.\n";
p_int += "8) Atomic claim algorithm + dialect templates (postgres/sqlite) exist; pure evaluateClaim tested.\n";
p_int += "9) Contention tests prove single winner under concurrent claims; reclaim increments generation; stale token rejected.\n";
p_int += "10) Docs: relational-foundation.md, migrations.md, atomic-claims.md, README, CHANGELOG.\n";
p_int += "11) monorepo.md + workspace-boundaries.md updated; boundaries checker green.\n";
p_int += "12) Core does not depend on sql-store; webhooks does not depend on sql-store.\n";
p_int += "13) No packages/adapter-* Phase 12 packages created.\n";
p_int += "14) No general public SQL ORM/query-builder exported as the product.\n";
p_int += "15) Phase 0-10 safety: typecheck, tests core+testkit+webhooks+sql-store, build, boundaries, runtime portability green.\n";
p_int += "16) exactOptionalPropertyTypes clean.\n";
p_int += "17) Public API freeze test for sql-store exports.\n";
p_int += "18) Prepared-statement discipline documented; SQL templates use bound parameters placeholders.\n";
p_int += "19) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks internal/sql-store\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "20) If Stream A failed, implement the full private package yourself — Phase 11 cannot ship without sql-store.\n";
p_int += "21) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap).\n";
p_int += "22) Ensure sql-store builds (dist if build script exists) and package.json private remains true.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase11",
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
p_ver += "Verify Phase 11 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit packages/webhooks internal/sql-store\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/webhooks/dist/index.js && test -f packages/core/dist/index.js && test -f packages/testkit/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence private package: internal/sql-store/package.json private:true name @paykernel/internal-sql-store\n";
p_ver += "12) Evidence workspaces include internal/* in root package.json\n";
p_ver += "13) Evidence canonical tables payment_idempotency, payment_webhook_inbox, payment_reconciliation_jobs, payment_storage_migrations\n";
p_ver += "14) Evidence SchemaNamespaceConfig validation rejects injection (tests)\n";
p_ver += "15) Evidence migrate + verifySchema + no auto-migrate on import (tests + code read)\n";
p_ver += "16) Evidence atomic claim algorithm + dialect templates\n";
p_ver += "17) Evidence contention tests pass (concurrent single winner)\n";
p_ver += "18) Evidence docs relational-foundation.md migrations.md atomic-claims.md exist\n";
p_ver += "19) Evidence NO packages/store-postgres etc.\n";
p_ver += "20) Evidence core package.json has no sql-store dep; webhooks has no sql-store dep\n";
p_ver += "21) Evidence no general public ORM export\n";
p_ver += "22) Evidence monorepo + boundaries docs updated\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- private_sql_layer_ok: private package with schemas/codecs/templates/validation\n";
p_ver += "- canonical_schema_ok: four tables + constraints/indexes intent\n";
p_ver += "- namespace_config_ok: validated prefix/schema/tenant; no unvalidated interpolation\n";
p_ver += "- migration_policy_ok: raw migrations, metadata, migrate, verify; no auto on import\n";
p_ver += "- atomic_claim_ok: single conditional write algorithm + dialect templates\n";
p_ver += "- contention_ok: concurrent claim tests prove single winner + reclaim fencing\n";
p_ver += "- docs_ok: README + docs + CHANGELOG + monorepo links\n";
p_ver += "- compat_ok: Phase 0-10 green; boundaries; no illegal deps\n";
p_ver += "- no_public_sql_abstraction_ok: private package; not a published ORM; curated exports\n";
p_ver += "Set ok=true only if typecheck, tests (all packages + sql-store), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase11",
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
    write_scratch_file("phase11-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 11 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 11 — each PASS or BLOCKING:\n";
p_gate += "A1) relational adapters share behavior and schema intent without unsafe driver abstraction.\n";
p_gate += "    Evidence: private internal/sql-store with canonical schema, codecs, dialect-aware templates;\n";
p_gate += "    no pretend-one-driver abstraction; no published general SQL API.\n";
p_gate += "A2) migrations are explicit and versioned.\n";
p_gate += "    Evidence: versioned migration metadata/files; migrate() helper; verifySchema();\n";
p_gate += "    tests prove no auto-migrate on import; CURRENT_SCHEMA_VERSION present.\n";
p_gate += "A3) atomic claims are validated under contention.\n";
p_gate += "    Evidence: concurrent claim tests with exactly one acquired; reclaim generation bump;\n";
p_gate += "    stale token rejected; algorithm is conditional write / sync critical section not get-then-set.\n\n";
p_gate += "Also require Phase 11 sections 11.1-11.5 deliverables:\n";
p_gate += "- 11.1 private shared SQL layer (canonical tables, codecs, templates, versions, fixtures, validation)\n";
p_gate += "- 11.2 canonical schema four tables + PKs/indexes/constraints/hashes/timestamps/sanitized errors/tenant\n";
p_gate += "- 11.3 namespace config validated (prefix, sql schema, tenant); never unvalidated table name interpolation\n";
p_gate += "- 11.4 migration policy: raw files, metadata, migrate, verify; never auto on import/prod construction\n";
p_gate += "- 11.5 atomic claim algorithm: insert/reclaim/generation/token; dialect equivalence intent; contention proof\n";
p_gate += "- Package private: true under internal/sql-store\n";
p_gate += "- Phase 0-10 safety net still green; boundaries; no core/webhooks → sql-store\n";
p_gate += "- No Phase 12 packages/adapter-* production adapters\n";
p_gate += "- No logical bugs: auto-migrate; get/set claim race; SQL injection via table names;\n";
p_gate += "  await in sync SQLite tx; secrets unbounded in error columns; JS number 64-bit IDs;\n";
p_gate += "  publishing internal package; core depending on sql-store.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit packages/webhooks internal/sql-store;\n";
p_gate += "bun run typecheck; check:boundaries; focused sql-store tests; validate:package if time.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to internal/sql-store/docs/phase-11-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-11-gate-report.md (full or pointer + verdict summary).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase11-adversarial",
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
    write_scratch_file("phase11-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 11 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 11 only — no Phase 12 adapters, no reconciliation package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete private internal/sql-store: schemas, codecs, namespace validation, migrations,\n";
    p_fix += "atomic claims, contention tests, docs, monorepo wiring as needed.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase11-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 11 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit packages/webhooks internal/sql-store,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm all 11.1-11.5 deliverables and acceptance criteria A1-A3 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase11-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase11-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 11 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update internal/sql-store/docs/phase-11-gate-report.md and packages/core/docs/baseline/phase-11-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 11.1-11.5 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase11-final",
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
        write_scratch_file("phase11-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 11 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 11,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
