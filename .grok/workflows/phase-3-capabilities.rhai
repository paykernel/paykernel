let meta = #{
    name: "phase-3-capabilities",
    description: "Phase 3 gateway capabilities model: critic, implement capabilities/supports/docs/claim-validation, integrate, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 3 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "capability keys, supports(), manifest claims, errors, factories, docs gen, tests" },
        #{ title: "Integrate", detail: "wire exports, client checks, docs, type tests; keep green" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, publint, attw, smoke, claim validation" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 3" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 3 (gateway capabilities model) for @paykernel/core",
};

let critic_schema = #{
    "type": "object",
    "required": ["gaps", "already_present", "stream_plan", "risks", "summary"],
    "properties": #{
        "gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "already_present": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "stream_plan": #{ "type": "string" },
        "risks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 100 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "typecheck_types_ok", "tests_ok", "build_ok", "pack_ok", "publint_ok", "attw_ok", "coverage_ok", "capabilities_ok", "docs_ok", "claim_validation_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "typecheck_types_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "pack_ok": #{ "type": "boolean" },
        "publint_ok": #{ "type": "boolean" },
        "attw_ok": #{ "type": "boolean" },
        "coverage_ok": #{ "type": "boolean" },
        "capabilities_ok": #{ "type": "boolean" },
        "docs_ok": #{ "type": "boolean" },
        "claim_validation_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 3 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 3 critic for @paykernel/core at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 3 — Gateway Capabilities Model\" completely (Objective, Target Model, Tasks 3.1-3.4, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4). Phases 0-2 are complete — preserve baselines, monorepo, plugin architecture, pack validation.\n";
p_critic += "Do NOT plan Phase 4 testkit package, Phase 5 money model, new gateway packages, or gateway extraction.\n\n";
p_critic += "Audit against EVERY Phase 3 task and acceptance criterion:\n\n";
p_critic += "3.1 Define Stable Capability Keys covering:\n";
p_critic += "  - payment creation (payments)\n";
p_critic += "  - immediate capture (immediateCapture)\n";
p_critic += "  - authorization (authorization / authorize-only holds)\n";
p_critic += "  - full and partial capture (captures via capturePayment; partialCapture when amount-limited)\n";
p_critic += "  - full and partial refund (refunds; partialRefunds)\n";
p_critic += "  - void (voids)\n";
p_critic += "  - hosted checkout (hostedCheckout)\n";
p_critic += "  - setup/tokenization (tokenization)\n";
p_critic += "  - customers (customers)\n";
p_critic += "  - stored payment methods (paymentMethods)\n";
p_critic += "  - marketplace splits and transfers (marketplaceSplits)\n";
p_critic += "  - disputes (disputes)\n";
p_critic += "  - payment links (paymentLinks)\n";
p_critic += "  - provider-native recurring billing as extension only (providerRecurring)\n\n";
p_critic += "3.2 Add Capability Queries:\n";
p_critic += "  - gateway.supports(\"partialRefunds\") style API\n";
p_critic += "  - ideally typed GatewayCapabilityKey + capabilities() snapshot\n\n";
p_critic += "3.3 Generate Provider Documentation:\n";
p_critic += "  - comparison tables generated from manifests/code, not hand-waved\n\n";
p_critic += "3.4 Validate Adapter Claims:\n";
p_critic += "  - claimed capabilities must be verifiable (tests that claims match method presence / behavior boundaries)\n";
p_critic += "  - full Phase 4 conformance suite package is OUT OF SCOPE, but claim-validation harness/tests IN SCOPE\n\n";
p_critic += "Acceptance criteria:\n";
p_critic += "- consumers can inspect support before invocation\n";
p_critic += "- unsupported operations fail consistently with capability metadata\n";
p_critic += "- capability documentation is generated from code\n\n";
p_critic += "Inspect thoroughly: packages/core/src/gateways/* (interface, base, manifest, adapter, registry, factories,\n";
p_critic += "stripe/moyasar/paypal/paymob), client.ts, errors.ts, index.ts, public-api*.test.ts, docs/*.\n";
p_critic += "Note: OperationNotSupportedError exists but likely lacks capability metadata.\n";
p_critic += "Note: GatewayManifest may only have metadata?: Record without typed capabilities.\n";
p_critic += "List concrete GAPS. List ALREADY_PRESENT. stream_plan for implement order.\n";
p_critic += "risks: over-claiming capabilities vs actual gateway methods; breaking Phase 2 plugins;\n";
p_critic += "secret leakage; false docs; optional methods vs capability flags divergence;\n";
p_critic += "partial capture/refund amount checks without false negatives on full ops.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase3-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase3-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 3 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 3\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 3 foundation in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Package: @paykernel/core in packages/core — Bun + TypeScript multi-gateway payment SDK.\n";
common += "PHASE 3 ONLY: Gateway Capabilities Model. Do NOT start Phase 4 testkit package, Phase 5 money,\n";
common += "or extract gateways to separate packages. Do NOT add new real providers.\n";
common += "Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0/1/2 work: monorepo, baselines, plugin architecture,\n";
common += "createPaymentClient, registry, factories, legacy PaymentClient, pack validation, coverage thresholds.\n";
common += "Mandatory engineering rules: no secret leakage; no Node-only assumptions in new portable APIs;\n";
common += "keep 0.x backward compat; do not hide provider differences; every phase ends typecheck/tests/build/pack/docs.\n";
common += "No unsafe mutation retries. Never convert uncertain outcomes to failure.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: types, supports API, errors, base/interface/manifest
let p_a = "";
p_a += common;
p_a += "STREAM A — FOUNDATION (3.1 + 3.2 core types + supports + error metadata).\n";
p_a += "You own capability contracts and fail-closed unsupported behavior.\n\n";

