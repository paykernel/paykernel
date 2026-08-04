let meta = #{
    name: "phase-13-redis-adapter",
    description: "Phase 13 Redis/Valkey/Bun Redis/Upstash Adapter: critic, implement @paykernel/store-redis (Lua scripts, command port, bindings, key design, conformance, hybrid docs), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 13 roadmap 13.1-13.7 and acceptance criteria" },
        #{ title: "Implement", detail: "adapter-redis package: scripts, port, stores, subpaths, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-12 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 13 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 13" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 13 (Redis, Valkey, Bun Redis, and Upstash Adapter) for PayKernel monorepo",
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
        "command_port_ok", "lua_atomic_ok", "key_design_ok", "manifest_ok",
        "conformance_ok", "persistence_docs_ok", "hybrid_docs_ok", "docs_ok",
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
        "command_port_ok": #{ "type": "boolean" },
        "lua_atomic_ok": #{ "type": "boolean" },
        "key_design_ok": #{ "type": "boolean" },
        "manifest_ok": #{ "type": "boolean" },
        "conformance_ok": #{ "type": "boolean" },
        "persistence_docs_ok": #{ "type": "boolean" },
        "hybrid_docs_ok": #{ "type": "boolean" },
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

let redis_url = if args == () || args.redis_url == () {
    "redis://127.0.0.1:33027"
} else {
    args.redis_url
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 13 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 13 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 13 — Redis, Valkey, Bun Redis, and Upstash Adapter\" completely\n";
p_critic += "(Package, Driver Bindings, Objective, Tasks 13.1-13.7, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  11 atomicity by storage engine not get/set; 13 prepared / bound / scripted only;\n";
p_critic += "  14 no raw payloads by default; 15 portable timestamps/IDs;\n";
p_critic += "  16 every adapter same conformance suite; 17 document crash boundaries;\n";
p_critic += "  19 never auto-migrate on import/prod construction (N/A for Redis schema — but no auto side effects).\n";
p_critic += "Also section 3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings,\n";
p_critic += "3.5 Each Adapter Must Declare Its Guarantees, 3.6 Redis Is Not Automatically the Best Audit Store,\n";
p_critic += "3.8 Redis Is Optional Infrastructure, 5 Proposed Repository Structure (adapter-redis),\n";
p_critic += "5.1 Package Boundary Rules (adapter root must not import optional drivers).\n";
p_critic += "Phases 0-12 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, store contracts, webhook inbox engine,\n";
p_critic += "private internal/sql-store relational foundation, and packages/store-postgres.\n";
p_critic += "Do NOT start Phase 14+ (adapter-sqlite, adapter-turso, adapter-cloudflare-d1/do),\n";
p_critic += "new reconciliation domain package, new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-12 domain/foundation packages unless required for monorepo wiring/docs.\n\n";

p_critic += "CONTEXT already present from Phase 9-12:\n";
p_critic += "- packages/testkit — LeaseAware IdempotencyStore / WebhookInboxStore / ReconciliationStore contracts\n";
p_critic += "- packages/testkit — runIdempotencyStoreConformanceSuite / runWebhookInboxStoreConformanceSuite / runReconciliationStoreConformanceSuite\n";
p_critic += "- packages/testkit — StorageAdapterManifest + assertStorageAdapterManifest\n";
p_critic += "- packages/testkit — memory stores (NON-PRODUCTION) + FakeClock for lease tests — BEHAVIOR REFERENCE for Lua logic\n";
p_critic += "- packages/webhooks — inbox engine; dual-owned WebhookInboxStore (structurally compatible)\n";
p_critic += "- packages/store-postgres — Phase 12 production SQL adapter pattern (subpaths, errors, manifest, skip-without-env tests)\n";
p_critic += "- scripts/check-workspace-boundaries.ts already lists ioredis in ADAPTER_OPTIONAL_DRIVERS\n";
p_critic += "- NO packages/store-redis yet; monorepo docs say Phase 13+ adapters not yet.\n\n";

p_critic += "Audit against EVERY Phase 13 requirement with evidence (grep/read):\n\n";

p_critic += "Package: @paykernel/store-redis under packages/store-redis\n\n";

p_critic += "Driver bindings (subpaths):\n";
p_critic += "  @paykernel/store-redis/bun\n";
p_critic += "  @paykernel/store-redis/upstash\n";
p_critic += "  @paykernel/store-redis/ioredis\n";
p_critic += "  @paykernel/store-redis/node-redis\n\n";

p_critic += "Objective: optional low-latency atomic idempotency, leases, and inbox coordination.\n";
p_critic += "Redis must NOT become mandatory or the default recommendation.\n";
p_critic += "Apps using PostgreSQL (Phase 12), D1, Turso, DO, or SQLite may run full safety model without Redis.\n\n";

p_critic += "13.1 Bun Native Redis/Valkey Binding:\n";
p_critic += "- isolate ALL bun Redis imports behind the /bun subpath only\n";
p_critic += "- accept injected RedisClient as preferred configuration\n";
p_critic += "- optionally create client from explicit URL\n";
p_critic += "- REDIS_URL / VALKEY_URL only in convenience constructors, not portable root\n";
p_critic += "- use raw send() for Lua scripts and commands without first-class Bun methods\n";
p_critic += "- validate supported Redis/Valkey server version in integration tests\n";
p_critic += "- disable/control offline command queuing for correctness-critical ops (reconnect replay risk)\n";
p_critic += "- document: Bun native client does NOT support Redis Cluster or Sentinel\n";
p_critic += "- document: MULTI/EXEC via raw commands; prefer one atomic Lua script per store transition\n";
p_critic += "- do NOT use experimental Pub/Sub as correctness mechanism for webhook delivery/retries\n";
p_critic += "- integration matrix: Redis 7.2+, Valkey where claimed, TLS where CI permits\n\n";

p_critic += "13.2 Atomic Scripts (Lua or equivalent server-side):\n";
p_critic += "- reserve/claim; lease renewal; completion with lease-token validation;\n";
p_critic += "  failure and retry scheduling; payload conflict detection;\n";
p_critic += "  monotonically advancing fencing generations when required\n";
p_critic += "- FORBIDDEN: claim as separate GET then SET\n";
p_critic += "- Scripts MUST return explicit tagged results (not ambiguous integer conventions)\n\n";

p_critic += "13.3 Shared Redis Command Port:\n";
p_critic += "```ts\n";
p_critic += "interface RedisCommandPort {\n";
p_critic += "  send(command: string, args: readonly string[]): Promise<unknown>;\n";
p_critic += "}\n";
p_critic += "```\n";
p_critic += "Do NOT build a large generic Redis abstraction. Small audited surface only.\n";
p_critic += "Each binding translates: connection errors, timeouts, script load/exec errors,\n";
p_critic += "auth failures, stale lease outcomes, unsupported topology errors → StoreErrorCode taxonomy.\n\n";

p_critic += "13.4 Key Design:\n";
p_critic += "- stable key prefixes; tenant namespaces; hash tags for Cluster co-location (cluster-capable bindings)\n";
p_critic += "- configurable retention TTL; separate sorted sets for due jobs where needed\n";
p_critic += "- schema/version suffixes for future migration; maximum record and error payload sizes\n";
p_critic += "- Bun binding MUST reject cluster-specific configuration\n\n";

p_critic += "13.5 Persistence Caveats:\n";
p_critic += "Document correctness depends on Redis/Valkey persistence, replication, failover, AOF/RDB.\n";
p_critic += "Do NOT describe ephemeral cache config as a durable audit store.\n";
p_critic += "Manifest must distinguish: coordination-safe during normal operation;\n";
p_critic += "durable across process restart; durable across Redis service restart; suitable as only audit store.\n\n";

p_critic += "13.6 Hybrid Examples (docs):\n";
p_critic += "- Bun Redis coordination + Bun SQL/PostgreSQL audit history\n";
p_critic += "- Upstash coordination + D1 or Turso durable history\n";
p_critic += "- Redis-only with explicit persistence warnings\n";
p_critic += "- no-Redis deployment proving PostgreSQL (or D1 later) satisfies contracts independently\n\n";

p_critic += "13.7 Tests (every binding + shared conformance):\n";
p_critic += "concurrent claims; Lua script atomicity; lease expiration; stale completion;\n";
p_critic += "client reconnect boundaries; offline queue behavior;\n";
p_critic += "Redis Cluster-compatible key layout for cluster-capable bindings;\n";
p_critic += "Bun binding rejection/docs of unsupported Cluster and Sentinel;\n";
p_critic += "TTL cleanup; service restart under selected persistence config (doc/integration where practical);\n";
p_critic += "parity between Bun, Upstash, ioredis, and node-redis result mapping.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) Bun native Redis/Valkey is a first-class supported binding\n";
p_critic += "A2) Upstash and standard Redis clients share equivalent contract behavior\n";
p_critic += "A3) atomicity does not depend on client-side sequencing\n";
p_critic += "A4) persistence and topology limitations are explicit\n";
p_critic += "A5) applications can use the SDK without installing or operating Redis\n";
p_critic += "A6) no Redis driver is imported from the package root\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/store-redis depends on testkit (contracts/conformance); NOT on sql-store (Redis is not SQL)\n";
p_critic += "- MAY depend on core only if needed — prefer testkit contracts only\n";
p_critic += "- core must NOT depend on adapter-redis\n";
p_critic += "- webhooks must NOT depend on adapter-redis\n";
p_critic += "- adapter-postgres must NOT depend on adapter-redis\n";
p_critic += "- drivers as optional peerDependencies; isolated subpaths only\n";
p_critic += "- update scripts/check-workspace-boundaries.ts ADAPTER_OPTIONAL_DRIVERS:\n";
p_critic += "  ensure ioredis, redis (node-redis), @upstash/redis are listed;\n";
p_critic += "  also any bun redis module identifiers if needed\n";
p_critic += "- do NOT create adapter-sqlite / adapter-turso / adapter-cloudflare-* (Phase 14+)\n";
p_critic += "- do NOT create packages/reconciliation domain package\n";
p_critic += "- do NOT make Redis mandatory in root README or default architecture docs\n\n";

p_critic += "Critical design constraints to flag as risks if missing plan:\n";
p_critic += "- Injectable clock for conformance (FakeClock.advance must control lease expiry;\n";
p_critic += "  Lua scripts MUST take `now` as ARGV, not rely only on Redis TIME for reclaim predicates in tests)\n";
p_critic += "- Explicit tagged Lua return values (e.g. {\"acquired\", ...} or JSON tags) — no magic integers alone\n";
p_critic += "- generation monotonic on reserve/claim/renew; unguessable leaseToken\n";
p_critic += "- stale lease complete/fail → StoreLeaseLostError\n";
p_critic += "- indeterminate rows block reserve (A4 from Phase 9)\n";
p_critic += "- StorageAdapterManifest honesty: multi-host when shared Redis; durability configuration-dependent\n";
p_critic += "  (NOT blindly durable unless AOF/RDB documented as required)\n";
p_critic += "- Map StoreErrorCode taxonomy; sanitized error fields max size; no secrets\n";
p_critic += "- exactOptionalPropertyTypes ON\n";
p_critic += "- Offline queue disabled or carefully controlled on correctness-critical ops\n";
p_critic += "- Pub/Sub NOT used for correctness\n";
p_critic += "- Cluster config rejected on Bun binding\n";
p_critic += "- Tests skip cleanly without REDIS_URL / PAYMENTS_SDK_REDIS_URL\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: root importing drivers; get-then-set claims; Lua without now injection; dishonest durable manifest;\n";
p_critic += "secrets in errors; core→adapter dep; making Redis mandatory; Pub/Sub correctness; offline queue replay;\n";
p_critic += "Bun cluster config accepted; Phase 14+ packages; FakeClock ignored.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase13-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase13-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 13 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 13\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 13 Redis Adapter in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "LIVE REDIS for integration: export PAYMENTS_SDK_REDIS_URL=" + redis_url + " and REDIS_URL=" + redis_url + " in every shell that runs live tests.\n";
common += "Prefer PAYMENTS_SDK_REDIS_URL. When this URL is set, integration/conformance MUST run (not skip) and PASS.\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Webhooks = packages/webhooks = @paykernel/webhooks (0.1.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — Phase 9 contracts + conformance + FakeClock.\n";
common += "Sql-store = internal/sql-store (private Phase 11) — DO NOT depend from Redis adapter.\n";
common += "Postgres adapter = packages/store-postgres (Phase 12 COMPLETE) — preserve; do not break.\n";
common += "PHASE 13 ONLY: create packages/store-redis = @paykernel/store-redis.\n";
common += "Do NOT create packages/store-sqlite / adapter-turso / adapter-cloudflare-d1 / adapter-cloudflare-do.\n";
common += "Do NOT create packages/reconciliation (later). Do NOT add new PSPs or extract gateways.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside adapter-redis; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-12 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + Lua script unit + conformance + binding parity).\n";
common += "2) Atomic claims = single Lua script / engine-level; NEVER get-then-set as claim strategy.\n";
common += "3) Never convert uncertain outcomes into failure (respect indeterminate contracts).\n";
common += "4) No secret leakage in error fields (sanitized, max size).\n";
common += "5) No framework coupling in portable root; drivers only on subpaths.\n";
common += "6) Root entry must NOT import ioredis, redis, @upstash/redis, or Bun Redis modules.\n";
common += "7) Keep 0.x compat: core/webhooks/testkit/sql-store/adapter-postgres public APIs stable; additive only.\n";
common += "8) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "9) exactOptionalPropertyTypes is ON — no undefined assignment to optional props without care.\n";
common += "10) Core/webhooks/adapter-postgres must NOT depend on adapter-redis.\n";
common += "11) Portable ISO-8601 timestamps and opaque string lease tokens; no JS number for 64-bit IDs.\n";
common += "12) Do not store raw provider payloads/signatures by default.\n";
common += "13) Injectable clock: stores MUST accept clock/now; pass now into Lua ARGV so FakeClock works.\n";
common += "14) Publish honest StorageAdapterManifest: multi-host when shared Redis; durability configuration-dependent;\n";
common += "    notes distinguish coordination-safe vs durable-across-process vs durable-across-Redis-restart vs only-audit-store.\n";
common += "15) Map driver errors into StoreErrorCode taxonomy (StoreLeaseLostError, StoreUnavailableError, etc.).\n";
common += "16) Redis is OPTIONAL — never imply Redis is required to use the SDK.\n";
common += "17) Prefer one atomic Lua script per store transition; tagged results (not magic integers alone).\n";
common += "18) Do not use Pub/Sub for webhook delivery correctness or retries.\n";
common += "19) Bun binding rejects Cluster/Sentinel config; documents MULTI/EXEC/offline-queue caveats.\n";
common += "20) Mirror Phase 9 contract semantics from packages/testkit/src/storage/contracts.ts and\n";
common += "    packages/testkit/src/memory/memory-stores.ts (behavior oracle for Lua).\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: package scaffold + command port + Lua scripts + stores + key design
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE SCAFFOLD + RedisCommandPort + LUA SCRIPTS + STORE FACTORIES + KEY DESIGN (Tasks 13.2, 13.3, 13.4, partial 13.5).\n";
p_a += "OWN primarily: packages/store-redis/** (NEW package).\n";
p_a += "May touch root package.json scripts ONLY if needed — prefer leave monorepo polish to Integrate/Stream C.\n";
p_a += "Do NOT write phase-13-gate-report.md (Gate owns it).\n";
p_a += "Do NOT implement SQLite/Turso/D1/DO adapters.\n";
p_a += "Do NOT break packages/store-postgres.\n\n";

