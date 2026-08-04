let meta = #{
    name: "phase-2-plugin",
    description: "Phase 2 plugin architecture (idempotent gap-repair): no index.ts races; sequential export wiring; skip re-implementation when already shipped",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 2 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "gap-repair foundation, then sequential factories → client → tests/docs" },
        #{ title: "Integrate", detail: "wire exports, legacy compat, docs, type tests; keep green" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, publint, attw, smoke" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 2" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 2 (open gateway plugin architecture) for @paykernel/core",
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
    "required": ["ok", "typecheck_ok", "typecheck_types_ok", "tests_ok", "build_ok", "pack_ok", "publint_ok", "attw_ok", "consumer_ok", "coverage_ok", "legacy_ok", "plugin_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "typecheck_types_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "pack_ok": #{ "type": "boolean" },
        "publint_ok": #{ "type": "boolean" },
        "attw_ok": #{ "type": "boolean" },
        "consumer_ok": #{ "type": "boolean" },
        "coverage_ok": #{ "type": "boolean" },
        "legacy_ok": #{ "type": "boolean" },
        "plugin_ok": #{ "type": "boolean" },
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
    "."
} else {
    args.root
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 2 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 2 critic for @paykernel/core at " + root + ".\n";
p_critic += "READ-ONLY audit (capability read-only). Use read_file, list_dir, grep only.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "IDEMPOTENT: if GatewayAdapter, createGatewayRegistry, createPaymentClient already exist and tests pass,\n";
p_critic += "list residual GAPS only — do not plan a full rewrite of working plugin architecture.\n\n";
p_critic += "Read roadmap.md section \"# Phase 2 — Open Gateway Plugin Architecture\" completely.\n";
p_critic += "Also read Mandatory Engineering Rules (section 4). Phase 0 and Phase 1 are complete — preserve baselines, monorepo layout, pack validation.\n";
p_critic += "Do NOT plan Phase 3 capabilities model, Phase 4 testkit package, or new gateway packages.\n\n";
p_critic += "Audit against EVERY Phase 2 task and acceptance criterion:\n\n";
p_critic += "2.1 Replace the Closed Gateway Name Union\n";
p_critic += "  - Extensibility-sensitive contracts must use open/generic names (string or type param),\n";
p_critic += "    not only the fixed built-in union.\n";
p_critic += "  - Retain BuiltInGatewayName = \"moyasar\" | \"paypal\" | \"paymob\" | \"stripe\"\n";
p_critic += "  - GatewayName may remain as alias of BuiltInGatewayName for 0.x docs/compat, but\n";
p_critic += "    PaymentGateway.name, hooks context gateway field, webhook event gateway field,\n";
p_critic += "    client.gateway(), createPayment gateway arg, handleWebhook gateway arg must accept\n";
p_critic += "    custom names when using the registry API.\n\n";
p_critic += "2.2 Introduce GatewayAdapter\n";
p_critic += "  - interface GatewayAdapter<TName extends string, TGateway extends PaymentGateway>\n";
p_critic += "  - name, manifest: GatewayManifest, create(context: GatewayContext): TGateway\n";
p_critic += "  - GatewayContext: hooks manager, redacting logger, fetch, clock, crypto provider,\n";
p_critic += "    UUID source, optional telemetry sink — NO secrets bag, NO app DB, NO request objects\n\n";
p_critic += "2.3 Make the Registry Type-Safe\n";
p_critic += "  - client.gateway(\"stripe\") returns concrete Stripe gateway type when registered as stripe\n";
p_critic += "  - unknown names fail at compile time for typed registry clients\n";
p_critic += "  - dynamic runtime registration via explicitly less-typed string-keyed API\n\n";
p_critic += "2.4 Immutable Registry Builder\n";
p_critic += "  - createGatewayRegistry().register(...).build()\n";
p_critic += "  - createPaymentClient({ registry, defaultGateway }) and/or gateways map form\n";
p_critic += "  - reject duplicate names unless explicit replace()\n";
p_critic += "  - freeze built registry + manifest set\n";
p_critic += "  - no unregisterGateway on active client\n";
p_critic += "  - hasGateway / configuredGateways\n\n";
p_critic += "2.5 Preserve Legacy Configuration Temporarily\n";
p_critic += "  - new PaymentClient({ moyasar: {...}, stripe: {...}, defaultGateway }) still works\n";
p_critic += "  - mark legacy path deprecated in JSDoc without removing it in 0.x\n\n";
p_critic += "Acceptance criteria:\n";
p_critic += "- Third-party gateway participates in payment ops, webhooks, hooks, logging, error normalization without editing core\n";
p_critic += "- Gateway names inferred from registry\n";
p_critic += "- Built-in config remains usable\n";
p_critic += "- Duplicate registration, immutable registry, concurrent usage tested\n\n";
p_critic += "Inspect packages/core/src thoroughly: client.ts, gateways/*, types/*, hooks/*, index.ts,\n";
p_critic += "public-api*.test.ts, docs/custom-gateways.md. Note hardcoding of gateway construction.\n";
p_critic += "List concrete GAPS. List ALREADY_PRESENT. stream_plan for implement order.\n";
p_critic += "risks: breaking type tests, breaking runtime legacy, secret leakage in context, mutation of live registry,\n";
p_critic += "async inside SQLite N/A, Node-only assumptions in portable core (node:crypto already used in stripe — do not expand).\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase2-audit",
    capability_mode: "read-only",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase2-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 2 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 2\"}";
}

