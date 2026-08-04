let meta = #{
    name: "phase-8-runtime",
    description: "Phase 8 Runtime Portability: critic, implement PaymentRuntime injection + Web APIs + AbortSignal + runtime matrix + export validation, integrate, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 8 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "PaymentRuntime, inject deps, Web Crypto/HMAC, AbortSignal, matrix tests, exports, docs" },
        #{ title: "Integrate", detail: "unify streams, public API, dual-compat, keep green" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, boundaries, runtime evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 8" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 8 (Runtime Portability) for PayKernel monorepo",
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
    "required": [
        "ok", "typecheck_ok", "tests_ok", "build_ok", "boundaries_ok",
        "payment_runtime_ok", "inject_ok", "web_apis_ok", "abort_signal_ok",
        "matrix_ok", "exports_ok", "webhook_portable_ok", "http_no_node_globals_ok",
        "compat_ok",
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
        "payment_runtime_ok": #{ "type": "boolean" },
        "inject_ok": #{ "type": "boolean" },
        "web_apis_ok": #{ "type": "boolean" },
        "abort_signal_ok": #{ "type": "boolean" },
        "matrix_ok": #{ "type": "boolean" },
        "exports_ok": #{ "type": "boolean" },
        "webhook_portable_ok": #{ "type": "boolean" },
        "http_no_node_globals_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 8 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 8 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 8 — Runtime Portability\" completely\n";
p_critic += "(Objective, Tasks 8.1-8.5, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially rule 7:\n";
p_critic += "No Node-only assumptions in portable packages. Use Web APIs or injectable runtime abstractions.\n";
p_critic += "Phases 0-7 are COMPLETE — preserve baselines, monorepo, plugin architecture, capabilities,\n";
p_critic += "testkit, money model, typed outcomes, PaymentEvent/webhook dual-write, pack validation.\n";
p_critic += "Do NOT start Phase 9 store contracts, Phase 10 webhook inbox package, new real providers,\n";
p_critic += "or gateway extraction packages. Do NOT rewrite Phase 5-7 money/outcomes/events unless required for runtime wiring.\n\n";

p_critic += "Audit against EVERY Phase 8 task and acceptance criterion:\n\n";

p_critic += "8.1 Inject Runtime Dependencies — target model:\n";
p_critic += "```ts\n";
p_critic += "interface PaymentRuntime {\n";
p_critic += "  fetch: typeof globalThis.fetch;\n";
p_critic += "  crypto: CryptoProvider;\n";
p_critic += "  clock: Clock;\n";
p_critic += "  randomUUID(): string;\n";
p_critic += "}\n";
p_critic += "```\n";
p_critic += "Today: GatewayContext has fetch/crypto/clock/uuid but factories only pass hooks+logger;\n";
p_critic += "gateways call global fetch and node:crypto directly. CreatePaymentClientOptions has no runtime field.\n\n";

p_critic += "8.2 Prefer Web APIs — Prefer Web Crypto, fetch, Headers, AbortController, web streams.\n";
p_critic += "Keep narrowly scoped fallbacks only when unavoidable.\n";
p_critic += "Today: stripe/paymob/moyasar import node:crypto (createHmac, timingSafeEqual, randomUUID);\n";
p_critic += "moyasar imports node:buffer; payment-event hashWebhookPayload uses node:crypto createHash;\n";
p_critic += "build uses --target node.\n\n";

p_critic += "8.3 Add AbortSignal — Every network operation must accept cancellation through its operation context.\n";
p_critic += "Today: gateways create internal AbortController for timeout only; CreatePaymentParams / CaptureParams /\n";
p_critic += "RefundParams / VoidParams / GetPaymentParams have NO signal?: AbortSignal field.\n\n";

p_critic += "8.4 Runtime Test Matrix — Test min Node, Node LTS, min+latest Bun, Deno smoke, CF Workers smoke.\n";
p_critic += "Today: consumer-smoke.mjs covers Bun+Node import of packed tarball; no Deno/Workers matrix;\n";
p_critic += "no explicit multi-version CI matrix in repo scripts.\n\n";

p_critic += "8.5 Validate Published Exports — Avoid shipping Node imports into Worker or Deno entry points.\n";
p_critic += "Today: static node: imports in production src break Workers/Deno consumers of dist.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "- core imports successfully in supported runtimes.\n";
p_critic += "- webhook verification works across runtimes.\n";
p_critic += "- provider HTTP operations do not require Node globals.\n\n";

p_critic += "Inspect thoroughly with evidence (grep/read):\n";
p_critic += "- packages/core/src/gateways/gateway-context.ts (CryptoProvider, GatewayContext, createDefaultGatewayContext)\n";
p_critic += "- packages/core/src/gateways/factories.ts (only hooks/logger passed — NOT fetch/crypto)\n";
p_critic += "- packages/core/src/client.ts initFromPlugin createDefaultGatewayContext (no runtime option)\n";
p_critic += "- packages/core/src/types/config.types.ts CreatePaymentClientOptions / PaymentClientConfig\n";
p_critic += "- All four gateways: await fetch(...), node:crypto, Buffer, randomUUID sources\n";
p_critic += "- packages/core/src/types/payment-event.ts hashWebhookPayload node:crypto\n";
p_critic += "- packages/core/src/types/payment.types.ts for missing signal\n";
p_critic += "- packages/core/package.json build target + engines + exports\n";
p_critic += "- scripts/consumer-smoke.mjs, scripts/validate-package.sh\n";
p_critic += "- packages/core/docs/behavioral-contracts.md section 7 runtime assumptions\n";
p_critic += "- packages/core/docs/plugin-architecture.md GatewayContext section\n";
p_critic += "- public-api tests and baselines\n\n";

p_critic += "CRITICAL GAPS to confirm with evidence:\n";
p_critic += "1) No public PaymentRuntime / Clock type matching roadmap 8.1\n";
p_critic += "2) CreatePaymentClientOptions has no runtime?: Partial<PaymentRuntime> | PaymentRuntime\n";
p_critic += "3) Factories ignore context.fetch/crypto/clock/uuid — gateways use globals\n";
p_critic += "4) node:crypto / node:buffer static imports in production gateway + payment-event code\n";
p_critic += "5) No portable HMAC/SHA256/timingSafeEqual helpers based on Web Crypto (or pure)\n";
p_critic += "6) No signal?: AbortSignal on mutation/query params; no combineSignals for timeout+caller\n";
p_critic += "7) No Deno / Workers smoke; matrix incomplete beyond Node+Bun consumer smoke\n";
p_critic += "8) Build/export may still embed Node assumptions; no workers-safe entry validation\n";
p_critic += "9) Docs claim node:crypto still; behavioral-contracts outdated for Phase 8\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT (GatewayContext fields, createDefaultGatewayContext,\n";
p_critic += "internal timeout AbortController, consumer-smoke Node+Bun, CryptoProvider type, engines node>=18 bun>=1).\n";
p_critic += "stream_plan for implement order. risks: making verifyWebhook async-only (0.x sync API);\n";
p_critic += "Web Crypto subtle async HMAC vs sync verifyWebhook; double-wrapping fetch; exactOptionalPropertyTypes;\n";
p_critic += "breaking tests that mock globalThis.fetch only; AbortSignal.timeout availability on older Node;\n";
p_critic += "workers without node:buffer base64; coverage drop; Phase 7 attachPaymentEvent regressions;\n";
p_critic += "secret leakage in runtime docs; changing build target breaking Node consumers.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase8-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase8-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 8 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 8\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 8 Runtime Portability in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core package is packages/core = @paykernel/core (0.8.0).\n";
common += "Testkit: packages/testkit = @paykernel/testkit (depends on core).\n";
common += "PHASE 8 ONLY: Runtime Portability.\n";
common += "Do NOT start Phase 9 stores, Phase 10 webhooks package, new PSPs, gateway extraction.\n";
common += "Do NOT rewrite Phase 5 money / Phase 6 outcomes / Phase 7 PaymentEvent unless required for portable hashing/runtime wiring.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-7: monorepo, baselines, plugin architecture,\n";
common += "capabilities, createPaymentClient, registry, factories, pack validation, coverage thresholds,\n";
common += "testkit, Money/AmountInput, PaymentOperationResult, PaymentEvent dual-write.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change.\n";
common += "2) No unsafe mutation retries without native idempotency or atomic dedup.\n";
common += "3) Never convert uncertain outcomes into failure.\n";
common += "4) Do not hide provider differences.\n";
common += "5) No secret leakage in errors/logs/fixtures.\n";
common += "6) No framework coupling.\n";
common += "7) No Node-only assumptions in portable packages — Web APIs or injectable runtime.\n";
common += "8) Keep 0.x backward compat: global fetch still works as default; verifyWebhook stays sync if possible.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) exactOptionalPropertyTypes is ON — respect optional props carefully.\n";
common += "11) Core must NOT depend on testkit.\n";
common += "12) Prefer Web Crypto / fetch / Headers / AbortController; narrow fallbacks only when unavoidable.\n";
common += "13) Gateways MUST use injected fetch from runtime/context, not bare global fetch, when context is available.\n";
common += "14) Production src under packages/core/src must not static-import node: modules except possibly in *.test.ts files.\n";
common += "    Tests MAY use node:fs/path/crypto for fixtures. Production code must be Workers/Deno portable.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: PaymentRuntime types + client/config injection + portable crypto helpers
let p_a = "";
p_a += common;
p_a += "STREAM A — PAYMENT RUNTIME MODEL + PORTABLE CRYPTO HELPERS (Tasks 8.1, 8.2 types/helpers).\n";
p_a += "You own packages/core/src/runtime/ (new), packages/core/src/gateways/gateway-context.ts,\n";
p_a += "packages/core/src/types/config.types.ts, packages/core/src/client.ts (runtime wiring only),\n";
p_a += "packages/core/src/create-payment-client.ts overloads if needed, packages/core/src/index.ts exports,\n";
p_a += "packages/core/src/types/payment-event.ts hash path (portable), unit tests for runtime helpers.\n";
p_a += "Coordinate so Stream B can inject runtime into gateways and Stream C can use combineAbortSignals.\n\n";

p_a += "### DESIGN PRINCIPLES (non-negotiable)\n";
p_a += "1) PaymentRuntime is the portable dependency bag matching roadmap 8.1 exactly in spirit:\n";
p_a += "```ts\n";
p_a += "export interface Clock {\n";
p_a += "  now(): Date;\n";
p_a += "  nowMs(): number;\n";
p_a += "}\n";
p_a += "export interface PaymentRuntime {\n";
p_a += "  fetch: typeof globalThis.fetch;\n";
p_a += "  crypto: CryptoProvider; // reuse existing CryptoProvider from gateway-context\n";
p_a += "  clock: Clock;\n";
p_a += "  randomUUID(): string;\n";
p_a += "}\n";
p_a += "```\n";
p_a += "2) GatewayContext MUST be composed FROM PaymentRuntime (or include all PaymentRuntime fields).\n";
p_a += "   Prefer: GatewayContext extends/includes PaymentRuntime fields + hooks + logger + optional telemetry + uuid alias.\n";
p_a += "   createDefaultGatewayContext should accept Partial<PaymentRuntime> / CreateDefaultGatewayContextOptions with runtime fields.\n";
p_a += "3) createPaymentRuntime(partial?: Partial<PaymentRuntime>): PaymentRuntime builds defaults from globalThis.\n";
p_a += "4) CreatePaymentClientOptions gains optional `runtime?: Partial<PaymentRuntime>`.\n";
p_a += "   PaymentClientConfig (legacy) may also accept optional runtime for 0.x parity.\n";
p_a += "5) client.initFromPlugin MUST pass partial.runtime into createDefaultGatewayContext so adapters receive injected fetch/crypto/clock/uuid.\n";
p_a += "6) Portable crypto helpers in packages/core/src/runtime/crypto-portable.ts (or similar):\n";
p_a += "   - sha256Hex(data: string | Uint8Array, crypto?: CryptoProvider): string | Promise<string>\n";
p_a += "     Prefer sync pure implementation OR use node-free path. BEST: provide BOTH:\n";
p_a += "     - sha256HexSync via a small pure SHA-256 (no node) OR Web Crypto when only async needed\n";
p_a += "     - hmacSha256Hex / hmacSha512Hex for Stripe (sha256) and Paymob (sha512)\n";
p_a += "   CRITICAL: verifyWebhook is SYNC today. Do NOT break sync API.\n";
p_a += "   Strategy (pick and document):\n";
p_a += "   A) Prefer pure portable HMAC/SHA implementations (sync, no node:crypto, works on Workers/Deno/Bun/Node).\n";
p_a += "      Use a minimal audited pure implementation inline or small self-contained module — NOT a heavy dependency.\n";
p_a += "   B) OR use Web Crypto subtle only on async verifyWebhookAsync paths and keep pure for sync.\n";
p_a += "   Pure portable crypto for HMAC-SHA256/SHA512 + timingSafeEqual is the recommended path for 0.x sync webhooks.\n";
p_a += "   - timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean (constant-time length-checked)\n";
p_a += "   - utf8Encode(s: string): Uint8Array using TextEncoder (Web API)\n";
p_a += "   - bytesToHex / hexToBytes helpers\n";
p_a += "7) hashWebhookPayload in payment-event.ts MUST stop importing node:crypto; use portable sha256.\n";
p_a += "8) randomUUID via runtime.randomUUID / crypto.randomUUID — never node:crypto randomUUID in production gateways.\n";
p_a += "9) Base64: use btoa/atob or Uint8Array pure helpers for Basic auth (Moyasar), NOT node:buffer Buffer.\n";
p_a += "10) Do NOT add npm dependencies for crypto if avoidable — keep dependency count low (only zod today).\n\n";

p_a += "### createPaymentRuntime\n";
p_a += "```ts\n";
p_a += "export function createPaymentRuntime(partial?: Partial<PaymentRuntime>): PaymentRuntime;\n";
p_a += "// defaults: globalThis.fetch, resolveDefaultCrypto(), Date clock, crypto.randomUUID\n";
p_a += "export function paymentRuntimeFromContext(ctx: GatewayContext): PaymentRuntime;\n";
p_a += "export function mergePaymentRuntime(base: PaymentRuntime, partial?: Partial<PaymentRuntime>): PaymentRuntime;\n";
p_a += "```\n";
p_a += "Wire createDefaultGatewayContext to use createPaymentRuntime internally so one source of defaults.\n\n";

p_a += "### Config wiring\n";
p_a += "```ts\n";
p_a += "// CreatePaymentClientOptions\n";
p_a += "runtime?: Partial<PaymentRuntime>;\n";
p_a += "```\n";
p_a += "createPaymentClient({ gateways, runtime: { fetch: customFetch, clock: fakeClock } })\n";
p_a += "Legacy PaymentClient may accept runtime similarly if easy; at minimum plugin path must.\n\n";

p_a += "### Public exports\n";
p_a += "Export PaymentRuntime, Clock, createPaymentRuntime, portable crypto helpers needed by apps/tests,\n";
p_a += "CryptoProvider (already), createDefaultGatewayContext (already).\n";
p_a += "Update public-api.test.ts freeze list and type tests.\n\n";

p_a += "### Tests Stream A\n";
p_a += "- createPaymentRuntime defaults use globalThis.fetch and produce valid UUID\n";
p_a += "- partial override of fetch/clock/crypto is respected\n";
p_a += "- createPaymentClient with custom fetch: gateway HTTP uses custom fetch (integration with factory after B)\n";
p_a += "  At least unit-level: createDefaultGatewayContext({ fetch: mock }) returns that fetch\n";
p_a += "- portable hmacSha256 matches known test vectors (RFC / Stripe-style)\n";
p_a += "- portable hmacSha512 matches known vectors (Paymob)\n";
p_a += "- timingSafeEqualBytes true/false and length mismatch\n";
p_a += "- hashWebhookPayload no longer imports node:crypto; still hex 64 chars; redaction still works\n";
p_a += "- type tests: PaymentRuntime fields required\n\n";

p_a += "### Docs (partial — Stream D completes runtime.md)\n";
p_a += "Start packages/core/docs/runtime.md skeleton if needed; Stream D finishes.\n";
p_a += "Do NOT write phase-8-gate-report.md (Gate owns it).\n";
p_a += "After implement: bun test focused runtime + payment-event hash tests; typecheck core.\n";

let a_result = agent(p_a, #{
    label: "impl:8-runtime-core",
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

// Parallel streams B, C, D
log("Implementing Phase 8 gateway injection, AbortSignal, matrix/exports/docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — MIGRATE ALL GATEWAYS TO INJECTED RUNTIME + PORTABLE CRYPTO (Tasks 8.1, 8.2, 8.5 production code).\n";
p_b += "PRECONDITION: Stream A may have created PaymentRuntime + portable crypto. If missing, create\n";
p_b += "packages/core/src/runtime/* helpers yourself (copy Stream A requirements) then migrate gateways.\n";
p_b += "OWN: packages/core/src/gateways/{moyasar,stripe,paypal,paymob}/*.ts (production, not only tests),\n";
p_b += "packages/core/src/gateways/factories.ts, packages/core/src/gateways/base.gateway.ts if helpful,\n";
p_b += "packages/core/src/client.ts legacy constructor path for runtime if applicable.\n\n";

p_b += "### GOAL\n";
p_b += "1) Every built-in gateway uses injected fetch from constructor/context — NOT bare global fetch.\n";
p_b += "2) Every built-in gateway uses portable HMAC/timingSafeEqual/randomUUID — NO static node:crypto or node:buffer imports in production .ts files.\n";
p_b += "3) factories create(context) pass full runtime deps:\n";
p_b += "```ts\n";
p_b += "create(context) {\n";
p_b += "  return new StripeGateway(config, context.hooks, context.logger, {\n";
p_b += "    fetch: context.fetch,\n";
p_b += "    crypto: context.crypto,\n";
p_b += "    clock: context.clock,\n";
p_b += "    randomUUID: () => context.uuid(), // or context.crypto.randomUUID\n";
p_b += "  });\n";
p_b += "}\n";
p_b += "```\n";
p_b += "Or accept GatewayContext / PaymentRuntime as 4th ctor arg. Keep 0.x ctor (config, hooks, logger?) working:\n";
p_b += "when runtime omitted, default to createPaymentRuntime() so existing `new StripeGateway(config, hooks)` tests pass.\n";
p_b += "4) HTTP: `await this.fetch(url, init)` not `await fetch(url, init)`.\n";
p_b += "5) Webhooks: replace createHmac/timingSafeEqual/Buffer with portable helpers from runtime module.\n";
p_b += "6) Stripe randomUUID for idempotency keys: use this.runtime.randomUUID() not node:crypto.\n";
p_b += "7) Moyasar Basic auth base64: pure base64 encode of utf8 bytes — no node:buffer.\n";
p_b += "8) Clock: prefer this.clock.nowMs() for timeout/timestamp logic where Date.now was used for ops (not required everywhere if low risk).\n";
p_b += "9) verifyWebhook remains synchronous and works without Node.\n";
p_b += "10) verifyWebhookAsync (PayPal network verify) uses this.fetch.\n\n";

p_b += "### Constructor pattern (recommended)\n";
p_b += "```ts\n";
p_b += "export type GatewayRuntimeDeps = Pick<PaymentRuntime, 'fetch' | 'crypto' | 'clock'> & {\n";
p_b += "  randomUUID?: () => string;\n";
p_b += "};\n";
p_b += "constructor(config, hooks, logger?, runtime?: Partial<GatewayRuntimeDeps>) {\n";
p_b += "  super(...);\n";
p_b += "  const rt = createPaymentRuntime(runtime);\n";
p_b += "  this.fetch = rt.fetch.bind(globalThis); // or store rt.fetch\n";
p_b += "  this.runtime = rt;\n";
p_b += "}\n";
p_b += "```\n";
p_b += "ExactOptionalPropertyTypes: only assign optional fields when defined.\n\n";

p_b += "### Tests\n";
p_b += "- Custom fetch injection: pass mock fetch via factory context / runtime; assert HTTP went through mock WITHOUT patching globalThis.fetch\n";
p_b += "- Existing globalThis.fetch mocks still work when runtime defaults to global fetch\n";
p_b += "- Webhook verification still passes for stripe/moyasar/paymob with portable HMAC\n";
p_b += "- No production file under packages/core/src/** (excluding *.test.ts) imports from 'node:*'\n";
p_b += "  Add a unit test or script check: grep/import scan fails if node: appears in non-test src.\n";
p_b += "  Exception: only if absolutely unavoidable document it — preferred is ZERO production node: imports.\n";
p_b += "- Run: bun test packages/core\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — AbortSignal ON EVERY NETWORK OPERATION (Task 8.3).\n";
p_c += "OWN: packages/core/src/types/payment.types.ts (and validation schemas),\n";
p_c += "gateway request helpers in all 4 gateways, client passthrough if any,\n";
p_c += "packages/core/src/runtime/abort.ts helpers, tests for cancellation.\n";
p_c += "If PaymentRuntime missing, still implement signal on params + combine helper.\n\n";

p_c += "### GOAL\n";
p_c += "Every network operation accepts cancellation through operation context/params.\n\n";
p_c += "1) Add optional signal to operation params (shared base preferred):\n";
p_c += "```ts\n";
p_c += "/** Optional cancellation for the underlying HTTP request(s). */\n";
p_c += "signal?: AbortSignal;\n";
p_c += "```\n";
p_c += "Add to: CreatePaymentParams (or CommonPaymentInput — careful CommonPaymentInput is money-focused;\n";
p_c += "prefer a small OperationRequestOptions interface mixed into Create/Capture/Refund/Void/GetPayment params).\n";
p_c += "Also Checkout session params if they hit network.\n";
p_c += "Do NOT put signal on WebhookEvent or payment results.\n\n";

p_c += "2) Helper:\n";
p_c += "```ts\n";
p_c += "export function combineAbortSignals(...signals: Array<AbortSignal | undefined | null>): AbortSignal | undefined;\n";
p_c += "// Uses AbortSignal.any when available; else AbortController fan-in polyfill.\n";
p_c += "export function createTimeoutSignal(timeoutMs: number, clock?: Clock): { signal: AbortSignal; clear(): void };\n";
p_c += "```\n";
p_c += "Prefer AbortSignal.timeout(ms) when available (Node 18+, modern Bun) with clear no-op;\n";
p_c += "fallback to AbortController + setTimeout.\n\n";

p_c += "3) Each gateway HTTP helper merges caller signal + timeout signal:\n";
p_c += "```ts\n";
p_c += "const { signal: timeoutSignal, clear } = createTimeoutSignal(timeoutMs);\n";
p_c += "const signal = combineAbortSignals(params.signal, timeoutSignal);\n";
p_c += "try { return await this.fetch(url, { ...init, signal }); }\n";
p_c += "finally { clear(); }\n";
p_c += "```\n";
p_c += "Propagate params.signal from createPayment/capture/refund/void/getPayment into the HTTP layer.\n";
p_c += "PayPal multi-request flows should pass the same signal to all requests in the operation.\n\n";

p_c += "4) Error mapping: aborted by caller → prefer PaymentAbortedError or NetworkError with clear message;\n";
p_c += "timeout abort → existing timeout NetworkError behavior. Do not convert indeterminate money ops incorrectly.\n";
p_c += "If request aborted before send, safe to throw; if uncertain after send, keep indeterminate rules (Phase 6).\n\n";

p_c += "5) Zod validation: signal is not JSON-schema friendly — strip/passthrough carefully.\n";
p_c += "If schemas strip unknown keys, ensure signal is NOT stripped before HTTP (validate money fields only,\n";
p_c += "or use .passthrough() / catch signal before parse / reattach after parse).\n";
p_c += "CRITICAL: Zod safeParse must not drop signal. Test this.\n\n";

p_c += "6) Tests:\n";
p_c += "- pre-aborted signal rejects createPayment without hanging\n";
p_c += "- signal abort mid-flight aborts fetch (mock that listens to signal)\n";
p_c += "- timeout still works without caller signal\n";
p_c += "- combineAbortSignals aborts when any input aborts\n";
p_c += "- signal survives validation (not stripped)\n";
p_c += "- At least 2 gateways fully tested for signal (stripe + one other); all 4 wire signal if possible\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — RUNTIME MATRIX + EXPORT VALIDATION + DOCS + CHANGELOG (Tasks 8.4, 8.5).\n";
p_d += "OWN: scripts/consumer-smoke.mjs (extend), new scripts/runtime-matrix* or packages/core/src/runtime/*.test.ts,\n";
p_d += "packages/core/package.json build/exports/engines, root package.json scripts if needed,\n";
p_d += "docs/runtime.md, behavioral-contracts.md §7, plugin-architecture.md, CHANGELOG, README note,\n";
p_d += "public-api freeze, baseline regen if standard.\n\n";

p_d += "### 8.4 Runtime Test Matrix\n";
p_d += "Implement practical matrix that runs in this environment:\n";
p_d += "1) Bun: import packed or dist — already in consumer-smoke; keep and strengthen.\n";
p_d += "2) Node (current): import ESM package; call createPaymentRuntime, createPaymentClient with mock adapter,\n";
p_d += "   portable webhook HMAC verify for stripe-style signature without node:crypto in package path.\n";
p_d += "3) Document engines: node >= 18 (min), note LTS 18/20/22; bun >= 1.0.\n";
p_d += "4) Deno smoke: if `deno` binary missing, add script that is SKIP-tolerant OR a pure check that\n";
p_d += "   dist/index.js has zero `node:` import strings (static analysis as Workers/Deno gate).\n";
p_d += "5) Cloudflare Workers smoke: without wrangler, validate:\n";
p_d += "   - no node: imports in dist bundle\n";
p_d += "   - optional: run a small workerd/miniflare only if already available — DO NOT add heavy deps.\n";
p_d += "   Prefer static analysis + Node/Bun functional smoke + unit tests with injected fetch.\n";
p_d += "6) Add `bun run test:runtime` or include in validate-package.sh a `check:runtime-portability` script:\n";
p_d += "   - Scan packages/core/src/**/*.ts excluding **/*.test.ts and **/*types.test.ts for /from ['\"]node:/\n";
p_d += "   - Scan dist/index.js for node: requires/imports\n";
p_d += "   - Fail if found\n";
p_d += "7) Document matrix in docs/runtime.md: what is tested in CI vs aspirational.\n\n";

p_d += "### 8.5 Validate Published Exports\n";
p_d += "1) packages/core/package.json build: consider `--target browser` or bun default that does not inject node shims,\n";
p_d += "   OR keep node target ONLY if dist has zero node: imports after Stream B.\n";
p_d += "   Primary requirement: published dist must not force Node builtins for Workers/Deno consumers.\n";
p_d += "2) exports map stays ESM-only; optionally document that single entry is portable.\n";
p_d += "3) attw/publint still pass.\n";
p_d += "4) consumer-smoke still passes Node+Bun.\n";
p_d += "5) Add assertion in smoke: importing package and verifying stripe webhook with portable path works on Node and Bun.\n\n";

p_d += "### Docs (must exist before gate)\n";
p_d += "1) packages/core/docs/runtime.md — full Phase 8 guide:\n";
p_d += "   - PaymentRuntime fields and createPaymentRuntime\n";
p_d += "   - Injecting custom fetch/clock/crypto via createPaymentClient({ runtime })\n";
p_d += "   - AbortSignal on operations + timeout combination\n";
p_d += "   - Supported runtimes (Node >=18, Bun >=1, Deno, CF Workers) and caveats\n";
p_d += "   - Webhook verification portability (no node:crypto required)\n";
p_d += "   - How to test with fake clock / mock fetch\n";
p_d += "   - What is NOT supported (browsers with secret keys, etc.)\n";
p_d += "2) Update behavioral-contracts.md §7 — remove claim that node:crypto is required; document PaymentRuntime\n";
p_d += "3) Update plugin-architecture.md — runtime injection through context\n";
p_d += "4) packages/core/CHANGELOG.md Unreleased Phase 8 section\n";
p_d += "5) README brief runtime note if appropriate\n";
p_d += "6) packages/testkit note if mock gateways should accept runtime (optional)\n\n";

p_d += "### Baselines\n";
p_d += "Public API additive exports expected. Regenerate if standard: bun run baseline:api\n";
p_d += "Update public-api.test.ts freeze list.\n";
p_d += "Keep bun test packages/testkit green.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:8-gateway-runtime", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:8-abort-signal", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "impl:8-matrix-docs", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 8 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 9+.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) PaymentRuntime + Clock exported; createPaymentRuntime works; matches roadmap 8.1 fields.\n";
p_int += "2) CreatePaymentClientOptions.runtime?: Partial<PaymentRuntime> wired into GatewayContext for adapters.\n";
p_int += "3) factories pass fetch/crypto/clock/uuid into all 4 built-in gateways.\n";
p_int += "4) All 4 gateways use this.fetch (injected) for HTTP — not bare global fetch.\n";
p_int += "5) ZERO production node: imports under packages/core/src (exclude *.test.ts).\n";
p_int += "6) Portable HMAC/SHA/timingSafeEqual used for stripe/moyasar/paymob webhook verify (sync).\n";
p_int += "7) hashWebhookPayload portable (no node:crypto).\n";
p_int += "8) signal?: AbortSignal on network operation params; combined with timeout; not stripped by Zod.\n";
p_int += "9) combineAbortSignals / createTimeoutSignal helpers exported or internal+tested.\n";
p_int += "10) Runtime portability check script or test fails on node: production imports.\n";
p_int += "11) consumer-smoke Node+Bun still pass; validate:package green.\n";
p_int += "12) docs/runtime.md + behavioral-contracts §7 + CHANGELOG + public API freeze.\n";
p_int += "13) Phase 0-7 safety: money, outcomes, PaymentEvent, typecheck, tests core+testkit, build, boundaries.\n";
p_int += "14) Coverage thresholds for core still met.\n";
p_int += "15) No Phase 9 stores; no new packages; no secret leakage.\n";
p_int += "16) Logical bugs to eliminate: factories still ignoring context.fetch; verifyWebhook broken without node;\n";
p_int += "    signal dropped by zod; double abort controllers leaking timers; Buffer still used; global fetch only path;\n";
p_int += "    indeterminate timeout converted to failed; PaymentEvent dual-write broken.\n";
p_int += "17) exactOptionalPropertyTypes careful with optional runtime/signal fields.\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run validate:package\n";
p_int += "    (and any check:runtime-portability / test:runtime script you added)\n";
p_int += "19) If Stream A failed, implement PaymentRuntime + portable crypto fully yourself. Phase 8 cannot ship without them.\n";
p_int += "20) Regenerate API baseline if standard after additive exports.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase8",
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
p_ver += "Verify Phase 8 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/core/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run validate:package\n";
p_ver += "10) Evidence PaymentRuntime + createPaymentRuntime exported (read source + dist .d.ts)\n";
p_ver += "11) Evidence CreatePaymentClientOptions.runtime and client wires into context\n";
p_ver += "12) Evidence factories pass fetch/crypto to gateways; gateways use this.fetch\n";
p_ver += "13) Evidence ZERO node: imports in production src (rg excluding tests)\n";
p_ver += "14) Evidence portable webhook verify (no node:crypto in gateway production files)\n";
p_ver += "15) Evidence signal?: AbortSignal on params + combine with timeout + tests\n";
p_ver += "16) Evidence runtime matrix / portability check / consumer-smoke\n";
p_ver += "17) Evidence dist has no node: import strings (or documented residual with fail)\n";
p_ver += "18) Evidence docs/runtime.md exists and behavioral-contracts §7 updated\n";
p_ver += "19) Evidence Phase 7 PaymentEvent still green; Phase 5 money still green\n";
p_ver += "20) Evidence Phase 6 outcomes still green\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- payment_runtime_ok: PaymentRuntime/Clock/createPaymentRuntime\n";
p_ver += "- inject_ok: client+factories inject runtime into gateways; custom fetch test\n";
p_ver += "- web_apis_ok: no production node: imports; portable crypto for webhooks/hash\n";
p_ver += "- abort_signal_ok: signal on ops + tests + not stripped\n";
p_ver += "- matrix_ok: Node+Bun smoke + portability scan (+ Deno/Workers static)\n";
p_ver += "- exports_ok: dist portable; publint/attw/pack ok\n";
p_ver += "- webhook_portable_ok: webhook verification without node:crypto\n";
p_ver += "- http_no_node_globals_ok: provider HTTP uses injected fetch only\n";
p_ver += "- compat_ok: 0.x defaults (global fetch), existing tests, Phase 5-7 green\n";
p_ver += "Set ok=true only if typecheck, tests (core+testkit), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase8",
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
    write_scratch_file("phase8-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 8 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 8 — each PASS or BLOCKING:\n";
p_gate += "A1) core imports successfully in supported runtimes.\n";
p_gate += "    Evidence: consumer-smoke Node+Bun; dist import; engines; portability scan;\n";
p_gate += "    createPaymentRuntime/createPaymentClient from published entry.\n";
p_gate += "A2) webhook verification works across runtimes.\n";
p_gate += "    Evidence: stripe/moyasar/paymob verify use portable crypto (no node:crypto in production);\n";
p_gate += "    tests pass; pure HMAC vectors; works under Bun and Node smoke.\n";
p_gate += "A3) provider HTTP operations do not require Node globals.\n";
p_gate += "    Evidence: gateways call injected this.fetch; factories pass context.fetch;\n";
p_gate += "    custom fetch test without global patch; no node:http/https.\n\n";
p_gate += "Also require Phase 8 tasks 8.1-8.5 deliverables:\n";
p_gate += "- 8.1 PaymentRuntime injection (interface + createPaymentClient runtime option + GatewayContext)\n";
p_gate += "- 8.2 Prefer Web APIs / portable crypto; zero production node: imports\n";
p_gate += "- 8.3 AbortSignal on every network operation params + timeout combine\n";
p_gate += "- 8.4 Runtime test matrix (practical CI matrix + docs)\n";
p_gate += "- 8.5 Published exports portable (dist validation)\n";
p_gate += "- Phase 0-7 safety net still green; boundaries; no core→testkit dep\n";
p_gate += "- No logical bugs: signal stripped by zod; factories ignore fetch; verifyWebhook needs node;\n";
p_gate += "  Buffer in production; timer leaks; Phase 7 dual-write broken.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit; bun run typecheck; check:boundaries;\n";
p_gate += "production node: import scan; validate:package if time.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-8-gate-report.md\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase8-adversarial",
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
    write_scratch_file("phase8-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 8 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 8 only — no Phase 9 stores, no new providers.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete PaymentRuntime, injection, portable crypto, AbortSignal, matrix, exports, tests, docs as needed.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "  production node: import scan must be clean\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase8-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 8 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit, coverage, build, boundaries,\n";
    p_re += "validate:package, node: production import scan.\n";
    p_re += "Confirm all 8.1-8.5 deliverables and acceptance criteria with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase8-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase8-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 8 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/core/docs/baseline/phase-8-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 8.1-8.5 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase8-final",
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
        write_scratch_file("phase8-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 8 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 8,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