p_a += "### Create package packages/store-redis\n";
p_a += "Name: @paykernel/store-redis\n";
p_a += "version 0.1.0; type module; publishable (NOT private).\n";
p_a += "description: Redis/Valkey/Upstash stores for PayKernel lease-aware idempotency, webhook inbox, and reconciliation coordination.\n";
p_a += "dependencies:\n";
p_a += "  @paykernel/testkit: workspace:*  (contracts, conformance, FakeClock types)\n";
p_a += "optional peerDependencies:\n";
p_a += "  ioredis — for /ioredis subpath\n";
p_a += "  redis — for /node-redis subpath (node-redis package name is `redis`)\n";
p_a += "  @upstash/redis — for /upstash subpath\n";
p_a += "  Bun Redis needs no npm peer (runtime-provided) but isolate behind /bun\n";
p_a += "peerDependenciesMeta: all optional true\n";
p_a += "devDependencies: @types/bun, typescript, ioredis, redis, @upstash/redis for tests as needed\n";
p_a += "scripts: build multi-entry (root + bun + upstash + ioredis + node-redis) + build:types, typecheck, test\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist\n";
p_a += "LICENSE MIT (copy from sibling). README + CHANGELOG.\n";
p_a += "publishConfig access public + provenance true (match testkit/adapter-postgres).\n";
p_a += "paymentsSdk: { portable: false, runtime: \"node-or-bun\" }\n";
p_a += "After package.json exists: bun install from monorepo root.\n\n";