// ─── Implement foundation (sequential) ───────────────────────────
phase("Implement");
log("Implementing Phase 2.1-2.4 foundation in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Package: @paykernel/core in packages/core — Bun + TypeScript multi-gateway payment SDK.\n";
common += "PHASE 2 ONLY: open gateway plugin architecture. Do NOT start Phase 3 capabilities, Phase 4 testkit package,\n";
common += "or extract gateways to separate packages. Do NOT add new real providers (Adyen etc as first-party).\n";
common += "Do NOT commit. Do NOT push.\n";
common += "IDEMPOTENT GAP MODE: if plugin modules already exist and tests cover A1-A4, only fill critic gaps.\n";
common += "Do NOT rewrite working registry/client for style. Prefer surgical fixes.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs where possible; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0/1 baselines, monorepo, pack validation, coverage thresholds.\n";
common += "Mandatory engineering rules: no secret leakage; no Node-only assumptions NEW in portable plugin APIs;\n";
common += "keep backward compatibility during 0.x; every phase ends with typecheck/tests/build/pack/docs.\n";
common += "No unsafe mutation retries. Never convert uncertain outcomes to failure. Do not hide provider differences.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

let p_a = "";
p_a += common;
p_a += "STREAM A — FOUNDATION (2.1 + 2.2 + 2.4 types/registry). You own core plugin contracts.\n\n";
p_a += "PRECHECK: if packages/core/src/gateways/gateway-adapter.ts, gateway-registry.ts, gateway-context.ts exist\n";
p_a += "and createGatewayRegistry works in tests, only repair gaps (do not recreate from scratch).\n\n";
p_a += "Create or repair these modules under packages/core/src (public exports must match):\n\n";
p_a += "1) packages/core/src/types/payment.types.ts (edit):\n";
p_a += "   - Add: export type BuiltInGatewayName = \"moyasar\" | \"paypal\" | \"paymob\" | \"stripe\";\n";
p_a += "   - Change GatewayName: for 0.x public surface keep GatewayName = BuiltInGatewayName with JSDoc noting\n";
p_a += "     open names are supported via registry generics / string on open contracts.\n";
p_a += "   - Prefer introducing export type GatewayId = string; for open gateway identifiers used by\n";
p_a += "     PaymentGateway.name, HookContext.gateway, WebhookEvent.gateway, and typed client methods.\n";
p_a += "   - BuiltInGatewayName must remain assignable to GatewayId.\n";
p_a += "   - Update public-api type tests carefully: closed GatewayName still rejects \"adyen\" if GatewayName stays closed;\n";
p_a += "     open contracts must accept custom string names.\n\n";
p_a += "2) packages/core/src/gateways/gateway.interface.ts:\n";
p_a += "   - PaymentGateway becomes generic-friendly:\n";
p_a += "     interface PaymentGateway<TName extends string = string> { readonly name: TName; ... }\n";
p_a += "   - All existing methods stay; optional methods stay optional.\n";
p_a += "   - BaseGateway abstract name should be string (or generic), not only BuiltInGatewayName.\n\n";
p_a += "3) packages/core/src/gateways/gateway-manifest.ts (NEW):\n";
p_a += "   - export interface GatewayManifest {\n";
p_a += "       readonly name: string;\n";
p_a += "       readonly displayName?: string;\n";
p_a += "       readonly version?: string;\n";
p_a += "       readonly apiVersion?: string;\n";
p_a += "       // Leave room for Phase 3 capabilities without implementing them now\n";
p_a += "       readonly metadata?: Readonly<Record<string, unknown>>;\n";
p_a += "     }\n\n";
p_a += "4) packages/core/src/gateways/gateway-context.ts (NEW):\n";
p_a += "   - GatewayContext with ONLY shared deps:\n";
p_a += "     hooks: HooksManager\n";
p_a += "     logger: Logger  (already redacting when from client)\n";
p_a += "     fetch: typeof globalThis.fetch\n";
p_a += "     clock: { now(): Date; nowMs(): number }\n";
p_a += "     crypto: CryptoProvider — use Web Crypto where possible:\n";
p_a += "       randomUUID(): string; getRandomValues(array); subtle?: SubtleCrypto\n";
p_a += "     uuid: () => string  (may delegate to crypto.randomUUID)\n";
p_a += "     telemetry?: TelemetrySink  // minimal: { emit?(event: string, data?: Record<string, unknown>): void }\n";
p_a += "   - Provide createDefaultGatewayContext(partial) factory for tests / adapters.\n";
p_a += "   - Defaults: globalThis.fetch, Date-based clock, globalThis.crypto when available, fallback UUID v4 via crypto.getRandomValues.\n";
p_a += "   - Do NOT put secret keys in context. Do NOT put Node-only APIs as required surface.\n\n";
p_a += "5) packages/core/src/gateways/gateway-adapter.ts (NEW):\n";
p_a += "   - export interface GatewayAdapter<\n";
p_a += "       TName extends string = string,\n";
p_a += "       TGateway extends PaymentGateway<TName> = PaymentGateway<TName>,\n";
p_a += "     > {\n";
p_a += "       readonly name: TName;\n";
p_a += "       readonly manifest: GatewayManifest;\n";
p_a += "       create(context: GatewayContext): TGateway;\n";
p_a += "     }\n\n";
p_a += "6) packages/core/src/gateways/gateway-registry.ts (NEW):\n";
p_a += "   - Type: GatewayMap = Record<string, PaymentGateway> (map of name -> instance type)\n";
p_a += "   - createGatewayRegistry(): GatewayRegistryBuilder<{}>\n";
p_a += "   - Builder methods:\n";
p_a += "     register<N extends string, G extends PaymentGateway<N>>(adapter: GatewayAdapter<N, G>):\n";
p_a += "       GatewayRegistryBuilder previous & { [K in N]: G }\n";
p_a += "       - throws InvalidRequestError on duplicate name\n";
p_a += "     replace<N extends string, G extends PaymentGateway<N>>(adapter: GatewayAdapter<N, G>):\n";
p_a += "       same map type with N overwritten (explicit replacement only)\n";
p_a += "     build(): ImmutableGatewayRegistry<TMap>\n";
p_a += "   - ImmutableGatewayRegistry<TMap>:\n";
p_a += "     - stores adapters frozen (Object.freeze adapters array/map + freeze each manifest)\n";
p_a += "     - createAll(context: GatewayContext): { [K in keyof TMap]: TMap[K] }  OR materialize gateways once\n";
p_a += "     - getAdapter(name), has(name), names(): readonly (keyof TMap & string)[]\n";
p_a += "     - manifests(): readonly GatewayManifest[]\n";
p_a += "     - NO unregister, NO register after build\n";
p_a += "   - Dynamic less-typed API:\n";
p_a += "     createDynamicGatewayRegistry() or registerDynamic on builder that accepts GatewayAdapter<string, PaymentGateway>\n";
p_a += "     and yields string-keyed registry (loss of static inference). Document clearly.\n";
p_a += "   - Prefer materializing gateway instances at client construction time (immutable map of instances),\n";
p_a += "     not re-creating per request.\n\n";
p_a += "7) Export from packages/core/src/gateways/index.ts and packages/core/src/index.ts:\n";
p_a += "   GatewayAdapter, GatewayManifest, GatewayContext, createGatewayRegistry, createDefaultGatewayContext,\n";
p_a += "   BuiltInGatewayName, GatewayId (if added), ImmutableGatewayRegistry types, factory helpers later in stream B/C.\n\n";
p_a += "8) Unit tests: packages/core/src/gateways/gateway-registry.test.ts\n";
p_a += "   - register two adapters, build, names match\n";
p_a += "   - duplicate register throws\n";
p_a += "   - replace allows overwrite\n";
p_a += "   - built registry frozen / second build independent\n";
p_a += "   - manifest freeze (attempt mutation no-op or throws in strict)\n\n";
p_a += "9) Do NOT rewrite PaymentClient in this stream beyond what's required for types to compile if you must touch imports.\n";
p_a += "   Prefer leaving client refactor to Stream B. If you change PaymentGateway generics, fix BaseGateway and built-in gateways' name types to compile.\n";
p_a += "10) Keep existing gateway classes working (name as const for built-ins).\n";
p_a += "11) After edits: bun run typecheck and bun test from root — fix until green or note blockers for integrate.\n";

let a_result = agent(p_a, #{
    label: "impl:2.1-2.4-foundation",
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

// Parallel: client refactor + built-in factories + tests/docs
log("Implementing Phase 2 client, factories, tests in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — PaymentClient refactor + createPaymentClient + legacy compat (2.3, 2.4, 2.5).\n";
p_b += "PRECONDITION: Stream A should have GatewayAdapter, GatewayContext, createGatewayRegistry, open name types.\n";
p_b += "If foundation is incomplete, implement the minimum needed for client to work (do not invent parallel type systems).\n\n";
p_b += "OWN PATHS primarily:\n";
p_b += "- packages/core/src/client.ts\n";
p_b += "- packages/core/src/types/config.types.ts\n";
p_b += "- packages/core/src/index.ts (exports for createPaymentClient — YOU sole owner of root index exports for plugin API)\n";
p_b += "- packages/core/src/create-payment-client.ts (NEW if cleaner than bloating client.ts)\n";
p_b += "Do NOT edit gateways/factories.ts (Stream C). Run AFTER Stream C factories exist.\n\n";
p_b += "TARGET API (must work):\n";
p_b += "```ts\n";
p_b += "const payments = createPaymentClient({\n";
p_b += "  gateways: {\n";
p_b += "    stripe: stripeGateway({ secretKey: '...' }),\n";
p_b += "    moyasar: moyasarGateway({ secretKey: '...' }),\n";
p_b += "    custom: customAdapter,\n";
p_b += "  },\n";
p_b += "  defaultGateway: 'moyasar',\n";
p_b += "});\n";
p_b += "payments.gateway('stripe'); // concrete type when map is typed\n";
p_b += "```\n";
p_b += "AND registry form:\n";
p_b += "```ts\n";
p_b += "const registry = createGatewayRegistry()\n";
p_b += "  .register(stripeGateway({ secretKey }))\n";
p_b += "  .register(moyasarGateway({ secretKey }))\n";
p_b += "  .build();\n";
p_b += "const client = createPaymentClient({ registry, defaultGateway: 'moyasar' });\n";
p_b += "client.hasGateway('stripe');\n";
p_b += "client.configuredGateways();\n";
p_b += "```\n\n";
p_b += "DESIGN RULES:\n";
p_b += "1) PaymentClient should be generic over a registry map TGateways extends Record<string, PaymentGateway>.\n";
p_b += "   - gateway<K extends keyof TGateways & string>(name: K): TGateways[K]\n";
p_b += "   - configuredGateways(): Array<keyof TGateways & string>\n";
p_b += "   - hasGateway(name: string): boolean (or keyof)\n";
p_b += "   - createPayment/capture/refund/void/getPayment/getPaymentStatus/handleWebhook accept\n";
p_b += "     gateway?: keyof TGateways & string (or GatewayId) for open registries\n";
p_b += "   - Keep overload convenience for built-in Stripe/Moyasar/etc when still useful, but do not block custom names.\n";
p_b += "2) Immutable after construction: private Map or frozen object of instances; NO unregisterGateway; NO public register on live client.\n";
p_b += "3) Build GatewayContext once in constructor and pass to adapters.create(context).\n";
p_b += "4) Legacy constructor config STILL WORKS:\n";
p_b += "   new PaymentClient({ moyasar: { secretKey }, defaultGateway: 'moyasar', hooks, logger })\n";
p_b += "   Internally convert legacy config to adapters (or keep existing construction path) — mark @deprecated in JSDoc\n";
p_b += "   pointing to createPaymentClient + registry/gateways map.\n";
p_b += "5) assertGatewayCredentials still for legacy path; adapter factories validate their own config.\n";
p_b += "6) Fail fast if defaultGateway set but not registered (same as today).\n";
p_b += "7) HooksManager + redacting logger behavior UNCHANGED for webhooks and after-hooks isolation.\n";
p_b += "8) createPaymentClient is the preferred factory; may return PaymentClient instance.\n";
p_b += "9) When both legacy keys and registry/gateways provided, fail with InvalidRequestError (ambiguous) OR define clear precedence — prefer FAIL CLOSED ambiguous config.\n";
p_b += "10) Support gateways map form that is sugar for register-all then build.\n";
p_b += "11) Export createPaymentClient from index.\n";
p_b += "12) Update hooks.types HookContext.gateway and WebhookEvent.gateway to GatewayId/string so custom gateways work.\n";
p_b += "13) Run typecheck + tests; fix client.test.ts breakages from signature changes.\n";
p_b += "14) Do not extract stripe/moyasar into separate packages.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — Built-in GatewayAdapter factories (stripeGateway, moyasarGateway, paypalGateway, paymobGateway).\n";
p_c += "OWN PATHS:\n";
p_c += "- packages/core/src/gateways/adapters/ or packages/core/src/gateways/*-adapter.ts / factories.ts\n";
p_c += "- Prefer packages/core/src/gateways/factories.ts exporting all four factories\n";
p_c += "- Wire exports in gateways/index.ts ONLY (Stream B owns packages/core/src/index.ts)\n";
p_c += "- Minimal changes to existing *Gateway classes: accept HooksManager+logger as today;\n";
p_c += "  factories call new XxxGateway(config, context.hooks, context.logger).\n";
p_c += "  Optional: allow gateways to use context.fetch later — NOT required for Phase 2 if existing use global fetch.\n\n";
p_c += "Each factory:\n";
p_c += "```ts\n";
p_c += "export function stripeGateway(config: StripeConfig): GatewayAdapter<'stripe', StripeGateway> {\n";
p_c += "  return {\n";
p_c += "    name: 'stripe',\n";
p_c += "    manifest: { name: 'stripe', displayName: 'Stripe', version: '0.8.0' },\n";
p_c += "    create(context) { return new StripeGateway(config, context.hooks, context.logger); },\n";
p_c += "  };\n";
p_c += "}\n";
p_c += "```\n";
p_c += "Same for moyasar, paypal, paymob with correct config types.\n";
p_c += "Validate non-empty secrets in factory create() or at factory call time (match PaymentClient.assertGatewayCredentials).\n";
p_c += "Export factories from gateways/index.ts; Stream B re-exports from package root index.\n";
p_c += "If Stream B needs these symbols, ensure names match roadmap: stripeGateway, moyasarGateway, etc.\n";
p_c += "Small unit test that factories produce correct name/manifest and create() returns gateway with matching name.\n";
p_c += "Do NOT rewrite provider HTTP logic.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — Tests + docs for Phase 2 acceptance criteria.\n";
p_d += "OWN PATHS:\n";
p_d += "- packages/core/src/plugin-architecture.test.ts (NEW) — comprehensive runtime tests\n";
p_d += "- packages/core/src/public-api.types.test.ts — type-level: registry inference, unknown name error, BuiltInGatewayName\n";
p_d += "- packages/core/src/public-api.test.ts — export surface includes new APIs\n";
p_d += "- packages/core/docs/custom-gateways.md — rewrite for first-class plugins\n";
p_d += "- packages/core/docs/plugin-architecture.md (NEW) — registry, createPaymentClient, legacy migration\n";
p_d += "- packages/core/README.md brief mention if needed\n";
p_d += "- packages/core/docs/baseline/ only if needed for note; do not delete Phase 0/1 reports\n\n";
p_d += "REQUIRED TESTS (plugin-architecture.test.ts):\n";
p_d += "1) Third-party custom gateway via createPaymentClient gateways map:\n";
p_d += "   - implements PaymentGateway with name 'custom' (or 'example')\n";
p_d += "   - createPayment returns normalized result\n";
p_d += "   - handleWebhook verifies + parses; onWebhookVerified runs\n";
p_d += "   - hooks beforeCreatePayment fires with gateway name 'custom'\n";
p_d += "   - logger receives redacted logs if gateway logs secrets (or client logger path works)\n";
p_d += "   - errors thrown as PaymentError subclasses still propagate\n";
p_d += "2) Registry builder path works end-to-end\n";
p_d += "3) Duplicate register throws; replace works\n";
p_d += "4) Built registry is immutable (no register method; Object.isFrozen where applied)\n";
p_d += "5) Legacy new PaymentClient({ moyasar: { secretKey: 'sk_test_x' }, defaultGateway: 'moyasar' }) still constructs\n";
p_d += "6) Concurrent usage: Promise.all createPayment on two gateways or parallel ops without registry swap mid-flight\n";
p_d += "   (assert instances stable; no race adding gateways)\n";
p_d += "7) hasGateway / configuredGateways reflect registry\n";
p_d += "8) defaultGateway validation still fails when missing\n";
p_d += "9) Ambiguous config (legacy + registry) fails closed if that was the design\n\n";
p_d += "TYPE TESTS:\n";
p_d += "- BuiltInGatewayName equals the four strings\n";
p_d += "- Typed client from createPaymentClient with stripe+custom: gateway('stripe') is StripeGateway if possible;\n";
p_d += "  gateway('custom') is custom type; gateway('nope') is @ts-expect-error\n";
p_d += "- Legacy GatewayName still closed if retained; document\n";
p_d += "Update old type tests that assumed client only accepts built-in names on ALL paths — split legacy vs open.\n\n";
p_d += "DOCS: honest migration from closed client to plugins; no false claims about Phase 3 capabilities.\n";
p_d += "Run AFTER Streams A-C. Prefer fixing tests/docs only; implement thin glue only if blockers remain.\n";
p_d += "Do NOT rewrite gateway-registry or client.ts wholesale.\n";

// Sequential: if A failed, skip fan-out (integrate recovers foundation).
// Order C (factories) → B (client + root index) → D (tests/docs) to avoid index.ts races.
let impl_ok = if a_ok { 1 } else { 0 };
let impl_fail = if a_ok { 0 } else { 1 };

if !a_ok {
    log("Stream A failed — skipping implement fan-out; integrate will recover foundation");
} else {
    let c_result = agent(p_c, #{
        label: "impl:2.2-builtin-factories",
        capability_mode: "all",
        output_schema: implement_schema,
    });
    if c_result != () && c_result.success && c_result.output != () && c_result.output.ok == true {
        impl_ok += 1;
        log("OK implement C: " + c_result.output.summary);
    } else {
        impl_fail += 1;
        log("FAIL implement C");
    }

    let b_result = agent(p_b, #{
        label: "impl:2.3-2.5-client",
        capability_mode: "all",
        output_schema: implement_schema,
    });
    if b_result != () && b_result.success && b_result.output != () && b_result.output.ok == true {
        impl_ok += 1;
        log("OK implement B: " + b_result.output.summary);
    } else {
        impl_fail += 1;
        log("FAIL implement B");
    }

    let d_result = agent(p_d, #{
        label: "impl:2-tests-docs",
        capability_mode: "all",
        output_schema: implement_schema,
    });
    if d_result != () && d_result.success && d_result.output != () && d_result.output.ok == true {
        impl_ok += 1;
        log("OK implement D: " + d_result.output.summary);
    } else {
        impl_fail += 1;
        log("FAIL implement D");
    }
}
log("Implement done ok=" + impl_ok.to_string() + " fail=" + impl_fail.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "You are integrating Phase 2 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 3. Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) BuiltInGatewayName exported; open gateway ids work for plugins.\n";
p_int += "2) GatewayAdapter, GatewayManifest, GatewayContext, createGatewayRegistry, createPaymentClient exported.\n";
p_int += "3) stripeGateway, moyasarGateway, paypalGateway, paymobGateway exported.\n";
p_int += "4) createPaymentClient({ gateways }) and createPaymentClient({ registry }) both work.\n";
p_int += "5) Legacy new PaymentClient({ moyasar, stripe, ... }) still works and is deprecated in JSDoc.\n";
p_int += "6) Typed gateway() returns concrete types for typed registries; unknown names type-error.\n";
p_int += "7) No unregister on live client; built registry frozen; duplicate register throws; replace exists.\n";
p_int += "8) Third-party gateway test covers payments + webhooks + hooks without editing core for that gateway.\n";
p_int += "9) public index exports complete; no broken re-exports.\n";
p_int += "10) docs/custom-gateways.md and plugin-architecture.md accurate.\n";
p_int += "11) PaymentGateway.name is open string/generic; BaseGateway and all four built-ins compile.\n";
p_int += "12) HookContext.gateway and WebhookEvent.gateway accept custom names.\n";
p_int += "13) From root FIX until green:\n";
p_int += "    bun run typecheck && bun run typecheck:types && bun test && bun run build\n";
p_int += "14) If Stream A failed, implement foundation yourself — Phase 2 cannot ship without it.\n";
p_int += "15) If factories and client disagree on import paths, unify.\n";
p_int += "16) Preserve monorepo Phase 1 structure and Phase 0 baselines.\n";
p_int += "17) No secret leakage in GatewayContext or logs.\n";
p_int += "18) Prefer Web APIs in new portable plugin code; do not require node:crypto in GatewayContext.\n";
p_int += "19) Update GatewayNameSchema only if needed; zod runtime validation for built-in names can stay for legacy helpers.\n";
p_int += "20) Re-read client.ts for logic bugs: double-construction, mutable maps, wrong defaultGateway check.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase2",
    capability_mode: "all",
    output_schema: implement_schema,
});
let integrate_ok = false;
if int_result != () && int_result.success && int_result.output != () && int_result.output.ok == true {
    integrate_ok = true;
    log("Integrate OK: " + int_result.output.summary);
} else {
    log("Integrate reported issues — verify will surface details");
}


