let meta = #{
    name: "phase-4-testkit",
    description: "Phase 4 test kit: critic, implement testkit package (conformance, mock gateway, storage harness, fixtures, memory store), integrate, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 4 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "scaffold testkit + mock gateway + conformance + storage harness + fixtures + memory store" },
        #{ title: "Integrate", detail: "wire monorepo, root scripts, core wiring, docs; keep green" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, boundaries, suite evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 4" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 4 (test kit, fault injection, mock gateway) for PayKernel monorepo",
};

let critic_schema = #{
    "type": "object",
    "required": ["gaps", "already_present", "stream_plan", "risks", "summary"],
    "properties": #{
        "gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "already_present": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
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
    "required": ["ok", "typecheck_ok", "tests_ok", "build_ok", "boundaries_ok", "testkit_exports_ok", "conformance_ok", "mock_gateway_ok", "storage_harness_ok", "fixture_safety_ok", "memory_store_ok", "builtin_applicable_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "pack_ok": #{ "type": "boolean" },
        "testkit_exports_ok": #{ "type": "boolean" },
        "conformance_ok": #{ "type": "boolean" },
        "mock_gateway_ok": #{ "type": "boolean" },
        "storage_harness_ok": #{ "type": "boolean" },
        "fixture_safety_ok": #{ "type": "boolean" },
        "memory_store_ok": #{ "type": "boolean" },
        "builtin_applicable_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 4 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 4 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 4 — Test Kit, Fault Injection, and Mock Gateway\" completely\n";
p_critic += "(Objective, Package @paykernel/testkit, Tasks 4.1-4.5, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4) and Package Boundary Rules (5.1).\n";
p_critic += "Phases 0-3 are complete — preserve baselines, monorepo, plugin architecture, capabilities, pack validation.\n";
p_critic += "Do NOT plan Phase 5 money model, Phase 6 typed results rewrite, new real providers, or gateway extraction packages.\n\n";
p_critic += "Audit against EVERY Phase 4 task and acceptance criterion:\n\n";
p_critic += "4.1 Gateway Conformance Suite — runGatewayConformanceSuite({ name, createGateway, capabilities, fixtures })\n";
p_critic += "    Must cover: amount conversion; status normalization; decline and provider-error mapping;\n";
p_critic += "    network failure and timeout behavior; safe retry behavior; idempotency behavior;\n";
p_critic += "    webhook verification and malformed webhook rejection; event normalization;\n";
p_critic += "    partial capture and refund; logging redaction; request cancellation; indeterminate outcomes.\n\n";
p_critic += "4.2 Scriptable Mock Gateway — mockGateway({ createPayment: [{outcome:...}, ...] })\n";
p_critic += "    Support: deterministic scripted outcomes; latency and timeout simulation;\n";
p_critic += "    duplicate and out-of-order webhook generation; provider-side success + client-side timeout;\n";
p_critic += "    partial captures and refunds; request history assertions; webhook signature helpers.\n\n";
p_critic += "4.3 Storage Conformance Harness —\n";
p_critic += "    runWebhookInboxStoreConformanceSuite({ createStore });\n";
p_critic += "    runIdempotencyStoreConformanceSuite({ createStore });\n";
p_critic += "    runReconciliationStoreConformanceSuite({ createStore });\n";
p_critic += "    Support: real concurrency where driver supports it; deterministic fake-clock lease expiry;\n";
p_critic += "    process-crash boundary simulation; duplicate key conflicts; payload hash conflicts;\n";
p_critic += "    cleanup and retention tests; transaction rollback tests.\n";
p_critic += "    NOTE: packages/webhooks and packages/reconciliation do NOT exist yet.\n";
p_critic += "    Contracts for stores MUST be defined in testkit (or minimal shared contracts) so future\n";
p_critic += "    adapters implement them. Do not invent fake production storage packages.\n\n";
p_critic += "4.4 Fixture Safety Utilities — remove secrets/PII; reject committed fixtures matching secret patterns;\n";
p_critic += "    version fixture schemas.\n\n";
p_critic += "4.5 Test-Only In-Memory Store — deterministic in-memory impl in testkit for unit tests/examples;\n";
p_critic += "    fake time, lease tokens, conflicts, crash simulation; clearly NON-PRODUCTION / NON-DISTRIBUTED.\n\n";
p_critic += "Acceptance criteria:\n";
p_critic += "- custom gateways and stores can be validated through shared suites\n";
p_critic += "- applications can test complex payment behavior without real providers\n";
p_critic += "- all built-in gateways pass applicable conformance tests\n\n";
p_critic += "Inspect thoroughly:\n";
p_critic += "- packages/ (only core exists today)\n";
p_critic += "- packages/core/src/gateways/* (interface, base, capabilities, stripe/moyasar/paypal/paymob)\n";
p_critic += "- packages/core/src/types/*, errors.ts, utils/logger.ts, utils/currency.ts, client.ts\n";
p_critic += "- package.json workspaces, monorepo docs, boundary checker (already knows payments-testkit)\n";
p_critic += "- scripts/check-workspace-boundaries.ts, docs/workspace-boundaries.md, docs/monorepo.md\n";
p_critic += "- phase-3-gate-report.md and capability-claims.test.ts for patterns\n\n";
p_critic += "List concrete GAPS. List ALREADY_PRESENT. stream_plan for implement order.\n";
p_critic += "risks: testkit depending on core incorrectly (core must NOT depend on testkit);\n";
p_critic += "built-in conformance calling real APIs; secret leakage in fixtures; racey in-memory claims;\n";
p_critic += "conformance too weak/too strict; breaking Phase 0-3; node-only assumptions in portable testkit;\n";
p_critic += "storage contracts that cannot be satisfied later; await-in-sync-tx anti-pattern in docs/examples.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase4-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase4-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 4 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 4\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 4 foundation in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core package is packages/core = @paykernel/core (currently 0.8.0).\n";
common += "PHASE 4 ONLY: Create @paykernel/testkit under packages/testkit.\n";
common += "Do NOT start Phase 5 money model, Phase 6 outcome unions rewrite, extract gateways, or add new PSPs.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-3: monorepo, baselines, plugin architecture,\n";
common += "capabilities/supports, createPaymentClient, registry, factories, pack validation, coverage thresholds.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change.\n";
common += "2) No unsafe mutation retries without native idempotency or atomic dedup.\n";
common += "3) Never convert uncertain outcomes into failure — support indeterminate explicitly.\n";
common += "4) Do not hide provider differences.\n";
common += "5) No secret leakage in logs, errors, fixtures, snapshots.\n";
common += "6) No framework coupling.\n";
common += "7) No Node-only assumptions in portable packages (testkit is portable unless marked otherwise).\n";
common += "8) Keep 0.x backward compat for core.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) Atomicity for stores = engine/in-memory atomic ops, NOT get-then-set races.\n";
common += "11) No await inside sync SQLite tx (N/A for pure memory but document correctly).\n";
common += "12) Prepared statements when SQL appears (N/A for memory).\n";
common += "13) Do not store raw provider payloads by default in memory store examples.\n";
common += "14) Portable timestamps/ids (ISO strings or opaque strings; avoid JS number for 64-bit ids).\n";
common += "15) Every store adapter must pass same conformance suite later — design contracts for that.\n";
common += "16) Document crash boundaries on memory store.\n";
common += "17) Core must NOT depend on testkit. Testkit MAY depend on core via workspace:*\n";
common += "18) Boundary checker already treats @paykernel/testkit as portable.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: package scaffold + public API surface + monorepo wiring
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE SCAFFOLD + PUBLIC SURFACE + MONOREPO WIRING.\n";
p_a += "You own packages/testkit package.json, tsconfig, build, index exports, root scripts, docs updates.\n\n";

p_a += "### 1) Create packages/testkit/\n";
p_a += "package.json for @paykernel/testkit:\n";
p_a += "- version: align with monorepo (0.8.0 or 0.1.0 — prefer 0.8.0 workspace alignment OR 0.1.0 for first ship;\n";
p_a += "  use 0.1.0 if treating as new package; document in CHANGELOG)\n";
p_a += "- private: false (publishable later), type: module\n";
p_a += "- main/types/exports pointing at dist/\n";
p_a += "- files: dist, README.md, LICENSE\n";
p_a += "- dependencies: { \"@paykernel/core\": \"workspace:*\" }\n";
p_a += "- scripts: build, build:types, test, typecheck, prepublishOnly\n";
p_a += "- engines node>=18 bun>=1.0\n";
p_a += "- license MIT, repository same as core\n";
p_a += "- keywords: payments, testkit, mock gateway, conformance\n";
p_a += "Copy LICENSE from root or core.\n";
p_a += "tsconfig.json extends ../../tsconfig.base.json, rootDir src, outDir dist, exclude tests from emit if following core.\n";
p_a += "README.md: purpose, NON-PRODUCTION notes for memory store, quickstart mockGateway + conformance.\n";
p_a += "CHANGELOG.md initial entry.\n\n";

p_a += "### 2) Source layout (create stubs if streams B-D fill bodies — prefer complete skeleton):\n";
p_a += "packages/testkit/src/\n";
p_a += "  index.ts                 # public exports only\n";
p_a += "  mock/\n";
p_a += "    mock-gateway.ts\n";
p_a += "    mock-gateway.test.ts\n";
p_a += "    outcomes.ts             # scripted outcome types\n";
p_a += "    webhook-helpers.ts\n";
p_a += "  conformance/\n";
p_a += "    gateway-conformance.ts\n";
p_a += "    gateway-conformance.test.ts\n";
p_a += "    types.ts\n";
p_a += "  storage/\n";
p_a += "    contracts.ts            # WebhookInboxStore, IdempotencyStore, ReconciliationStore interfaces\n";
p_a += "    webhook-inbox-conformance.ts\n";
p_a += "    idempotency-conformance.ts\n";
p_a += "    reconciliation-conformance.ts\n";
p_a += "    storage-conformance.test.ts\n";
p_a += "  memory/\n";
p_a += "    memory-stores.ts        # in-memory impls of all three contracts\n";
p_a += "    memory-stores.test.ts\n";
p_a += "    fake-clock.ts\n";
p_a += "  fixtures/\n";
p_a += "    fixture-safety.ts\n";
p_a += "    fixture-safety.test.ts\n";
p_a += "    schema-version.ts\n";
p_a += "  builtin/\n";
p_a += "    builtin-conformance.test.ts  # run applicable suite against built-ins\n\n";

p_a += "### 3) Monorepo wiring (root):\n";
p_a += "- workspaces already packages/* — no change needed if testkit under packages/\n";
p_a += "- Root package.json scripts:\n";
p_a += "  \"test\": \"bun test packages/core packages/testkit\"\n";
p_a += "  \"test:coverage\": include both or document core coverage + testkit tests separately\n";
p_a += "  \"typecheck\": filter both packages OR \"bun run --filter '*' typecheck\" carefully\n";
p_a += "  Prefer: keep core-specific scripts; add testkit:\n";
p_a += "    \"typecheck\": \"bun run --filter @paykernel/core typecheck && bun run --filter @paykernel/testkit typecheck\"\n";
p_a += "    \"build\": build core then testkit (testkit needs core types)\n";
p_a += "    \"test\": \"bun test packages/core packages/testkit\"\n";
p_a += "- Root tsconfig.json references: add packages/testkit\n";
p_a += "- Update docs/monorepo.md layout to include testkit\n";
p_a += "- Update docs/workspace-boundaries.md future -> present for testkit\n";
p_a += "- bun install after package.json so lockfile updates\n\n";

p_a += "### 4) Public exports from @paykernel/testkit:\n";
p_a += "Must export (names may match exactly):\n";
p_a += "- mockGateway, MockGateway, MockGatewayOptions, ScriptedOutcome types\n";
p_a += "- runGatewayConformanceSuite, GatewayConformanceOptions, GatewayConformanceReport\n";
p_a += "- runWebhookInboxStoreConformanceSuite, runIdempotencyStoreConformanceSuite, runReconciliationStoreConformanceSuite\n";
p_a += "- store contract types: WebhookInboxStore, IdempotencyStore, ReconciliationStore (+ related record types)\n";
p_a += "- createMemoryWebhookInboxStore, createMemoryIdempotencyStore, createMemoryReconciliationStore\n";
p_a += "  (or single createMemoryStores() factory) + FakeClock / createFakeClock\n";
p_a += "- sanitizeFixture, assertFixtureSafe, FIXTURE_SCHEMA_VERSION, redactSecretsFromFixture\n";
p_a += "Document NON_PRODUCTION banner on memory store exports.\n\n";

p_a += "### 5) Build\n";
p_a += "Mirror core build pattern: bun build src/index.ts --outdir dist --target node --format esm --packages external\n";
p_a += "+ tsc emitDeclarationOnly. packages external so @paykernel/core stays external.\n";
p_a += "After scaffold: bun install; ensure packages/testkit typechecks even if other streams fill logic.\n";
p_a += "If implementing only skeleton, provide compiling stubs that throw 'not implemented' ONLY if other streams will fill;\n";
p_a += "prefer implementing complete working APIs in this stream if time — streams B-D will flesh out.\n";
p_a += "Do NOT make core import testkit.\n";

let a_result = agent(p_a, #{
    label: "impl:4-scaffold-surface",
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

// Parallel streams B, C, D, E
log("Implementing Phase 4 mock, conformance, storage, fixtures in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — SCRIPTABLE MOCK GATEWAY (Task 4.2).\n";
p_b += "PRECONDITION: Stream A may have scaffolded packages/testkit. If missing, create packages/testkit fully.\n";
p_b += "OWN: packages/testkit/src/mock/* and tests. Implement real mockGateway — not stubs.\n\n";
p_b += "API (match roadmap):\n";
p_b += "```ts\n";
p_b += "const mock = mockGateway({\n";
p_b += "  name?: string; // default 'mock'\n";
p_b += "  capabilities?: Partial<GatewayCapabilities> | GatewayCapabilities;\n";
p_b += "  createPayment?: ScriptedStep[];\n";
p_b += "  capturePayment?: ScriptedStep[];\n";
p_b += "  refundPayment?: ScriptedStep[];\n";
p_b += "  voidPayment?: ScriptedStep[];\n";
p_b += "  getPayment?: ScriptedStep[];\n";
p_b += "  // or per-operation scripts\n";
p_b += "  defaultLatencyMs?: number;\n";
p_b += "  webhookSecret?: string;\n";
p_b += "  clock?: FakeClock;\n";
p_b += "});\n";
p_b += "```\n";
p_b += "ScriptedStep / outcome examples:\n";
p_b += "- { outcome: 'succeeded' } | 'requires_action' | 'declined' | 'failed' | 'indeterminate' | 'timeout' | 'network_error'\n";
p_b += "- { outcome: 'succeeded', delayMs: 50, amount?: number, status?: PaymentStatus }\n";
p_b += "- { outcome: 'provider_success_client_timeout' } // provider applied; client sees timeout/indeterminate\n";
p_b += "- { throw: Error | 'abort' }\n";
p_b += "Steps are consumed FIFO per operation; after script exhaustion, default to last step or explicit defaultOutcome.\n\n";
p_b += "MockGateway MUST implement PaymentGateway from @paykernel/core:\n";
p_b += "- name, capabilities (frozen via defineGatewayCapabilities), supports()\n";
p_b += "- createPayment, capturePayment, refundPayment, voidPayment?, getPayment?, getPaymentStatus?\n";
p_b += "- verifyWebhook, parseWebhookEvent\n";
p_b += "Prefer extending BaseGateway OR implementing PaymentGateway cleanly with redacting logger support.\n";
p_b += "Import types from @paykernel/core only (workspace dep).\n\n";
p_b += "REQUIRED BEHAVIORS:\n";
p_b += "1) Deterministic scripted outcomes in order.\n";
p_b += "2) latencyMs / delayMs simulation via await (use FakeClock if injected for deterministic tests, else real setTimeout).\n";
p_b += "3) timeout simulation: reject or return indeterminate after delay; AbortSignal support for request cancellation.\n";
p_b += "4) provider-side success followed by client-side timeout: record internal succeeded payment but surface timeout/indeterminate to caller.\n";
p_b += "5) Partial captures/refunds: track remaining capturable/refundable amounts; reject over-capture/over-refund with clear errors.\n";
p_b += "6) Request history: mock.history or mock.getHistory() with operation, params (redacted), result, timestamp.\n";
p_b += "   assertHistory([...]) helper or expect helpers.\n";
p_b += "7) Webhook helpers:\n";
p_b += "   - signWebhook(payload, secret?) -> signature string\n";
p_b += "   - generateWebhookEvent({ type, paymentId, status, ... }) normalized + raw\n";
p_b += "   - generateDuplicateWebhooks / generateOutOfOrderWebhooks for testing inbox logic\n";
p_b += "   - verifyWebhook uses HMAC (Web Crypto or pure portable impl) — no Node-only crypto required if avoidable;\n";
p_b += "     node:crypto is allowlisted in portable policy if needed (core already uses it).\n";
p_b += "8) Logging redaction: use createRedactingLogger if available from core, or ensure history redacts secrets.\n";
p_b += "9) Indeterminate outcome: never map timeout after submit to failed; use success:false + status that does not imply decline, or document result shape.\n";
p_b += "   Prefer GatewayPaymentResult with success:false and a clear status or error code for declines;\n";
p_b += "   for indeterminate, return a result or throw a dedicated IndeterminatePaymentError if core has one;\n";
p_b += "   if core lacks Indeterminate type (Phase 6), use a well-documented result: { success: false, status: 'processing', error?: { code: 'INDETERMINATE', ... }, reconciliationRequired: true } in rawResponse/metadata without lying that payment failed at provider.\n\n";
p_b += "TESTS (mock-gateway.test.ts) covering every support bullet above with bun:test.\n";
p_b += "No real network. No secrets in fixtures (use sk_test_fake etc that fixture safety allows, or placeholders).\n";
p_b += "After implement: cd packages/testkit && bun test\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — GATEWAY CONFORMANCE SUITE (Task 4.1) + built-in applicable runner.\n";
p_c += "OWN: packages/testkit/src/conformance/* and packages/testkit/src/builtin/*\n";
p_c += "If package missing, create it. Implement runGatewayConformanceSuite for real.\n\n";
p_c += "API:\n";
p_c += "```ts\n";
p_c += "export type GatewayConformanceOptions = {\n";
p_c += "  name: string;\n";
p_c += "  createGateway: () => PaymentGateway | Promise<PaymentGateway>;\n";
p_c += "  capabilities?: GatewayCapabilities; // expected claims; defaults to gateway.capabilities\n";
p_c += "  fixtures?: GatewayConformanceFixtures;\n";
p_c += "  /** Skip suites that need live network / provider HTTP */\n";
p_c += "  mode?: 'full' | 'structural' | 'applicable';\n";
p_c += "  /** Optional: only run named cases */\n";
p_c += "  include?: string[];\n";
p_c += "  exclude?: string[];\n";
p_c += "};\n";
p_c += "export type GatewayConformanceReport = {\n";
p_c += "  name: string;\n";
p_c += "  passed: string[];\n";
p_c += "  failed: Array<{ case: string; error: string }>;\n";
p_c += "  skipped: Array<{ case: string; reason: string }>;\n";
p_c += "  ok: boolean;\n";
p_c += "};\n";
p_c += "export async function runGatewayConformanceSuite(opts: GatewayConformanceOptions): Promise<GatewayConformanceReport>;\n";
p_c += "```\n\n";
p_c += "CASES (each is a named case; skip when not applicable by capabilities or missing fixtures):\n";
p_c += "1) amount_conversion — if fixtures.amountCases or gateway is mock: createPayment with major units and assert result.amount matches expected major units (within documented precision for 0/2/3 decimal currencies via getCurrencyExponent from core).\n";
p_c += "2) status_normalization — fixtures map provider statuses to PaymentStatus union; for mock verify known scripts normalize.\n";
p_c += "3) decline_mapping — declined outcome yields success:false, not throw unless gateway design throws; document.\n";
p_c += "4) provider_error_mapping — failed/provider error maps to controlled failure (GatewayApiError or result).\n";
p_c += "5) network_failure — network_error script or fixture: does not claim paid.\n";
p_c += "6) timeout_behavior — timeout does not become silent success; preferably indeterminate or error without false failure claim if post-submit.\n";
p_c += "7) safe_retry — with idempotencyKey, scripted duplicate create does not double-charge (mock records one payment id).\n";
p_c += "8) idempotency_behavior — same key returns same gatewayId on retry when scripted.\n";
p_c += "9) webhook_verification — valid signature accepts; invalid rejects.\n";
p_c += "10) malformed_webhook_rejection — verifyWebhook false / parse throws or safe fail on garbage.\n";
p_c += "11) event_normalization — parseWebhookEvent returns WebhookEvent shape with required fields.\n";
p_c += "12) partial_capture — skip if !supports('partialCapture'); else capture partial amount updates remaining.\n";
p_c += "13) partial_refund — skip if !supports('partialRefunds').\n";
p_c += "14) logging_redaction — inject capturing logger; createPayment with secret-like metadata keys; assert redacted values in logs.\n";
p_c += "15) request_cancellation — AbortSignal aborts in-flight mock delay; PaymentAbortedError or AbortError; no paid result.\n";
p_c += "16) indeterminate_outcomes — timeout/indeterminate script never surfaces as success:true paid.\n";
p_c += "17) capabilities_parity — gateway.supports(k) === gateway.capabilities[k] for all keys.\n";
p_c += "18) claim_method_presence — if voids true then voidPayment function exists (reuse Phase 3 claim logic).\n\n";
p_c += "Fixtures type: optional webhook payloads, signature secrets, amount cases, status maps.\n";
p_c += "For mock gateway in full mode: ALL cases must pass.\n";
p_c += "For built-ins in applicable/structural mode:\n";
p_c += "- Always run capabilities_parity + claim_method_presence + supports consistency (no network).\n";
p_c += "- Webhook cases only if fixtures provide provider-shaped payload + secret/signature algorithm OR skip with reason.\n";
p_c += "- Do NOT call real Stripe/PayPal/etc APIs. Built-in createPayment without mock fetch will hang/fail — skip network ops with clear reason OR inject mock fetch if gateway accepts injectable fetch (check BaseGateway).\n";
p_c += "If BaseGateway has no injectable fetch, structural/applicable suite for built-ins is capabilities + method presence + optional webhook fixture tests only.\n\n";
p_c += "TESTS:\n";
p_c += "- gateway-conformance.test.ts: run full suite against mockGateway(...) and expect report.ok === true.\n";
p_c += "- builtin-conformance.test.ts: for each of stripe/moyasar/paypal/paymob factories with fake test keys,\n";
p_c += "  run applicable/structural suite; expect ok true (skipped cases allowed).\n";
p_c += "Use real factory create from core with dummy credentials (sk_test_..., etc).\n";
p_c += "Export suite from package index.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — STORAGE CONTRACTS + CONFORMANCE HARNESS (4.3) + IN-MEMORY STORES (4.5).\n";
p_d += "OWN: packages/testkit/src/storage/* and packages/testkit/src/memory/*\n";
p_d += "webhooks/reconciliation packages DO NOT EXIST — define contracts in testkit now.\n\n";
p_d += "### contracts.ts — minimal but production-shaped interfaces\n";
p_d += "Design for atomic single-statement claims (roadmap 3.3):\n\n";
p_d += "WebhookInboxStore:\n";
p_d += "- claimEvent(input: { eventId: string; gateway: string; payloadHash: string; leaseMs: number; leaseToken: string; now?: Date }): Promise<ClaimResult>\n";
p_d += "  ClaimResult = { status: 'acquired' } | { status: 'duplicate'; existingHash: string } | { status: 'in_progress'; leaseExpiresAt: string } | { status: 'hash_conflict'; existingHash: string }\n";
p_d += "- completeEvent(eventId: string, leaseToken: string): Promise<boolean>\n";
p_d += "- failEvent(eventId: string, leaseToken: string, error: { code: string; message: string /* redacted */ }): Promise<boolean>\n";
p_d += "- renewLease(eventId: string, leaseToken: string, leaseMs: number): Promise<boolean>\n";
p_d += "- getEvent(eventId: string): Promise<InboxRecord | null>\n";
p_d += "- cleanup(before: Date | string): Promise<number> // retention\n";
p_d += "Atomic claim: same eventId second claim => duplicate if completed or same hash in progress; hash_conflict if different hash; acquire if expired lease with new token.\n\n";
p_d += "IdempotencyStore:\n";
p_d += "- claim(key: string, requestHash: string, leaseMs: number, leaseToken: string): Promise<IdempotencyClaimResult>\n";
p_d += "  acquired | in_progress | completed(resultRef) | conflict (same key different requestHash)\n";
p_d += "- complete(key: string, leaseToken: string, resultRef: string): Promise<boolean>\n";
p_d += "- get(key: string): Promise<IdempotencyRecord | null>\n";
p_d += "- cleanup(before: Date | string): Promise<number>\n\n";
p_d += "ReconciliationStore:\n";
p_d += "- enqueue(job: { id: string; gateway: string; providerRequestId?: string; paymentRef?: string; reason: string; notBefore?: string }): Promise<'queued' | 'duplicate'>\n";
p_d += "- claimNext(workerId: string, leaseMs: number, now?: Date): Promise<ReconciliationJob | null>\n";
p_d += "- complete(id: string, workerId: string): Promise<boolean>\n";
p_d += "- fail(id: string, workerId: string, error: { code: string; message: string }): Promise<boolean>\n";
p_d += "- get(id: string): Promise<ReconciliationJob | null>\n";
p_d += "- cleanup(before: Date | string): Promise<number>\n\n";
p_d += "Use string ISO timestamps. Lease tokens are opaque strings. No process-local non-atomic get/set for claims.\n\n";
p_d += "### Conformance suites\n";
p_d += "runWebhookInboxStoreConformanceSuite({ createStore, concurrency?: boolean, clock?: FakeClock })\n";
p_d += "runIdempotencyStoreConformanceSuite({ createStore, ... })\n";
p_d += "runReconciliationStoreConformanceSuite({ createStore, ... })\n";
p_d += "Each returns { ok, passed, failed, skipped } similar to gateway report.\n";
p_d += "Tests MUST cover:\n";
p_d += "- concurrent double-claim (Promise.all two claims; exactly one acquired when concurrent)\n";
p_d += "- fake-clock lease expiry then re-acquire with new token\n";
p_d += "- crash simulation: acquire then process crash (no complete) then renew/reclaim after expiry\n";
p_d += "- duplicate key same hash\n";
p_d += "- payload/request hash conflicts\n";
p_d += "- cleanup/retention removes old completed records\n";
p_d += "- transaction rollback: if store supports withTransaction, rollback leaves no partial claim;\n";
p_d += "  memory store may implement withTransaction that rolls back on throw\n\n";
p_d += "### memory-stores.ts + fake-clock.ts (4.5)\n";
p_d += "createFakeClock(start?: Date) => { now(), advance(ms), set(date) }\n";
p_d += "In-memory stores use FakeClock when provided.\n";
p_d += "Atomicity: synchronize claim paths with a mutex/queue or single-threaded careful state machine;\n";
p_d += "in JS single-thread, still make claim check+set synchronous without await between check and set.\n";
p_d += "Banner in JSDoc and README:\n";
p_d += "  /** @remarks NON-PRODUCTION. Test-only. Not safe for multi-process or distributed use. */\n";
p_d += "export const MEMORY_STORE_WARNING = 'NON-PRODUCTION: in-memory store is for tests only' as const;\n";
p_d += "Crash simulation helper: store.simulateCrash?.() drops in-memory lease holder state optionally — or document that crash = abandon lease token without complete.\n";
p_d += "Implement withTransaction for memory that clones state and restores on throw (rollback test).\n\n";
p_d += "TESTS must pass run*ConformanceSuite against memory implementations with ok===true.\n";

let p_e = "";
p_e += common;
p_e += "STREAM E — FIXTURE SAFETY (4.4) + docs + public API tests.\n";
p_e += "OWN: packages/testkit/src/fixtures/* , README sections, packages/testkit public-api.test.ts,\n";
p_e += "packages/core/docs updates mentioning testkit, monorepo docs if Stream A missed them.\n\n";
p_e += "### fixture-safety.ts\n";
p_e += "```ts\n";
p_e += "export const FIXTURE_SCHEMA_VERSION = 1 as const; // or '1'\n";
p_e += "export type FixtureEnvelope<T> = { schemaVersion: typeof FIXTURE_SCHEMA_VERSION; data: T; redacted?: boolean };\n";
p_e += "export function redactSecretsFromFixture<T>(value: T): T; // deep clone + redact sensitive keys\n";
p_e += "export function sanitizeFixture<T>(value: T): FixtureEnvelope<T>; // redact + wrap version\n";
p_e += "export function assertFixtureSafe(value: unknown): void; // throws if secret patterns found in strings\n";
p_e += "export function findSecretLeaks(value: unknown): string[]; // paths of leaks\n";
p_e += "```\n";
p_e += "Secret patterns (aligned with core logger intent, but fixture-oriented):\n";
p_e += "- sk_live_, rk_live_, whsec_ live secrets\n";
p_e += "- password/secret/token values that look real (long base64, etc.)\n";
p_e += "- PAN-like 13-19 digit card numbers (Luhn optional)\n";
p_e += "- emails in committed fixtures optional warning vs hard fail — prefer hard fail for sk_live and card numbers\n";
p_e += "Allow sk_test_, pk_test_, placeholders like 'test_secret', 'whsec_test_...'\n";
p_e += "assertFixtureSafe used in tests to reject unsafe fixtures.\n\n";
p_e += "TESTS: redact removes Authorization headers; assertFixtureSafe throws on sk_live_; allows sk_test_;\n";
p_e += "sanitizeFixture sets schemaVersion.\n\n";
p_e += "DOCS:\n";
p_e += "- packages/testkit/README.md complete usage\n";
p_e += "- packages/core/docs/plugin-architecture.md: replace \"Phase 4 testkit separate\" with pointer to @paykernel/testkit\n";
p_e += "- packages/core/docs/custom-gateways.md: mention runGatewayConformanceSuite for custom adapters\n";
p_e += "- docs/monorepo.md + workspace-boundaries.md update\n";
p_e += "- packages/core/docs/baseline/phase-4-gate-report.md will be written by Gate agent — do not invent PASS report\n\n";
p_e += "PUBLIC API TEST: import * from package root (src), assert expected exports exist.\n";
p_e += "Ensure index.ts re-exports all public symbols cleanly.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:4-mock-gateway", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:4-gateway-conformance", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "impl:4-storage-memory", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "impl:4-fixtures-docs", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 4 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 5+.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/testkit exists as @paykernel/testkit with package.json, tsconfig, LICENSE, README, src, build.\n";
p_int += "2) Depends on @paykernel/core workspace:*; core does NOT depend on testkit.\n";
p_int += "3) mockGateway implements PaymentGateway with scripted outcomes, latency/timeout, history, webhook helpers,\n";
p_int += "   partial capture/refund, indeterminate, AbortSignal cancellation.\n";
p_int += "4) runGatewayConformanceSuite covers all Task 4.1 behaviors; full suite passes on mock gateway.\n";
p_int += "5) Built-in gateways pass applicable/structural conformance (capabilities + claim presence; no live network).\n";
p_int += "6) Storage contracts defined; three conformance suites; memory stores pass all three.\n";
p_int += "7) Fake clock lease expiry works; concurrent claims safe; crash boundary documented; cleanup works;\n";
p_int += "   hash conflicts; withTransaction rollback on memory store.\n";
p_int += "8) Fixture safety: redact, assertFixtureSafe, schema version; tests pass.\n";
p_int += "9) Memory store clearly NON-PRODUCTION / NON-DISTRIBUTED.\n";
p_int += "10) Public exports complete from index.ts; public-api tests.\n";
p_int += "11) Root scripts: test includes testkit; typecheck includes testkit; build builds both.\n";
p_int += "12) bun install lockfile updated; check:boundaries passes.\n";
p_int += "13) docs monorepo + boundaries + plugin-architecture + custom-gateways updated.\n";
p_int += "14) Phase 0-3 still green for core (typecheck, tests, build).\n";
p_int += "15) No secret leakage; no core API breaks; no Phase 5 money types.\n";
p_int += "16) Fix logical bugs: race on memory claim; timeout mapped to paid; double charge on idempotent retry;\n";
p_int += "    fixture allowing sk_live; missing exports; circular deps; tests importing from dist before build.\n";
p_int += "17) Prefer tests import from src paths or package name after install; bun test resolves TS src.\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck (both packages)\n";
p_int += "    bun test packages/core packages/testkit\n";
p_int += "    bun run build (both)\n";
p_int += "    bun run check:boundaries\n";
p_int += "19) If Stream A failed, create full package yourself. Phase 4 cannot ship without packages/testkit.\n";
p_int += "20) Re-read PaymentGateway interface and BaseGateway so mock compiles against real core types.\n";
p_int += "21) exactOptionalPropertyTypes is on — respect optional props carefully.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase4",
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
p_ver += "Verify Phase 4 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck  (must include testkit)\n";
p_ver += "3) cd " + root + " && bun run typecheck:types  (core type tests still pass)\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core  (core coverage thresholds still hold)\n";
p_ver += "6) cd " + root + " && bun run build  (core + testkit dist)\n";
p_ver += "7) test -f packages/testkit/dist/index.js && test -f packages/testkit/dist/index.d.ts\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) Evidence packages/testkit package.json name is @paykernel/testkit\n";
p_ver += "10) Evidence mockGateway exported; runGatewayConformanceSuite exported; storage suites exported\n";
p_ver += "11) Evidence memory store NON-PRODUCTION marking\n";
p_ver += "12) Evidence fixture safety tests\n";
p_ver += "13) Evidence builtin applicable conformance tests exist and pass\n";
p_ver += "14) bun run validate:package still works for core (or pack:check + publint + attw)\n";
p_ver += "15) Spot-check: no packages/core dependency on testkit in package.json\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- testkit_exports_ok: public API complete\n";
p_ver += "- conformance_ok: suite exists + mock full suite passes\n";
p_ver += "- mock_gateway_ok: mock tests pass with required behaviors\n";
p_ver += "- storage_harness_ok: three suites pass on memory stores\n";
p_ver += "- fixture_safety_ok: fixture tests pass\n";
p_ver += "- memory_store_ok: memory store + fake clock + crash/lease tests\n";
p_ver += "- builtin_applicable_ok: built-in applicable conformance green\n";
p_ver += "Set ok=true only if typecheck, tests (core+testkit), build, boundaries, and all feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase4",
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
    write_scratch_file("phase4-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 4 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 4 — each PASS or BLOCKING:\n";
p_gate += "A1) Custom gateways and stores can be validated through shared suites.\n";
p_gate += "    Evidence: runGatewayConformanceSuite + three storage suites exported, documented, tested.\n";
p_gate += "A2) Applications can test complex payment behavior without real providers.\n";
p_gate += "    Evidence: mockGateway scripted outcomes, latency/timeout, webhooks, history, partials, indeterminate.\n";
p_gate += "A3) All built-in gateways pass applicable conformance tests.\n";
p_gate += "    Evidence: builtin-conformance tests for stripe/moyasar/paypal/paymob with ok reports.\n\n";
p_gate += "Also require Phase 4 tasks 4.1-4.5 deliverables:\n";
p_gate += "- 4.1 all listed behavior cases exist in suite (amount, status, decline, errors, network, timeout,\n";
p_gate += "  safe retry, idempotency, webhook verify/malformed, event norm, partial capture/refund,\n";
p_gate += "  logging redaction, cancellation, indeterminate)\n";
p_gate += "- 4.2 mock supports all listed features\n";
p_gate += "- 4.3 storage harness supports concurrency, fake-clock leases, crash boundaries, conflicts,\n";
p_gate += "  cleanup/retention, transaction rollback\n";
p_gate += "- 4.4 fixture safety utilities with versioned schemas\n";
p_gate += "- 4.5 in-memory store non-production marked with fake time, leases, conflicts, crash sim\n";
p_gate += "- Phase 0-3 safety net still green; core isolation (no testkit dep); boundaries pass\n";
p_gate += "- No logical bugs: false paid on timeout; non-atomic memory claims; secret fixtures; etc.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit; bun run typecheck; check:boundaries.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-4-gate-report.md\n";
p_gate += "(core baseline folder is where prior phase reports live; also acceptable packages/testkit/docs/phase-4-gate-report.md\n";
p_gate += " but prefer packages/core/docs/baseline/phase-4-gate-report.md for consistency).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase4-adversarial",
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
    write_scratch_file("phase4-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 4 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 4 only — no Phase 5 money, no new providers.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete testkit if incomplete: mock gateway, full conformance cases, storage harness,\n";
    p_fix += "memory stores, fixture safety, monorepo wiring, built-in applicable tests.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit\n";
    p_fix += "  bun run build && bun run check:boundaries\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase4-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 4 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit, build, check:boundaries.\n";
    p_re += "Confirm all 4.1-4.5 deliverables and acceptance criteria with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase4-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase4-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 4 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/core/docs/baseline/phase-4-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 4.1-4.5 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase4-final",
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
        write_scratch_file("phase4-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 4 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 4,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