p_a += "### Exports map (CRITICAL — root must not pull drivers)\n";
p_a += "```json\n";
p_a += "{\n";
p_a += "  \".\": { \"types\": \"./dist/index.d.ts\", \"import\": \"./dist/index.js\" },\n";
p_a += "  \"./bun\": { \"types\": \"./dist/bun.d.ts\", \"import\": \"./dist/bun.js\" },\n";
p_a += "  \"./upstash\": { \"types\": \"./dist/upstash.d.ts\", \"import\": \"./dist/upstash.js\" },\n";
p_a += "  \"./ioredis\": { \"types\": \"./dist/ioredis.d.ts\", \"import\": \"./dist/ioredis.js\" },\n";
p_a += "  \"./node-redis\": { \"types\": \"./dist/node-redis.d.ts\", \"import\": \"./dist/node-redis.js\" }\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Root exports: store factories accepting RedisCommandPort, manifest, key design helpers, types,\n";
p_a += "script registry — ZERO static imports of ioredis/redis/@upstash/redis/Bun Redis.\n";
p_a += "Subpaths: thin bindings that adapt driver clients to RedisCommandPort and re-export factories.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/store-redis/src/\n";
p_a += "  index.ts                 # curated public root exports\n";
p_a += "  manifest.ts              # REDIS_STORAGE_ADAPTER_MANIFEST + getter\n";
p_a += "  types.ts                 # RedisStoreOptions, clock, key namespace, RedisCommandPort re-export\n";
p_a += "  port.ts                  # RedisCommandPort interface + helpers (evalSha/eval via send)\n";
p_a += "  errors.ts                # map driver errors → StoreErrorCode / StoreLeaseLostError / etc.\n";
p_a += "  clock.ts                 # Clock interface compatible with testkit FakeClock (nowMs)\n";
p_a += "  keys.ts                  # key prefixes, tenant namespaces, hash tags, version suffixes, TTL helpers\n";
p_a += "  limits.ts                # max record / error payload sizes\n";
p_a += "  scripts/\n";
p_a += "    index.ts               # script registry + load/eval helpers\n";
p_a += "    idempotency.lua.ts     # reserve/renew/complete/markIndeterminate (as TS string constants)\n";
p_a += "    webhook-inbox.lua.ts   # claim/renew/complete/fail/listRetryable helpers\n";
p_a += "    reconciliation.lua.ts  # schedule/claim/renew/complete/fail/markManualReview/listDue\n";
p_a += "    results.ts             # parse tagged script results → typed outcomes\n";
p_a += "  stores/\n";
p_a += "    idempotency-store.ts\n";
p_a += "    webhook-inbox-store.ts\n";
p_a += "    reconciliation-store.ts\n";
p_a += "    shared.ts\n";
p_a += "  index-stores.ts          # createRedis* factories + createRedisStores bundle\n";
p_a += "  drivers/\n";
p_a += "    bun.ts\n";
p_a += "    upstash.ts\n";
p_a += "    ioredis.ts\n";
p_a += "    node-redis.ts\n";
p_a += "  bun.ts / upstash.ts / ioredis.ts / node-redis.ts  # subpath re-exports\n";
p_a += "  public-api.test.ts\n";
p_a += "  keys.test.ts\n";
p_a += "  scripts/*.test.ts        # unit-test result parsers; mock port tests for Lua orchestration\n";
p_a += "  stores/*.test.ts\n";
p_a += "  conformance.redis.test.ts\n";
p_a += "  integration.redis.test.ts\n";
p_a += "  parity.bindings.test.ts\n";
p_a += "  bun-cluster-reject.test.ts\n\n";