let force_fail = false;
if !a_ok {
    force_fail = true;
    log("FORCE_FAIL: Stream A foundation failed");
}
if impl_fail >= 2 {
    force_fail = true;
    log("FORCE_FAIL: multiple implement streams failed");
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify Phase 2 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun run typecheck:types\n";
p_ver += "3) cd " + root + " && bun test\n";
p_ver += "4) cd " + root + " && bun test --coverage  (or bun run test:coverage)\n";
p_ver += "5) cd " + root + " && bun run build\n";
p_ver += "6) test -f packages/core/dist/index.js && test -f packages/core/dist/index.d.ts\n";
p_ver += "7) Confirm dist exports include createPaymentClient, createGatewayRegistry, factories (grep .d.ts)\n";
p_ver += "8) bun run validate:package OR pack:check + publint + attw + consumer smoke\n";
p_ver += "9) bun run check:boundaries (must still pass)\n";
p_ver += "10) Grep evidence of tests: plugin-architecture or registry tests; custom gateway e2e\n";
p_ver += "11) Grep that client has no unregisterGateway public method\n";
p_ver += "12) Legacy construction still present\n\n";
p_ver += "Set plugin_ok=true only if createPaymentClient + registry + custom gateway path exist and tests cover them.\n";
p_ver += "Set legacy_ok=true only if legacy PaymentClient config still works (tests pass).\n";
p_ver += "Set ok=true only if typecheck, typecheck:types, tests, coverage thresholds, build, pack validation,\n";
p_ver += "plugin_ok and legacy_ok all pass with evidence.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase2",
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
    write_scratch_file("phase2-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 2 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 2 — each PASS or BLOCKING:\n";
p_gate += "A1) A third-party gateway participates in payment operations, webhooks, hooks, logging, and error normalization without editing core.\n";
p_gate += "    Evidence: test with custom GatewayAdapter; handleWebhook + hooks; no core file edited to add that gateway name.\n";
p_gate += "A2) Gateway names are inferred from the registry.\n";
p_gate += "    Evidence: type tests and/or generic PaymentClient; gateway() typed by registry keys.\n";
p_gate += "A3) Current built-in configuration remains usable during migration.\n";
p_gate += "    Evidence: legacy constructor tests still pass; JSDoc deprecation OK.\n";
p_gate += "A4) Duplicate registration, immutable registry behavior, and concurrent usage are tested.\n";
p_gate += "    Evidence: tests exist and pass for each.\n\n";
p_gate += "Also require Phase 2 tasks 2.1-2.5 deliverables:\n";
p_gate += "- BuiltInGatewayName retained\n";
p_gate += "- GatewayAdapter + GatewayManifest + GatewayContext (hooks, logger, fetch, clock, crypto, uuid, optional telemetry)\n";
p_gate += "- Type-safe registry; dynamic less-typed API exists\n";
p_gate += "- createGatewayRegistry builder; freeze; no unregister on client; hasGateway/configuredGateways\n";
p_gate += "- Legacy config preserved\n";
p_gate += "- createPaymentClient preferred API\n";
p_gate += "- Phase 0/1 safety net still green\n";
p_gate += "- No logical bugs: credentials validation, defaultGateway check, frozen registry mid-flight safety\n\n";
p_gate += "Independently re-run: bun test; bun run typecheck; bun run typecheck:types; sample custom gateway script if useful.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-2-gate-report.md\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase2-adversarial",
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
    write_scratch_file("phase2-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 2 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 2 only — no Phase 3 capabilities suite, no testkit package extract.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete plugin architecture if incomplete. Ensure third-party path, registry immutability, legacy compat, tests, docs.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun run typecheck && bun run typecheck:types && bun test && bun test --coverage\n";
    p_fix += "  bun run build && bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase2-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 2 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test, coverage, build, validate:package, check:boundaries.\n";
    p_re += "Confirm plugin APIs, legacy path, immutability tests, custom gateway e2e.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase2-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase2-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 2 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A4 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update phase-2-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 2.1-2.5 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase2-final",
        capability_mode: "all",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        gate_summary = gate2.output.summary;
        log("Final gate pass=" + gate_pass.to_string() + " — " + gate_summary);
        write_scratch_file("phase2-gate-final.json", json_encode(gate2.output));
    } else {
        gate_pass = false;
        gate_summary = "final gate agent failed";
    }
}

// ─── Complete ────────────────────────────────────────────────────
if force_fail && gate_pass && !verify_ok {
    gate_pass = false;
    gate_summary = "FAIL: foundation/implement failed and verify not green (" + gate_summary + ")";
}
let final_status = if gate_pass { "PASS" } else { "FAIL" };
let report = "";
report += "# Phase 2 Workflow Result\n\n";
report += "Status: **" + final_status + "**\n\n";
report += "Gate: " + gate_summary + "\n\n";
report += "Verify: " + verify_summary + "\n\n";
report += "Implement streams ok/fail: " + impl_ok.to_string() + "/" + impl_fail.to_string() + "\n";
let report_path = write_scratch_file("phase2-result.md", report);

complete(#{
    status: final_status,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    implement_ok: impl_ok,
    implement_fail: impl_fail,
    summary: gate_summary,
    report_path: report_path,
});