p_a += "### 1) NEW packages/core/src/gateways/gateway-capabilities.ts\n";
p_a += "Define stable keys matching roadmap Target Model + Task 3.1:\n";
p_a += "```ts\n";
p_a += "export const GATEWAY_CAPABILITY_KEYS = [\n";
p_a += "  'payments',\n";
p_a += "  'immediateCapture',\n";
p_a += "  'authorization',\n";
p_a += "  'partialCapture',\n";
p_a += "  'refunds',\n";
p_a += "  'partialRefunds',\n";
p_a += "  'voids',\n";
p_a += "  'hostedCheckout',\n";
p_a += "  'tokenization',\n";
p_a += "  'customers',\n";
p_a += "  'paymentMethods',\n";
p_a += "  'marketplaceSplits',\n";
p_a += "  'disputes',\n";
p_a += "  'paymentLinks',\n";
p_a += "  'providerRecurring',\n";
p_a += "] as const;\n";
p_a += "export type GatewayCapabilityKey = typeof GATEWAY_CAPABILITY_KEYS[number];\n";
p_a += "export type GatewayCapabilities = Readonly<Record<GatewayCapabilityKey, boolean>>;\n";
p_a += "```\n";
p_a += "Also provide:\n";
p_a += "- DEFAULT_GATEWAY_CAPABILITIES: all false (safe default for unknown adapters)\n";
p_a += "- defineGatewayCapabilities(partial): GatewayCapabilities — merges with all-false base so every key is explicit\n";
p_a += "- isGatewayCapabilityKey(value: string): value is GatewayCapabilityKey\n";
p_a += "- CAPABILITY_OPERATION_MAP: maps capability keys that have a primary client/gateway operation\n";
p_a += "  e.g. voids->voidPayment, hostedCheckout->createCheckoutSession, payments->createPayment,\n";
p_a += "  authorization/partialCapture->capturePayment (document semantics carefully),\n";
p_a += "  refunds/partialRefunds->refundPayment\n";
p_a += "- freezeCapabilities(caps): returns Object.freeze({...}) deep-ish freeze of the record\n";
p_a += "Document each key in JSDoc (what it means for THIS SDK surface, not entire provider APIs).\n";
p_a += "providerRecurring is extension-only: claim only if the adapter exposes provider-native recurring as first-class;\n";
p_a += "Stripe Checkout subscription mode alone does NOT force providerRecurring=true unless you document it as such — prefer false for built-ins unless there is a clear API.\n\n";