p_a += "### 13.3 RedisCommandPort (NARROW)\n";
p_a += "```ts\n";
p_a += "export interface RedisCommandPort {\n";
p_a += "  send(command: string, args: readonly string[]): Promise<unknown>;\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Optional extensions ONLY if needed without bloating: e.g. eval(script, keys, args) as thin wrapper over send('EVAL', ...).\n";
p_a += "Stores MUST depend only on RedisCommandPort (+ clock + key options), never on a specific client type.\n";
p_a += "Provide createEvalHelper(port) that uses EVAL (or EVALSHA after SCRIPT LOAD if you cache SHAs carefully).\n";
p_a += "If using EVALSHA, handle NOSCRIPT by falling back to EVAL once.\n\n";

p_a += "### 13.2 Lua scripts — REQUIRED atomic transitions\n";
p_a += "Implement Lua (as string constants) for ALL correctness-critical transitions:\n";
p_a += "Idempotency: reserve, renew, complete, markIndeterminate, get (get may be HGETALL/GET), deleteExpired\n";
p_a += "Webhook: claim, renew, complete, fail (retry schedule), get, listRetryable (ZSET range), deleteExpired\n";
p_a += "Reconciliation: schedule, claim, renew, complete, fail, markManualReview, get, listDue, deleteExpired\n";
p_a += "Rules:\n";
p_a += "- ONE script per transition (or one script with op tag) — never GET then SET in JS for claim\n";
p_a += "- Pass nowMs (or ISO) as ARGV from injectable clock — do NOT hardcode redis.call('TIME') as sole lease source in test paths\n";
p_a += "- Return tagged arrays e.g. {\"acquired\", token, generation, ...} or JSON string with tag field\n";
p_a += "  Parser in results.ts maps tags → IdempotencyReservation / ClaimWebhookResult / etc.\n";
p_a += "- generation increments on successful reserve/claim/renew that issues new lease\n";
p_a += "- leaseToken: unguessable (crypto random from JS, passed into script) OR generated in script with random + validation\n";
p_a += "  Prefer JS generates token (crypto.getRandomValues / randomBytes) and script stores/validates it\n";
p_a += "- complete/fail/renew require matching leaseToken; mismatch → tag lease_lost → StoreLeaseLostError\n";
p_a += "- fingerprint/payloadHash conflicts return explicit conflict tags\n";
p_a += "- indeterminate: reserve returns kind indeterminate; deleteExpired does NOT remove by default\n";
p_a += "- Use HASH for records + optional ZSET for due/retry indexes (score = availableAt/leaseExpires epoch ms)\n";
p_a += "Read packages/testkit/src/memory/memory-stores.ts as the behavioral oracle for status transitions.\n";
p_a += "Read packages/testkit/src/storage/contracts.ts for full method signatures.\n\n";

p_a += "### 13.4 Key design\n";
p_a += "Implement KeyNamespace / RedisKeyDesign:\n";
p_a += "- default prefix e.g. `psdk` or `payments`\n";
p_a += "- schema version suffix e.g. `v1`\n";
p_a += "- tenant id optional segment\n";
p_a += "- logical store segments: idemp | whinbox | recon\n";
p_a += "- record key: `{prefix}:{ver}:{tenant?}:{store}:{key}` with hash tags `{tenant:key}` for cluster-capable bindings when enabled\n";
p_a += "- index ZSET keys: `...:due` / `...:retry` co-located via same hash tag when cluster mode\n";
p_a += "- configurable retention TTL (EXPIRE / EXPIREAT) on terminal records\n";
p_a += "- max record size and max error string size constants; enforce on write\n";
p_a += "- validate tenant/prefix segments (no spaces, no newlines, length caps)\n";
p_a += "Options: { port, clock?, keys?: KeyOptions, leaseMsDefault?, retentionTtlMs?, clusterKeys?: boolean }\n";
p_a += "When clusterKeys true: use hash tags; Bun binding factory MUST reject clusterKeys:true / cluster config.\n\n";

p_a += "### Manifest (13.5 honesty)\n";
p_a += "```ts\n";
p_a += "{\n";
p_a += "  name: \"redis\",\n";
p_a += "  contracts: { idempotency: true, webhookInbox: true, reconciliation: true },\n";
p_a += "  consistency: { claims: \"strong\", readAfterWrite: \"strong\", staleReadsPossible: false },\n";
p_a += "  coordinationScope: \"multi-host\",  // when all workers share one Redis/Valkey\n";
p_a += "  durability: \"configuration-dependent\",\n";
p_a += "  supportsTransactions: false, // Lua is atomic; MULTI not required; honest about Redis tx model\n";
p_a += "  supportsLeases: true,\n";
p_a += "  supportsRetentionCleanup: true,\n";
p_a += "  notes: [\n";
p_a += "    \"Coordination-safe during normal multi-worker operation against shared Redis/Valkey.\",\n";
p_a += "    \"Durable across process restart only if Redis still holds keys (service up).\",\n";
p_a += "    \"Durable across Redis service restart ONLY with AOF/RDB (or cloud persistence) configured correctly.\",\n";
p_a += "    \"Not automatically suitable as the only long-term audit store — prefer hybrid with PostgreSQL/D1/Turso.\",\n";
p_a += "    \"Claims use atomic Lua scripts; never get-then-set in JS.\",\n";
p_a += "    \"Injectable clock: now passed as script ARGV for FakeClock conformance.\",\n";
p_a += "    \"Bun binding does not support Cluster/Sentinel; rejects cluster config.\",\n";
p_a += "    \"Do not use Pub/Sub for webhook correctness.\",\n";
p_a += "    \"Offline command queue should be disabled/controlled for correctness-critical ops.\",\n";
p_a += "    \"Root entry does not import optional peer drivers.\",\n";
p_a += "  ]\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Validate with assertStorageAdapterManifest. Document four durability distinctions in docs too.\n\n";

p_a += "### Public exports (root) — freeze in public-api.test.ts\n";
p_a += "createRedisIdempotencyStore, createRedisWebhookInboxStore, createRedisReconciliationStore,\n";
p_a += "createRedisStores (bundle),\n";
p_a += "RedisCommandPort type,\n";
p_a += "REDIS_STORAGE_ADAPTER_MANIFEST / getRedisStorageAdapterManifest,\n";
p_a += "key helpers types, mapDriverError / StoreError re-exports as needed,\n";
p_a += "clock helpers.\n";
p_a += "Do NOT export a general Redis client wrapper API beyond the port.\n";
p_a += "Assert root source graph has no import of 'ioredis' | 'redis' | '@upstash/redis' | bun redis modules.\n\n";

p_a += "### Stream A tests (no live Redis required)\n";
p_a += "- public-api freeze + root no drivers\n";
p_a += "- key design validation + hash tag formatting\n";
p_a += "- script result parser unit tests (all tags)\n";
p_a += "- mock RedisCommandPort that records send() and returns canned script outputs — store method wiring\n";
p_a += "- error mapping unit tests (sanitize secrets, map timeout/unavailable/auth)\n";
p_a += "- manifest assert\n";
p_a += "Optionally: if a pure Lua interpreter is unavailable, use a carefully written in-process fake that runs the SAME transition logic as scripts for unit tests — but LIVE Redis still required for integration when env set.\n";
p_a += "Prefer: mock port for store wiring + live Redis for real EVAL of the actual Lua strings.\n";
p_a += "Run package typecheck/tests after wiring.\n";