p_a += "### 2) packages/core/src/gateways/gateway-manifest.ts\n";
p_a += "Add typed capabilities to GatewayManifest:\n";
p_a += "```ts\n";
p_a += "readonly capabilities?: GatewayCapabilities;\n";
p_a += "```\n";
p_a += "Keep metadata for free-form non-capability hints. Document that capabilities are the source of truth for supports().\n";
p_a += "Update freezeManifest in gateway-registry.ts to freeze capabilities object if present.\n\n";

p_a += "### 3) packages/core/src/gateways/gateway.interface.ts\n";
p_a += "Extend PaymentGateway:\n";
p_a += "```ts\n";
p_a += "/** Frozen capability snapshot for this gateway instance (always complete keys). */\n";
p_a += "readonly capabilities: GatewayCapabilities;\n";
p_a += "supports(capability: GatewayCapabilityKey): boolean;\n";
p_a += "```\n";
p_a += "capabilities MUST be required for new code. For 0.x backward compat of third-party adapters written before Phase 3:\n";
p_a += "BaseGateway should default capabilities to all-false or inferred-from-methods — pick ONE documented strategy:\n";
p_a += "PREFERRED: BaseGateway requires capabilities via constructor option OR abstract/protected getDefaultCapabilities();\n";
p_a += "built-ins pass explicit defineGatewayCapabilities(...); third-party extending BaseGateway without override gets all-false\n";
p_a += "OR use defineGatewayCapabilities({}) default all false. Do NOT silently claim true for optional methods without explicit claims.\n";
p_a += "supports(key) returns !!this.capabilities[key] for known keys; false for unknown if you accept string overload — prefer typed key only.\n\n";

p_a += "### 4) packages/core/src/gateways/base.gateway.ts\n";
p_a += "Implement capabilities + supports on BaseGateway:\n";
p_a += "- Accept optional capabilities in constructor (extend GatewayConfig? or separate ctor param) WITHOUT putting secrets in capabilities.\n";
p_a += "- Prefer: protected constructor(config, hooks, logger?, capabilities?: Partial<GatewayCapabilities> | GatewayCapabilities)\n";
p_a += "  and store freezeCapabilities(defineGatewayCapabilities(capabilities ?? {})).\n";
p_a += "- supports(capability): boolean\n";
p_a += "- Ensure existing BaseGateway subclasses still compile — update their constructors if signature changes.\n";
p_a += "- Optional helper: assertCapability(key, operation) throws OperationNotSupportedError with metadata if !supports(key).\n\n";

p_a += "### 5) packages/core/src/errors.ts — OperationNotSupportedError capability metadata\n";
p_a += "Enhance (backward compatible constructors):\n";
p_a += "```ts\n";
p_a += "export class OperationNotSupportedError extends PaymentError {\n";
p_a += "  readonly gatewayName: string;\n";
p_a += "  readonly operation: string;\n";
p_a += "  readonly capability?: GatewayCapabilityKey;\n";
p_a += "  readonly claimedSupport?: boolean;\n";
p_a += "  constructor(\n";
p_a += "    gatewayName: string,\n";
p_a += "    operation: string,\n";
p_a += "    options?: { capability?: GatewayCapabilityKey; claimedSupport?: boolean; message?: string }\n";
p_a += "  )\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Keep existing two-arg call sites working. Message should still be human readable.\n";
p_a += "code stays OPERATION_NOT_SUPPORTED, statusCode 400.\n";
p_a += "Export types if needed from index.\n\n";

p_a += "### 6) Unit tests packages/core/src/gateways/gateway-capabilities.test.ts\n";
p_a += "- all keys present in GATEWAY_CAPABILITY_KEYS\n";
p_a += "- defineGatewayCapabilities merges partial correctly; unspecified keys false\n";
p_a += "- isGatewayCapabilityKey true/false\n";
p_a += "- freeze is frozen\n";
p_a += "- supports on a small test gateway returns expected values\n";
p_a += "- OperationNotSupportedError carries capability metadata when provided\n\n";

p_a += "### 7) Do NOT rewrite provider HTTP logic. Do NOT implement Phase 4 testkit package.\n";
p_a += "After edits: bun run typecheck and bun test — fix until green or note blockers.\n";