let a_result = agent(p_a, #{
    label: "impl:13-scripts-stores",
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
log("Implementing Phase 13 drivers/tests and docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — DRIVER BINDINGS + CONFORMANCE + INTEGRATION + PARITY TESTS (Tasks 13.1, 13.7).\n";
p_b += "OWN: packages/store-redis/src/drivers/**, subpath entries, integration/conformance/parity tests,\n";
p_b += "boundaries checker updates for optional drivers.\n";
p_b += "May extend Stream A store/script files if missing transitions or bugs.\n";
p_b += "Do NOT write gate report. Do NOT create Phase 14+ adapters. Do NOT break adapter-postgres.\n\n";

p_b += "### 13.1 Bun binding (/bun)\n";
p_b += "Implement around Bun.RedisClient / Bun.redis:\n";
p_b += "- createBunRedisCommandPort(client) / createRedisStoresFromBun({ client | url })\n";
p_b += "- prefer injected client; optional URL constructor\n";
p_b += "- REDIS_URL and VALKEY_URL ONLY in convenience constructors (e.g. createBunRedisFromEnv)\n";
p_b += "- use client.send() for EVAL/EVALSHA and commands without first-class methods\n";
p_b += "- disable or carefully control offline queuing for correctness-critical paths; document choice\n";
p_b += "- REJECT cluster-specific config (options.cluster === true, sentinels, clusterKeys:true on Bun factory)\n";
p_b += "  throw StoreUnsupportedFeatureError or StoreInvalidSchemaError / clear Error with unsupported_feature\n";
p_b += "- document Cluster/Sentinel unsupported; MULTI/EXEC via raw; prefer Lua; no Pub/Sub correctness\n";
p_b += "Isolate ALL Bun Redis imports in drivers/bun.ts and bun.ts entry only.\n\n";

p_b += "### Other bindings\n";
p_b += "1) /upstash — adapt @upstash/redis (HTTP REST). Map timeouts/auth. Note serverless latency caveats in docs.\n";
p_b += "   Use eval/evalsha if available, else send via pipeline equivalent that still runs server-side Lua.\n";
p_b += "2) /ioredis — adapt ioredis. Prefer enableOfflineQueue: false for store construction helpers.\n";
p_b += "   Support cluster-capable key layout when using Redis.Cluster (hash tags).\n";
p_b += "3) /node-redis — adapt `redis` package (node-redis v4+). createClient injection preferred.\n";
p_b += "Each binding: create*CommandPort(client) + createRedisStoresFrom*(options) reusing root factories.\n";
p_b += "Error mapping: connection, timeout, script, auth, topology → StoreErrorCode via shared mapDriverError.\n\n";

p_b += "Update scripts/check-workspace-boundaries.ts ADAPTER_OPTIONAL_DRIVERS to include:\n";
p_b += "  \"ioredis\" (already), \"redis\", \"@upstash/redis\"\n";
p_b += "Update scripts/check-workspace-boundaries.test.ts if needed.\n";
p_b += "Ensure adapter root fails boundary check if it imports these drivers.\n\n";

p_b += "### 13.7 Tests\n";
p_b += "Env: PAYMENTS_SDK_REDIS_URL or REDIS_URL or VALKEY_URL (document; prefer PAYMENTS_SDK_REDIS_URL).\n";
p_b += "When unset: integration/conformance SKIP cleanly so CI without Redis still green.\n";
p_b += "When set: MUST run and PASS:\n";
p_b += "1) runIdempotencyStoreConformanceSuite with real Redis + FakeClock (now via ARGV)\n";
p_b += "2) runWebhookInboxStoreConformanceSuite same\n";
p_b += "3) runReconciliationStoreConformanceSuite same\n";
p_b += "4) Concurrent claims on same key from multiple clients/ports → exactly one acquired\n";
p_b += "5) Lua script atomicity: no intermediate GET/SET race in JS path (grep source; concurrent test)\n";
p_b += "6) Lease expiration + reclaim with FakeClock.advance\n";
p_b += "7) Stale lease token complete/fail → StoreLeaseLostError\n";
p_b += "8) Client reconnect / unavailable mapping where practical\n";
p_b += "9) Offline queue behavior documented + unit/integration where binding allows control\n";
p_b += "10) Cluster key layout unit tests (hash tags) for cluster-capable bindings\n";
p_b += "11) Bun binding rejects cluster/sentinel config (unit test)\n";
p_b += "12) TTL cleanup deleteExpired\n";
p_b += "13) Parity: result mapping tags identical across bindings (unit with mock or live)\n";
p_b += "14) Server version check (INFO server) for Redis >= 7.2 in integration when available\n";
p_b += "Use unique key prefix/namespace per test run to avoid collisions.\n";
p_b += "Primary live binding: prefer Bun Redis when running under bun, else ioredis or node-redis.\n";
p_b += "Each binding has at least construction/smoke unit tests without live server.\n";
p_b += "Optional docker-compose.yml redis:7.2 service for local/CI.\n\n";

p_b += "### After implementation\n";
p_b += "bun install; typecheck package; bun test packages/store-redis\n";
p_b += "If Redis available, export PAYMENTS_SDK_REDIS_URL and run live suites.\n";
p_b += "If not available, ensure skips do not fail the suite.\n";
p_b += "Also run full monorepo safety: bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCS + MONOREPO WIRING for Phase 13.\n";
p_c += "OWN: packages/store-redis/README.md, packages/store-redis/docs/**,\n";
p_c += "packages/store-redis/CHANGELOG.md Unreleased Phase 13,\n";
p_c += "docs/monorepo.md (layout: packages/store-redis present),\n";
p_c += "docs/workspace-boundaries.md (adapter-redis rules, optional Redis, root no drivers),\n";
p_c += "docs/releases.md note if adapters publish separately,\n";
p_c += "root package.json scripts: include adapter-redis in build/typecheck/test filters AFTER adapter-postgres,\n";
p_c += "root package.json description lists adapter-redis,\n";
p_c += "packages/testkit/docs/store-contracts.md short pointer that Phase 13 redis adapter exists,\n";
p_c += "packages/store-postgres docs may note hybrid Redis+Postgres if appropriate (minimal),\n";
p_c += "root README if it lists packages.\n";
p_c += "Do NOT write phase-13-gate-report.md (Gate owns it).\n\n";

p_c += "### Docs that MUST exist under packages/store-redis/docs/\n";
p_c += "1) overview.md — purpose, optional Redis, multi-host coordination, subpaths, explicit non-default\n";
p_c += "2) crash-boundaries.md — crash before/after side effect; lease reclaim; Redis restart caveats\n";
p_c += "3) drivers.md — /bun /upstash /ioredis /node-redis usage; root has no drivers; offline queue; no Pub/Sub correctness\n";
p_c += "4) scripts-atomicity.md — Lua scripts, tagged results, no get-then-set, now ARGV\n";
p_c += "5) key-design.md — prefixes, tenants, hash tags, TTL, version suffixes, size limits; Bun rejects cluster\n";
p_c += "6) persistence.md — 13.5 four distinctions; AOF/RDB; not auto durable audit store\n";
p_c += "7) hybrid-examples.md — 13.6 four scenarios (Bun Redis+Postgres; Upstash+D1/Turso; Redis-only warnings; no-Redis Postgres)\n";
p_c += "8) testing.md — PAYMENTS_SDK_REDIS_URL, docker-compose, conformance, skips without Redis\n";
p_c += "9) guarantees / manifest notes aligned with REDIS_STORAGE_ADAPTER_MANIFEST\n\n";

p_c += "### monorepo wiring (required)\n";
p_c += "Root workspaces already packages/* so adapter-redis is auto-discovered.\n";
p_c += "Update scripts:\n";
p_c += "  build: ... && bun run --filter @paykernel/store-redis build\n";
p_c += "    (order: core → webhooks → testkit → sql-store → adapter-postgres → adapter-redis)\n";
p_c += "  typecheck: include adapter-redis filter\n";
p_c += "  test: include packages/store-redis path\n";
p_c += "  test:adapter-redis script optional but recommended\n";
p_c += "  lint already covers packages/*/src\n";
p_c += "Run bun install after package creation.\n";
p_c += "Run bun run check:boundaries — must pass.\n";
p_c += "Emphasize Redis is optional; PostgreSQL adapter alone can satisfy contracts.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:13-drivers-tests", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:13-docs-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 13 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 14+ adapters or reconciliation package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/store-redis exists as @paykernel/store-redis (publishable).\n";
p_int += "2) createRedisIdempotencyStore / createRedisWebhookInboxStore / createRedisReconciliationStore implement full Phase 9 contracts.\n";
p_int += "3) Subpath exports: /bun, /upstash, /ioredis, /node-redis present in package.json exports.\n";
p_int += "4) Root entry has ZERO static imports of optional drivers (ioredis, redis, @upstash/redis, Bun Redis).\n";
p_int += "5) Depends on testkit only for contracts (not sql-store); core/webhooks/adapter-postgres do NOT depend on adapter-redis.\n";
p_int += "6) RedisCommandPort is the only store dependency on Redis; all bindings adapt to it.\n";
p_int += "7) Atomic claims use Lua scripts with tagged results; not get-then-set in JS.\n";
p_int += "8) Injectable clock: now passed into scripts as ARGV for FakeClock.\n";
p_int += "9) StorageAdapterManifest: multi-host, durability configuration-dependent, strong claims, honest notes for 4 durability levels.\n";
p_int += "10) Key design: prefixes, tenant, version, hash tags, TTL, size limits; Bun rejects cluster config.\n";
p_int += "11) Conformance suites wired (skip without Redis; pass with Redis).\n";
p_int += "12) Concurrent claim / Lua atomicity / stale lease / TTL / Bun cluster-reject / binding parity tests exist.\n";
p_int += "13) Docs: overview, crash-boundaries, drivers, scripts-atomicity, key-design, persistence, hybrid-examples, testing, README, CHANGELOG.\n";
p_int += "14) monorepo.md + workspace-boundaries.md updated; root scripts include package; Redis remains optional.\n";
p_int += "15) boundaries checker includes redis and @upstash/redis in ADAPTER_OPTIONAL_DRIVERS.\n";
p_int += "16) Phase 0-12 safety: typecheck, tests core+testkit+webhooks+sql-store+adapter-postgres+adapter-redis, build, boundaries, runtime portability green.\n";
p_int += "17) exactOptionalPropertyTypes clean.\n";
p_int += "18) public-api.test freezes exports; root no-driver assertion.\n";
p_int += "19) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "20) If Stream A failed, implement the full adapter package yourself — Phase 13 cannot ship without it.\n";
p_int += "21) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap).\n";
p_int += "22) If live Redis is available (check env or start docker), run integration suite and fix failures.\n";
p_int += "    If not available, ensure skip path is correct and document how CI enables it.\n";
p_int += "23) Ensure package builds dist for root + 4 subpaths.\n";
p_int += "24) Never make Redis a mandatory monorepo dependency for core/webhooks consumers.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase13",
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
p_ver += "Verify Phase 13 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/store-redis/dist/index.js && test -f packages/core/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence package @paykernel/store-redis exists with three store factories\n";
p_ver += "12) Evidence package.json exports ./bun ./upstash ./ioredis ./node-redis\n";
p_ver += "13) Evidence root entry does not import ioredis/redis/@upstash/redis (grep)\n";
p_ver += "14) Evidence RedisCommandPort + Lua scripts for reserve/claim/renew/complete/fail\n";
p_ver += "15) Evidence no get-then-set claim path in stores (grep GET then SET patterns; scripts are atomic)\n";
p_ver += "16) Evidence StorageAdapterManifest multi-host configuration-dependent strong claims\n";
p_ver += "17) Evidence key design module + Bun cluster reject\n";
p_ver += "18) Evidence conformance tests exist (skip or pass with Redis)\n";
p_ver += "19) Evidence concurrent claim, stale lease, TTL, binding parity tests\n";
p_ver += "20) Evidence docs: persistence, hybrid-examples, drivers, crash-boundaries, scripts-atomicity, key-design, testing\n";
p_ver += "21) Evidence core/webhooks/adapter-postgres package.json have no adapter-redis dep\n";
p_ver += "22) Evidence monorepo scripts include adapter-redis\n";
p_ver += "23) Evidence Redis remains optional (SDK works without adapter-redis install for apps using postgres only)\n";
p_ver += "24) Evidence no Phase 14 adapter packages created\n";
p_ver += "25) If PAYMENTS_SDK_REDIS_URL or REDIS_URL or VALKEY_URL is set, integration tests must pass not skip\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- package_ok: package exists with correct name and build\n";
p_ver += "- factories_ok: three createRedis* factories implement contracts\n";
p_ver += "- driver_subpaths_ok: four subpaths exported\n";
p_ver += "- root_no_drivers_ok: root has no optional driver static imports\n";
p_ver += "- command_port_ok: RedisCommandPort used by stores\n";
p_ver += "- lua_atomic_ok: Lua scripts for claim transitions; tagged results; no JS get-set claim\n";
p_ver += "- key_design_ok: prefixes/namespaces/hash tags/TTL/limits; Bun rejects cluster\n";
p_ver += "- manifest_ok: honest multi-host configuration-dependent strong claims + durability notes\n";
p_ver += "- conformance_ok: suites wired and pass (or skip without Redis, pass with Redis)\n";
p_ver += "- persistence_docs_ok: four durability distinctions documented\n";
p_ver += "- hybrid_docs_ok: four hybrid/no-Redis examples documented\n";
p_ver += "- docs_ok: full docs set + monorepo links\n";
p_ver += "- compat_ok: Phase 0-12 green; boundaries; no illegal deps; Redis optional\n";
p_ver += "Set ok=true only if typecheck, tests (all packages), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase13",
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
    write_scratch_file("phase13-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 13 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 13 — each PASS or BLOCKING:\n";
p_gate += "A1) Bun native Redis/Valkey is a first-class supported binding.\n";
p_gate += "    Evidence: /bun subpath; injected client; send() for scripts; offline queue control; docs Cluster/Sentinel unsupported;\n";
p_gate += "    tests reject cluster config; integration matrix notes Redis 7.2+/Valkey.\n";
p_gate += "A2) Upstash and standard Redis clients share equivalent contract behavior.\n";
p_gate += "    Evidence: /upstash /ioredis /node-redis; shared stores via RedisCommandPort; parity tests or shared conformance.\n";
p_gate += "A3) atomicity does not depend on client-side sequencing.\n";
p_gate += "    Evidence: Lua scripts for reserve/claim/renew/complete/fail; no GET-then-SET claim in JS; tagged results.\n";
p_gate += "A4) persistence and topology limitations are explicit.\n";
p_gate += "    Evidence: durability configuration-dependent in manifest; persistence.md four levels; Bun rejects cluster; hybrid docs.\n";
p_gate += "A5) applications can use the SDK without installing or operating Redis.\n";
p_gate += "    Evidence: core/webhooks have no redis dep; adapter-postgres standalone path; docs say Redis optional; monorepo still builds without Redis server.\n";
p_gate += "A6) no Redis driver is imported from the package root.\n";
p_gate += "    Evidence: grep root index; boundaries check; public-api test.\n\n";
p_gate += "Also require Phase 13 sections 13.1-13.7 deliverables:\n";
p_gate += "- 13.1 Bun binding complete\n";
p_gate += "- 13.2 atomic Lua scripts for all listed transitions\n";
p_gate += "- 13.3 shared RedisCommandPort only (not large generic abstraction)\n";
p_gate += "- 13.4 key design complete; Bun rejects cluster\n";
p_gate += "- 13.5 persistence caveats + manifest honesty\n";
p_gate += "- 13.6 hybrid examples docs\n";
p_gate += "- 13.7 full test matrix as practical (skip without Redis; pass with Redis)\n";
p_gate += "- Injectable clock for conformance\n";
p_gate += "- Phase 0-12 safety net still green; boundaries; no core/webhooks/adapter-postgres → adapter-redis\n";
p_gate += "- No Phase 14 packages\n";
p_gate += "- No logical bugs: get/set claim race; secrets unbounded; root importing drivers;\n";
p_gate += "  FakeClock ignored; dishonest durable-only audit claim; Pub/Sub correctness; offline queue replay ambiguity;\n";
p_gate += "  Bun accepting cluster; Redis mandatory.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis\n";
p_gate += "  bun run typecheck; check:boundaries; focused adapter-redis tests.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/store-redis/docs/phase-13-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-13-gate-report.md (full or pointer + verdict summary).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase13-adversarial",
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
    write_scratch_file("phase13-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 13 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 13 only — no Phase 14 adapters, no reconciliation package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete packages/store-redis: factories, subpaths, Lua atomic scripts, RedisCommandPort,\n";
    p_fix += "key design, Bun binding, Upstash/ioredis/node-redis, conformance, docs, monorepo wiring as needed.\n";
    p_fix += "Preserve Phase 0-12 and adapter-postgres.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase13-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 13 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm all 13.1-13.7 deliverables and acceptance criteria A1-A6 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase13-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase13-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 13 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A6 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/store-redis/docs/phase-13-gate-report.md and packages/core/docs/baseline/phase-13-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 13.1-13.7 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase13-final",
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
        write_scratch_file("phase13-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 13 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 13,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