let a_result = agent(p_a, #{
    label: "impl:3.1-3.2-foundation",
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

// Parallel: factories+gateways claims, client checks, docs gen + claim validation tests
log("Implementing Phase 3 claims, client, docs, tests in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — Built-in capability claims + factory manifests + gateway instances (3.1 claims, 3.4 accuracy).\n";
p_b += "PRECONDITION: Stream A should have gateway-capabilities.ts, supports(), manifest.capabilities, BaseGateway.capabilities.\n";
p_b += "If foundation incomplete, implement minimum for built-ins to declare capabilities.\n\n";
p_b += "OWN PATHS:\n";
p_b += "- packages/core/src/gateways/factories.ts (manifest.capabilities on each factory)\n";
p_b += "- packages/core/src/gateways/stripe/stripe.gateway.ts (pass capabilities into BaseGateway)\n";
p_b += "- packages/core/src/gateways/moyasar/moyasar.gateway.ts\n";
p_b += "- packages/core/src/gateways/paypal/paypal.gateway.ts\n";
p_b += "- packages/core/src/gateways/paymob/paymob.gateway.ts\n";
p_b += "- Prefer a shared constants module e.g. packages/core/src/gateways/builtin-capabilities.ts exporting\n";
p_b += "  STRIPE_CAPABILITIES, MOYASAR_CAPABILITIES, PAYPAL_CAPABILITIES, PAYMOB_CAPABILITIES via defineGatewayCapabilities\n";
p_b += "  so factories and gateways and doc generation share ONE source of truth.\n\n";
p_b += "ACCURACY RULES (claims must match what THIS SDK adapter implements today, not marketing of the PSP):\n";
p_b += "Read each gateway implementation carefully before claiming true.\n";
p_b += "Typical expected matrix (VERIFY against code; adjust if code contradicts):\n";
p_b += "- payments: true for all four (createPayment exists)\n";
p_b += "- immediateCapture: true if auto-capture / capture-at-create is supported (usually true)\n";
p_b += "- authorization: true if authorize-only / capture:false / manual capture path exists\n";
p_b += "- partialCapture: true only if capturePayment accepts partial amounts successfully by design\n";
p_b += "  (PayPal may reject amount on order captures — claim false if only full/auth-path supported)\n";
p_b += "- refunds: true if refundPayment exists\n";
p_b += "- partialRefunds: true if amount-limited refunds are supported\n";
p_b += "- voids: true if voidPayment implemented\n";
p_b += "- hostedCheckout: true only if createCheckoutSession (or equivalent) is implemented (Stripe yes; others likely false)\n";
p_b += "- tokenization/customers/paymentMethods/marketplaceSplits/disputes/paymentLinks/providerRecurring:\n";
p_b += "  default false unless first-class SDK methods exist for them today\n";
p_b += "NEVER claim true for features not exposed on the adapter.\n\n";
p_b += "Wire:\n";
p_b += "1) factories set manifest.capabilities to the shared frozen constants (same object values as gateway instances).\n";
p_b += "2) gateway constructors pass the same capabilities into BaseGateway so instance.supports() matches manifest.\n";
p_b += "3) Registry freezeManifest freezes capabilities.\n";
p_b += "4) Unit test: each factory manifest.capabilities equals gateway.create(ctx).capabilities for all keys.\n";
p_b += "5) Unit test: stripe.supports('hostedCheckout')===true; moyasar.supports('hostedCheckout')===false (if accurate).\n";
p_b += "Do NOT rewrite provider HTTP. Fix any constructor signature breakages from Stream A.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — Client capability enforcement + consistent OperationNotSupportedError (3.2 + acceptance unsupported ops).\n";
p_c += "OWN PATHS primarily:\n";
p_c += "- packages/core/src/client.ts\n";
p_c += "- packages/core/src/create-payment-client.ts only if needed\n";
p_c += "- packages/core/src/client.test.ts / create-payment-client.test.ts / plugin-architecture.test.ts as needed\n\n";
p_c += "REQUIREMENTS:\n";
p_c += "1) Consumers can inspect support before invocation:\n";
p_c += "   client.gateway(name).supports('partialRefunds') and/or client.gateway(name).capabilities\n";
p_c += "   Optionally add client.supports(capability, gateway?) convenience that resolves default gateway — nice but not required if gateway().supports exists.\n\n";
p_c += "2) Unsupported operations fail CONSISTENTLY with capability metadata:\n";
p_c += "   - voidPayment: if !voidPayment method OR (capabilities present && !supports('voids')) → OperationNotSupportedError with capability: 'voids'\n";
p_c += "   - Prefer: if capabilities declare voids:false, throw even if a method were present (claim is authoritative).\n";
p_c += "   - If capabilities missing (legacy third-party without Phase 3), fall back to method presence check (0.x compat).\n";
p_c += "   - getPayment / getPaymentStatus: keep method presence checks; these are not separate capability keys in the roadmap model.\n";
p_c += "     Optionally still attach capability undefined; do not invent non-roadmap keys.\n";
p_c += "   - capturePayment: if amount provided and capabilities.partialCapture===false → OperationNotSupportedError capability partialCapture\n";
p_c += "     (full capture without amount still allowed when payments/authorization path supports capture)\n";
p_c += "   - refundPayment: if amount provided and capabilities.partialRefunds===false → OperationNotSupportedError capability partialRefunds\n";
p_c += "   - refundPayment when refunds===false → throw with capability refunds\n";
p_c += "   - createPayment when payments===false → throw with capability payments\n";
p_c += "   - createCheckoutSession on client if exposed: hostedCheckout check\n";
p_c += "3) Helper private assertCapability(gw, capability, operation) to avoid duplication.\n";
p_c += "4) Preserve all Phase 2 typing (generic TGateways, overloads).\n";
p_c += "5) Tests:\n";
p_c += "   - custom gateway with voids:false and no voidPayment → client.voidPayment throws with capability 'voids'\n";
p_c += "   - custom gateway with partialRefunds:false, refunds:true → full refund ok path (mock), partial amount throws partialRefunds\n";
p_c += "   - supports() true/false for custom adapter\n";
p_c += "   - existing voidPayment method-missing tests still pass and ideally include capability when caps present\n";
p_c += "6) Re-run bun test packages/core after changes; fix failures.\n";
p_c += "Do not start Phase 4.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — Documentation generation from code (3.3) + claim validation suite (3.4) + public exports/docs.\n";
p_d += "OWN PATHS:\n";
p_d += "- packages/core/src/gateways/capabilities-docs.ts (or utils) — pure functions to render markdown comparison tables from manifests/capabilities\n";
p_d += "- packages/core/scripts/ OR monorepo scripts/generate-capability-docs.ts — CLI that writes packages/core/docs/gateway-capabilities.md\n";
p_d += "- packages/core/docs/gateway-capabilities.md — GENERATED file with banner \"auto-generated; do not hand-edit\"\n";
p_d += "- packages/core/src/gateways/capability-claims.test.ts — claim validation\n";
p_d += "- packages/core/src/public-api.test.ts + public-api.types.test.ts updates\n";
p_d += "- packages/core/docs/plugin-architecture.md / custom-gateways.md — short sections on capabilities\n";
p_d += "- packages/core/src/index.ts + gateways/index.ts exports\n";
p_d += "- package.json scripts: \"docs:capabilities\": \"bun run scripts/generate-capability-docs.ts\" at monorepo or core level\n\n";
p_d += "DOC GENERATION RULES:\n";
p_d += "1) Source of truth = shared builtin capability constants + factory manifests (import from source, not hardcode table twice).\n";
p_d += "2) generateGatewayCapabilitiesMarkdown(manifests: GatewayManifest[]): string\n";
p_d += "   produces markdown table: rows = capability keys, columns = providers, cells = yes/no or ✓/✗\n";
p_d += "3) Script writes docs/gateway-capabilities.md under packages/core.\n";
p_d += "4) Unit test: generate function includes 'partialRefunds' and each built-in name; snapshot or contains checks.\n";
p_d += "5) After implementing constants, RUN the generator so the md file exists in tree.\n";
p_d += "6) Mention in README or plugin-architecture that tables are generated.\n\n";
p_d += "CLAIM VALIDATION (3.4) — not full Phase 4 conformance, but must verify claimed capabilities:\n";
p_d += "capability-claims.test.ts (or similar):\n";
p_d += "For each built-in factory (stripe/moyasar/paypal/paymob) with test credentials:\n";
p_d += "1) create(context) gateway\n";
p_d += "2) For every GatewayCapabilityKey:\n";
p_d += "   - gateway.supports(key) === gateway.capabilities[key] === manifest.capabilities[key]\n";
p_d += "3) Structural checks when claim is true:\n";
p_d += "   - payments true ⇒ typeof createPayment === 'function'\n";
p_d += "   - refunds true ⇒ typeof refundPayment === 'function'\n";
p_d += "   - voids true ⇒ typeof voidPayment === 'function'\n";
p_d += "   - hostedCheckout true ⇒ typeof createCheckoutSession === 'function'\n";
p_d += "   - authorization or partialCapture true ⇒ typeof capturePayment === 'function'\n";
p_d += "4) When claim is false for voids: supports('voids') false\n";
p_d += "5) Custom adapter with all-false capabilities: supports never true\n";
p_d += "6) Do NOT call real provider APIs.\n\n";
p_d += "EXPORTS from public API:\n";
p_d += "GATEWAY_CAPABILITY_KEYS, defineGatewayCapabilities, isGatewayCapabilityKey,\n";
p_d += "types GatewayCapabilityKey, GatewayCapabilities,\n";
p_d += "and doc helper if public (or keep generator internal — either OK if docs generated).\n";
p_d += "TYPE TESTS: supports only accepts GatewayCapabilityKey; @ts-expect-error on bogus key if possible.\n";
p_d += "Update public-api.test.ts export surface.\n";
p_d += "If Streams A-C incomplete, implement thin glue needed for tests; prefer completing 3.3/3.4 fully.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:3-builtin-claims", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:3-client-enforcement", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "impl:3-docs-claims-tests", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 3 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 4 testkit package or Phase 5 money model.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) GATEWAY_CAPABILITY_KEYS covers all roadmap 3.1 keys (payments, immediateCapture, authorization,\n";
p_int += "   partialCapture, refunds, partialRefunds, voids, hostedCheckout, tokenization, customers,\n";
p_int += "   paymentMethods, marketplaceSplits, disputes, paymentLinks, providerRecurring).\n";
p_int += "2) GatewayCapabilities is a complete Record of booleans; defineGatewayCapabilities fills defaults false.\n";
p_int += "3) PaymentGateway has capabilities + supports(capability).\n";
p_int += "4) BaseGateway implements supports; built-ins share ONE constants source with factory manifests.\n";
p_int += "5) GatewayManifest.capabilities typed; registry freezes them; no secrets in capabilities.\n";
p_int += "6) OperationNotSupportedError exposes gatewayName, operation, optional capability, optional claimedSupport;\n";
p_int += "   two-arg constructor still works.\n";
p_int += "7) PaymentClient enforces capability claims for payments/refunds/partialRefunds/partialCapture/voids (and hosted if applicable);\n";
p_int += "   legacy third-party without capabilities still uses method presence where applicable.\n";
p_int += "8) Built-in claims are honest vs implementation (no true for missing methods).\n";
p_int += "9) packages/core/docs/gateway-capabilities.md generated from code with comparison table.\n";
p_int += "10) Generator script + npm/bun script docs:capabilities exists and is runnable.\n";
p_int += "11) claim validation tests pass for all four built-ins + custom false caps.\n";
p_int += "12) Public exports complete; type tests updated; plugin-architecture/custom-gateways docs mention capabilities.\n";
p_int += "13) Phase 2 APIs still work: createPaymentClient, registry, factories, legacy constructor.\n";
p_int += "14) From root FIX until green:\n";
p_int += "    bun run typecheck && bun run typecheck:types && bun test && bun run build\n";
p_int += "15) If Stream A failed, implement foundation yourself — Phase 3 cannot ship without it.\n";
p_int += "16) Re-read for logical bugs: partial amount checks must not block full capture/refund;\n";
p_int += "    supports must match capabilities; factory manifest must match instance; frozen objects;\n";
p_int += "    no await in sync SQLite N/A; no secret leakage.\n";
p_int += "17) Preserve monorepo Phase 1 structure and Phase 0/1/2 gate reports.\n";
p_int += "18) Run capability doc generator so md is up to date.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase3",
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
p_ver += "Verify Phase 3 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun run typecheck:types\n";
p_ver += "3) cd " + root + " && bun test\n";
p_ver += "4) cd " + root + " && bun test --coverage packages/core  (or bun run test:coverage)\n";
p_ver += "5) cd " + root + " && bun run build\n";
p_ver += "6) test -f packages/core/dist/index.js && test -f packages/core/dist/index.d.ts\n";
p_ver += "7) Confirm dist/.d.ts exports supports, GatewayCapabilities, GATEWAY_CAPABILITY_KEYS, OperationNotSupportedError fields\n";
p_ver += "8) bun run validate:package OR pack:check + publint + attw + consumer smoke\n";
p_ver += "9) bun run check:boundaries\n";
p_ver += "10) Evidence of capability tests and claim validation tests\n";
p_ver += "11) Evidence docs/gateway-capabilities.md exists and is generated-style\n";
p_ver += "12) Run docs:capabilities script if present; confirm exit 0\n";
p_ver += "13) Spot-check: import dist and call stripeGateway({secretKey:'sk_test'}).create(...).supports('payments')\n\n";
p_ver += "Set capabilities_ok=true only if supports()+capabilities exist on gateways and public API.\n";
p_ver += "Set docs_ok=true only if generated comparison docs exist and script works.\n";
p_ver += "Set claim_validation_ok=true only if claim validation tests exist and pass.\n";
p_ver += "Set ok=true only if typecheck, typecheck:types, tests, coverage thresholds, build, pack validation,\n";
p_ver += "capabilities_ok, docs_ok, claim_validation_ok all pass with evidence.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase3",
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
    write_scratch_file("phase3-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 3 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 3 — each PASS or BLOCKING:\n";
p_gate += "A1) Consumers can inspect support before invocation.\n";
p_gate += "    Evidence: supports() and/or capabilities on gateway; tests; public types.\n";
p_gate += "A2) Unsupported operations fail consistently with capability metadata.\n";
p_gate += "    Evidence: OperationNotSupportedError includes capability field when capability-gated;\n";
p_gate += "    client throws for false claims; tests for partial refunds/voids/etc.\n";
p_gate += "A3) Capability documentation is generated from code.\n";
p_gate += "    Evidence: generator script + docs/gateway-capabilities.md from capability constants/manifests;\n";
p_gate += "    not a hand-only stale table with no generator.\n\n";
p_gate += "Also require Phase 3 tasks 3.1-3.4 deliverables:\n";
p_gate += "- Stable keys covering all listed capability domains\n";
p_gate += "- Capability queries (supports)\n";
p_gate += "- Provider comparison docs generated from manifests/code\n";
p_gate += "- Claim validation tests for every claimed capability (structural/harness; full Phase 4 suite not required)\n";
p_gate += "- Honest built-in claims (true ⇒ method exists for mappable ops)\n";
p_gate += "- Phase 0/1/2 safety net still green (typecheck, tests, build, boundaries, plugin APIs)\n";
p_gate += "- No logical bugs: partial amount gating, freeze, factory/instance parity, 0.x compat for adapters without caps\n\n";
p_gate += "Independently re-run: bun test; bun run typecheck; bun run typecheck:types; sample supports() script.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-3-gate-report.md\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase3-adversarial",
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
    write_scratch_file("phase3-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 3 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 3 only — no Phase 4 testkit package extract, no Phase 5 money.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete capabilities model if incomplete: keys, supports, error metadata, client enforcement,\n";
    p_fix += "honest built-in claims, generated docs, claim validation tests, public exports.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun run typecheck && bun run typecheck:types && bun test && bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run validate:package && bun run check:boundaries\n";
    p_fix += "  regenerate capability docs\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase3-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 3 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test, coverage, build, validate:package, check:boundaries.\n";
    p_re += "Confirm supports(), capability metadata on errors, generated docs, claim validation.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase3-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase3-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 3 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update phase-3-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 3.1-3.4 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase3-final",
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
        write_scratch_file("phase3-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 3 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 3,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
