let meta = #{
    name: "phase-21-safe-routing",
    description: "Phase 21 Safe Routing Policies: critic, implement createPaymentRouter + restricted fallback, integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 21 roadmap 21.1-21.3 and acceptance criteria" },
        #{ title: "Implement", detail: "routing package (rules, select, safe fallback gate) + monorepo wiring + docs" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-20 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 21 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 21" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 21 (Safe Routing Policies) for PayKernel monorepo",
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
        "package_ok", "routing_inputs_ok", "select_separate_ok", "safe_fallback_ok",
        "deterministic_ok", "provider_visible_ok", "docs_ok", "compat_ok",
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
        "routing_inputs_ok": #{ "type": "boolean" },
        "select_separate_ok": #{ "type": "boolean" },
        "safe_fallback_ok": #{ "type": "boolean" },
        "deterministic_ok": #{ "type": "boolean" },
        "provider_visible_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 21 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 21 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 21 — Safe Routing Policies\" completely\n";
p_critic += "(Objective, Target API, 21.1 Routing Inputs, 21.2 Separate Selection from Execution,\n";
p_critic += "21.3 Restrict Fallbacks, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth;\n";
p_critic += "  2 no unsafe mutation retries;\n";
p_critic += "  3 NEVER convert uncertain outcomes into failure;\n";
p_critic += "  4 do not hide provider differences;\n";
p_critic += "  5 no secret leakage;\n";
p_critic += "  6 no framework coupling in core;\n";
p_critic += "  7 no Node-only in portable packages;\n";
p_critic += "  9 phase ends with typecheck/tests/build/docs.\n";
p_critic += "Also section 2.2 Non-Goals — CRITICAL:\n";
p_critic += "  \"Automatically retrying or routing an indeterminate payment to another gateway\" is a NON-GOAL.\n";
p_critic += "Also section 5 Proposed Repository Structure + 5.1 Package Boundary Rules.\n";
p_critic += "Also release sequence §27: 1.1.x Safe routing policies — Phase 21 STILL implements the full\n";
p_critic += "  createPaymentRouter / route / select / restricted fallback API now (0.x additive).\n";
p_critic += "Phases 0-20 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent, PaymentRuntime, store contracts, webhook inbox,\n";
p_critic += "sql-store, all adapters, adapter matrix (18), reconciliation (19), observability (20).\n";
p_critic += "Do NOT start Phase 22+ (customers, hosted checkout, disputes, marketplace, payment links,\n";
p_critic += "new PSP packages, framework integrations).\n";
p_critic += "Do NOT rewrite Phase 5-20 domain/foundation packages unless required for wiring/docs/export re-exports.\n\n";

p_critic += "CONTEXT already present from Phase 0-20:\n";
p_critic += "- PaymentClient.createPayment(params, gateway?) — selection is currently app-supplied gateway string\n";
p_critic += "- GatewayCapabilityKey + defineGatewayCapabilities / supports()\n";
p_critic += "- PaymentOperationOutcome including indeterminate; isIndeterminateOutcome; inferOperationOutcome\n";
p_critic += "- Money helpers (amount as decimal string + currency); NEVER use float for money comparisons\n";
p_critic += "- OperationContext.gateway for telemetry; createRedactingTelemetrySink\n";
p_critic += "- packages/observability, reconciliation, webhooks, testkit, all adapters EXIST\n";
p_critic += "- There is NO createPaymentRouter / route() / packages/routing yet (Phase 20 gate confirmed absent).\n";
p_critic += "- Core must NOT depend on routing package if routing is separate (mirror observability isolation).\n\n";

p_critic += "Audit against EVERY Phase 21 requirement with evidence (grep/read):\n\n";

p_critic += "Objective: Choose gateways using explicit rules while preventing unsafe fallback.\n\n";

p_critic += "Target API (must exist after implement):\n";
p_critic += "```ts\n";
p_critic += "const router = createPaymentRouter({\n";
p_critic += "  rules: [\n";
p_critic += "    route({ currency: \"SAR\", paymentMethod: \"mada\" }).to(\"moyasar\"),\n";
p_critic += "    route({ currency: \"USD\" }).to(\"stripe\"),\n";
p_critic += "  ],\n";
p_critic += "  fallback: \"stripe\",\n";
p_critic += "});\n";
p_critic += "const decision = router.select(input);\n";
p_critic += "await payments.createPayment(input, decision.gateway);\n";
p_critic += "```\n\n";

p_critic += "21.1 Routing Inputs — allow ALL of:\n";
p_critic += "  currency; country; payment method; amount range;\n";
p_critic += "  tenant configuration; capability requirements;\n";
p_critic += "  merchant preference; application-supplied health signal;\n";
p_critic += "  application-supplied cost signal.\n";
p_critic += "  Amount range MUST use money-safe comparison (string/bigint minor units — no float).\n\n";

p_critic += "21.2 Separate Selection from Execution:\n";
p_critic += "  router.select(input) returns a decision object (gateway + match metadata).\n";
p_critic += "  Router MUST NOT call createPayment / capture / refund itself.\n";
p_critic += "  Execution remains: payments.createPayment(input, decision.gateway).\n\n";

p_critic += "21.3 Restrict Fallbacks — CRITICAL safety:\n";
p_critic += "  Fallback is allowed ONLY when the request was not submitted OR a definitive\n";
p_critic += "  pre-submission failure occurred.\n";
p_critic += "  NEVER automatically fallback after:\n";
p_critic += "    timeout; connection reset; provider 5xx with uncertain submission state;\n";
p_critic += "    indeterminate result.\n";
p_critic += "  Unsafe fallback must be STRUCTURALLY prevented (type system + runtime deny)\n";
p_critic += "  OR require an explicit expert override (branded/flagged, never default).\n";
p_critic += "  config.fallback on createPaymentRouter is for SELECT-time when NO rule matches —\n";
p_critic += "  NOT for automatic post-attempt gateway switching after uncertain outcomes.\n";
p_critic += "  Provide a distinct API for post-attempt fallback eligibility, e.g.:\n";
p_critic += "    classifySubmissionState / isSafeFallbackEligible / evaluateFallback\n";
p_critic += "  that DENIES timeout, connection_reset, indeterminate, uncertain_5xx.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) decisions are deterministic and testable\n";
p_critic += "A2) unsafe fallback is structurally prevented or requires explicit expert override\n";
p_critic += "A3) selected provider remains visible in results and telemetry\n\n";

p_critic += "Package design recommendation (critic may refine with evidence):\n";
p_critic += "- Prefer NEW packages/routing = @paykernel/routing (portable, depends on core only)\n";
p_critic += "  mirroring reconciliation/observability isolation — routing is optional orchestration.\n";
p_critic += "- OR core module packages/core/src/routing/ if critic finds strong reason to keep in core.\n";
p_critic += "- If separate package: core must NOT depend on routing; routing must NOT depend on\n";
p_critic += "  testkit/adapters/webhooks/reconciliation/observability/frameworks.\n";
p_critic += "- paymentsSdk.portable: true; no node:/bun: in production sources.\n";
p_critic += "- Decision.gateway string must be usable with PaymentClient.createPayment(params, gateway).\n\n";

p_critic += "Also check monorepo wiring gaps: root package.json scripts omit routing;\n";
p_critic += "docs/monorepo.md and workspace-boundaries lack routing; no CHANGELOG/README/gate report.\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: automatic fallback after indeterminate (violates non-goal + rule 3);\n";
p_critic += "float money amount range; non-deterministic rule order; router executing payments;\n";
p_critic += "hiding selected gateway; expert override defaulted on; Phase 22 scope creep;\n";
p_critic += "coupling routing to observability hard dep; breaking PaymentClient signatures.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase21-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase21-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 21 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 21\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 21 Safe Routing Policies in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core.\n";
common += "Webhooks/reconciliation/observability/testkit/adapters Phase 0-20 COMPLETE — preserve fully.\n";
common += "PHASE 21 ONLY: Safe routing policies — createPaymentRouter, route(), select(), restricted fallback.\n";
common += "Do NOT implement Phase 22+ (customers, hosted checkout, disputes, marketplace, new PSPs).\n";
common += "Do NOT rewrite adapters, webhooks engine, reconciliation, or observability internals.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside routing/wiring;\n";
common += "re-read changed regions. Tests are source of truth. Preserve Phase 0-20 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior (match rules, order, fallback select, safe/unsafe post-attempt).\n";
common += "2) NEVER auto-route/retry indeterminate payments to another gateway (non-goal + rule 3).\n";
common += "3) No unsafe mutation retries via router.\n";
common += "4) No secret leakage in routing decision logs/telemetry attributes.\n";
common += "5) No framework coupling; portable package only.\n";
common += "6) No Node-only assumptions — Web APIs / pure TS.\n";
common += "7) exactOptionalPropertyTypes is ON — omit optional keys when absent; never assign undefined.\n";
common += "8) Money amount ranges: use string decimal or bigint minor units — NEVER Number float compare.\n";
common += "9) Core must NOT depend on @paykernel/routing if package is separate.\n";
common += "10) Routing must NOT depend on testkit/adapters/webhooks/reconciliation/observability.\n";
common += "11) Selected gateway MUST appear on RoutingDecision and remain usable for telemetry.\n";
common += "12) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: Routing package core API
let p_a = "";
p_a += common;
p_a += "STREAM A — packages/routing @paykernel/routing (21.1, 21.2, 21.3 API + tests).\n";
p_a += "OWN: packages/routing/** (NEW package). May depend on @paykernel/core (core) only.\n";
p_a += "Do NOT write phase-21-gate-report.md (Gate owns it).\n";
p_a += "Do NOT edit root package.json scripts here if Stream C will — but you MAY create package.json and bun install.\n\n";

p_a += "### Create package packages/routing\n";
p_a += "Name: @paykernel/routing version 0.1.0\n";
p_a += "type module; exports \".\" only (no driver subpaths)\n";
p_a += "main/types dist; files: dist, docs, README, LICENSE, CHANGELOG\n";
p_a += "dependency: @paykernel/core workspace:*\n";
p_a += "devDependencies: @types/bun, typescript\n";
p_a += "paymentsSdk: { portable: true }\n";
p_a += "publishConfig access public provenance true\n";
p_a += "scripts: build (bun build + build:types), typecheck, test — mirror packages/reconciliation\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist, exclude **/*.test.ts\n";
p_a += "Copy MIT LICENSE from packages/reconciliation or packages/webhooks\n";
p_a += "After package.json exists: run bun install from monorepo root.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/routing/src/\n";
p_a += "  index.ts                 # public exports\n";
p_a += "  types.ts                 # RoutingInput, RoutingRule, RoutingDecision, SubmissionState, etc.\n";
p_a += "  route.ts                 # route(match).to(gateway) builder\n";
p_a += "  router.ts                # createPaymentRouter + select\n";
p_a += "  match.ts                 # pure deterministic matchers for all 21.1 inputs\n";
p_a += "  amount-range.ts          # money-safe range checks (string/bigint; no float)\n";
p_a += "  fallback.ts              # isSafeFallbackEligible / evaluateFallback / expert override\n";
p_a += "  errors.ts                # typed errors: NoRouteMatchError, UnsafeFallbackDeniedError, etc.\n";
p_a += "  public-api.test.ts\n";
p_a += "  router.test.ts / match.test.ts / fallback.test.ts / amount-range.test.ts\n\n";

p_a += "### 21.1 RoutingInput + rule match criteria\n";
p_a += "```ts\n";
p_a += "export type RoutingInput = {\n";
p_a += "  currency?: string;\n";
p_a += "  country?: string;\n";
p_a += "  paymentMethod?: string;\n";
p_a += "  /** Money-shaped amount OR decimal string + currency for range checks */\n";
p_a += "  amount?: { amount: string; currency: string } | string;\n";
p_a += "  amountCurrency?: string; // when amount is plain decimal string\n";
p_a += "  tenant?: string;\n";
p_a += "  tenantConfig?: Record<string, string | number | boolean>;\n";
p_a += "  /** Required capabilities the selected gateway must claim true */\n";
p_a += "  requiredCapabilities?: readonly string[]; // GatewayCapabilityKey or string\n";
p_a += "  merchantPreference?: string; // preferred gateway id\n";
p_a += "  /** App-supplied: lower is healthier or boolean healthy map — document convention */\n";
p_a += "  health?: Record<string, number | boolean>; // per-gateway health signal\n";
p_a += "  /** App-supplied cost score per gateway (lower preferred when used as tie-break) */\n";
p_a += "  cost?: Record<string, number | string>; // number score or decimal string\n";
p_a += "  /** Optional map of gatewayId -> capability snapshot for capability filtering */\n";
p_a += "  gatewayCapabilities?: Record<string, Partial<Record<string, boolean>>>;\n";
p_a += "};\n";
p_a += "```\n";
p_a += "route({ currency, country, paymentMethod, amountMin, amountMax, amountCurrency,\n";
p_a += "  tenant, tenantConfig, requiredCapabilities, merchantPreference, ... }).to(gatewayId)\n";
p_a += "Matching rules (document + test):\n";
p_a += "- Unspecified criteria are wildcards (match any).\n";
p_a += "- Specified criteria must all match (AND).\n";
p_a += "- currency/country/paymentMethod: case-insensitive string equality after trim.\n";
p_a += "- amount range: inclusive min/max using money-safe compare in same currency.\n";
p_a += "- tenant / tenantConfig: exact match for specified keys.\n";
p_a += "- requiredCapabilities: gateway must have all keys true in gatewayCapabilities[gateway] if provided;\n";
p_a += "  if capability map missing for candidate, treat as not satisfying required capabilities (fail-closed).\n";
p_a += "- merchantPreference: optional boost/priority when evaluating among matches OR as a match criterion\n";
p_a += "  when set on the rule; document chosen semantics clearly.\n";
p_a += "- health signal: when provided on input, exclude gateways marked unhealthy (false) or\n";
p_a += "  below configurable threshold; if primary match is unhealthy, do NOT auto-jump to another gateway\n";
p_a += "  for post-attempt — select-time only may pick next matching rule if health is part of selection.\n";
p_a += "  Prefer: health filters candidates at select time before choosing first matching rule.\n";
p_a += "- cost signal: optional deterministic tie-break among equal-priority matches (stable sort by cost then gateway id).\n";
p_a += "FIRST matching rule in rules array wins after filters (deterministic order). Document this.\n\n";

p_a += "### 21.2 createPaymentRouter + select (NO execution)\n";
p_a += "```ts\n";
p_a += "export type RoutingDecision = {\n";
p_a += "  gateway: string;\n";
p_a += "  matched: boolean;           // true if a rule matched\n";
p_a += "  usedFallback: boolean;     // true if config.fallback used because no rule matched\n";
p_a += "  ruleIndex?: number;        // index of matched rule when matched\n";
p_a += "  reason: string;            // stable machine-readable reason code\n";
p_a += "};\n";
p_a += "export type PaymentRouter = {\n";
p_a += "  select(input: RoutingInput): RoutingDecision;\n";
p_a += "  /** Inspect configured rules (frozen) for tests */\n";
p_a += "  readonly rules: readonly RoutingRule[];\n";
p_a += "  readonly fallback: string | undefined;\n";
p_a += "};\n";
p_a += "export function createPaymentRouter(options: {\n";
p_a += "  rules: readonly RoutingRule[];\n";
p_a += "  fallback?: string;\n";
p_a += "  /** When true, select throws if no rule and no fallback; default true fail-closed */\n";
p_a += "  requireMatch?: boolean;\n";
p_a += "}): PaymentRouter;\n";
p_a += "```\n";
p_a += "router.select MUST be pure/sync and deterministic for the same input+config.\n";
p_a += "router MUST NOT call payment APIs, fetch, or have side effects (except optional inject telemetry later — skip for v0).\n";
p_a += "When no rule matches:\n";
p_a += "  - if fallback configured → decision with usedFallback:true, gateway=fallback, reason='fallback'\n";
p_a += "  - else if requireMatch!==false → throw NoRouteMatchError\n";
p_a += "  - else throw or return — prefer fail-closed throw without fallback.\n";
p_a += "NOTE: config.fallback is SELECT-TIME default only — NOT post-attempt recovery.\n\n";

p_a += "### 21.3 Restricted post-attempt fallback (structural safety)\n";
p_a += "Separate from select-time fallback. This prevents unsafe multi-gateway retries.\n";
p_a += "```ts\n";
p_a += "export type SubmissionState =\n";
p_a += "  | \"not_submitted\"            // request never left the client\n";
p_a += "  | \"pre_submission_failure\"   // definitive failure before provider accepted request\n";
p_a += "  | \"submitted\"                // provider may have accepted — DO NOT fallback\n";
p_a += "  | \"indeterminate\"            // timeout / ambiguous — DO NOT fallback\n";
p_a += "  | \"timeout\"                  // DO NOT fallback\n";
p_a += "  | \"connection_reset\"         // DO NOT fallback\n";
p_a += "  | \"provider_5xx_uncertain\";  // DO NOT fallback\n";
p_a += "\n";
p_a += "export type FallbackEligibility = {\n";
p_a += "  allowed: boolean;\n";
p_a += "  reason: string;\n";
p_a += "  submissionState: SubmissionState;\n";
p_a += "};\n";
p_a += "\n";
p_a += "export function isSafeFallbackEligible(state: SubmissionState): boolean;\n";
p_a += "// true ONLY for not_submitted | pre_submission_failure\n";
p_a += "\n";
p_a += "export function evaluateFallback(input: {\n";
p_a += "  submissionState: SubmissionState;\n";
p_a += "  /** Expert override — MUST be explicit branded object; never boolean true alone from app defaults */\n";
p_a += "  expertOverride?: { confirmUnsafeFallback: true; reason: string };\n";
p_a += "}): FallbackEligibility;\n";
p_a += "```\n";
p_a += "Rules:\n";
p_a += "- isSafeFallbackEligible('timeout'|'connection_reset'|'indeterminate'|'provider_5xx_uncertain'|'submitted') === false\n";
p_a += "- evaluateFallback for unsafe states returns allowed:false UNLESS expertOverride with\n";
p_a += "  confirmUnsafeFallback: true AND non-empty reason string is provided.\n";
p_a += "- Expert override path must be OPT-IN and loud (reason recorded on eligibility).\n";
p_a += "- Provide classifyFromOperationOutcome helper mapping PaymentOperationOutcome / common errors:\n";
p_a += "  indeterminate → indeterminate; never maps indeterminate to pre_submission_failure.\n";
p_a += "- Optionally: trySelectFallbackGateway(router, input, eligibility) that ONLY runs select-like\n";
p_a += "  alternative when eligibility.allowed — otherwise throws UnsafeFallbackDeniedError.\n";
p_a += "  Prefer excluding already-attempted gateway from candidates when selecting alternate.\n\n";

p_a += "### Visibility of selected provider (A3)\n";
p_a += "RoutingDecision.gateway is always present when select succeeds.\n";
p_a += "Export decisionToTelemetryAttributes(decision) → { gateway, matched, usedFallback, ruleIndex?, reason }\n";
p_a += "using only non-sensitive fields (no full tenantConfig dumps of secrets).\n";
p_a += "Document that apps should pass decision.gateway into OperationContext.gateway and createPayment.\n\n";

p_a += "### Public exports (index.ts)\n";
p_a += "createPaymentRouter, route,\n";
p_a += "isSafeFallbackEligible, evaluateFallback, classifySubmissionState (or classifyFromOperationOutcome),\n";
p_a += "decisionToTelemetryAttributes,\n";
p_a += "errors: NoRouteMatchError, UnsafeFallbackDeniedError,\n";
p_a += "types: RoutingInput, RoutingDecision, RoutingRule, PaymentRouter, SubmissionState, FallbackEligibility,\n";
p_a += "ExpertUnsafeFallbackOverride (type).\n";
p_a += "public-api.test.ts freezes runtime export names.\n\n";

p_a += "### Tests Stream A (must prove acceptance)\n";
p_a += "- Target API sample works: SAR+mada→moyasar, USD→stripe, fallback stripe\n";
p_a += "- All 21.1 inputs affect matching when set; wildcards when unset\n";
p_a += "- Determinism: same input+rules → identical decision (A1)\n";
p_a += "- Rule order: first match wins\n";
p_a += "- select does not call createPayment (unit test: no side effects)\n";
p_a += "- amount range money-safe (\"10.00\" vs \"9.5\" etc.); rejects cross-currency range silently or explicitly\n";
p_a += "- capability requirements fail-closed without capability map\n";
p_a += "- health filters unhealthy gateways at select time\n";
p_a += "- cost tie-break deterministic\n";
p_a += "- isSafeFallbackEligible false for timeout, connection_reset, indeterminate, provider_5xx_uncertain, submitted (A2)\n";
p_a += "- isSafeFallbackEligible true for not_submitted, pre_submission_failure\n";
p_a += "- evaluateFallback denies unsafe without expert override; allows with confirmUnsafeFallback+reason\n";
p_a += "- classify never maps indeterminate → pre_submission_failure\n";
p_a += "- decision.gateway always set; decisionToTelemetryAttributes includes gateway (A3)\n";
p_a += "- no node:/bun: in production sources\n";
p_a += "Run: cd packages/routing && bun test && bun run typecheck\n";

// Stream B: monorepo wiring
let p_b = "";
p_b += common;
p_b += "STREAM B — MONOREPO WIRING for Phase 21 routing package.\n";
p_b += "OWN: root package.json scripts (build/test/typecheck include routing),\n";
p_b += "docs/monorepo.md, docs/workspace-boundaries.md,\n";
p_b += "scripts/check-workspace-boundaries.ts — add @paykernel/routing isolation like observability:\n";
p_b += "  routing may depend on core only; core must not depend on routing;\n";
p_b += "  routing must not depend on testkit/webhooks/reconciliation/observability/adapters.\n";
p_b += "Do NOT write phase-21-gate-report.md.\n";
p_b += "If packages/routing does not exist yet (Stream A still running), wait/retry or create minimal package.json\n";
p_b += "so workspaces resolve — prefer coordinating after Stream A lands package.json.\n\n";

p_b += "### Root package.json updates (required)\n";
p_b += "build order: core first, then webhooks, reconciliation, observability, routing, then testkit, sql-store, adapters.\n";
p_b += "Include filter for @paykernel/routing in build, build:types, typecheck.\n";
p_b += "test: add packages/routing to bun test list\n";
p_b += "description mention routing package\n";
p_b += "Add test:routing script optional.\n\n";

p_b += "### Boundaries\n";
p_b += "Update check-workspace-boundaries.ts:\n";
p_b += "- ROUTING_PACKAGE_NAME = @paykernel/routing\n";
p_b += "- core must not depend on payments-routing\n";
p_b += "- routing must not depend on forbidden packages (mirror observability rules)\n";
p_b += "Update docs/workspace-boundaries.md layout + matrix table for routing.\n";
p_b += "Update docs/monorepo.md layout description.\n";
p_b += "Update root README package table if packages listed.\n";
p_b += "Run bun install && bun run check:boundaries after wiring.\n";

// Stream C: docs
let p_c = "";
p_c += common;
p_c += "STREAM C — DOCUMENTATION for Phase 21.\n";
p_c += "OWN: packages/routing/README.md, packages/routing/docs/*.md,\n";
p_c += "packages/routing/CHANGELOG.md Unreleased Phase 21,\n";
p_c += "cross-link from packages/core/docs if appropriate (thin pointer),\n";
p_c += "docs/monorepo.md / workspace-boundaries if Stream B didn't fully cover prose.\n";
p_c += "Do NOT write phase-21-gate-report.md (Gate owns it).\n\n";

p_c += "### packages/routing/docs/ MUST cover\n";
p_c += "1) overview.md — purpose: explicit rule-based gateway selection; NO automatic unsafe fallback\n";
p_c += "2) routing-inputs.md — all 21.1 inputs, wildcards, money-safe ranges, health/cost\n";
p_c += "3) selection.md — select vs execute; createPaymentRouter; first-match determinism; fallback select-time only\n";
p_c += "4) safe-fallback.md — 21.3 submission states; never after timeout/reset/5xx-uncertain/indeterminate;\n";
p_c += "   expert override API; non-goal of routing indeterminate payments\n";
p_c += "5) telemetry.md — decision.gateway visibility; decisionToTelemetryAttributes; OperationContext.gateway\n\n";

p_c += "### README\n";
p_c += "Install, quickstart matching Target API, then createPayment with decision.gateway.\n";
p_c += "Explicit warnings about unsafe fallback.\n\n";

p_c += "### CHANGELOG\n";
p_c += "Unreleased: initial @paykernel/routing Phase 21.\n\n";

p_c += "### Accuracy\n";
p_c += "Re-read actual exports after writing; fix wrong API names. No Phase 22 claims.\n";

// Run Stream A first (package must exist), then B+C parallel
let a_result = agent(p_a, #{
    label: "impl:21-routing-pkg",
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

log("Implementing Phase 21 monorepo wiring and docs in parallel");

let jobs = [
    #{ prompt: p_b, label: "impl:21-monorepo", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:21-docs", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok = 0;
let impl_fail = 0;
if a_ok { impl_ok += 1; } else { impl_fail += 1; }
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
p_int += "You are integrating Phase 21 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 22+.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/routing exists as @paykernel/routing@0.1.0 with portable:true.\n";
p_int += "2) createPaymentRouter + route() Target API works (SAR/mada→moyasar, USD→stripe, fallback).\n";
p_int += "3) RoutingInput supports all 21.1 fields: currency, country, paymentMethod, amount range,\n";
p_int += "   tenant/tenantConfig, requiredCapabilities, merchantPreference, health, cost.\n";
p_int += "4) router.select is pure selection — does NOT execute payments (21.2).\n";
p_int += "5) select-time fallback is optional config.fallback when no rule matches ONLY.\n";
p_int += "6) Post-attempt: isSafeFallbackEligible / evaluateFallback DENY timeout, connection_reset,\n";
p_int += "   indeterminate, provider_5xx_uncertain, submitted — allow only not_submitted |\n";
p_int += "   pre_submission_failure unless explicit expert override {confirmUnsafeFallback:true, reason}.\n";
p_int += "7) classify never maps indeterminate to pre_submission_failure (rule 3 / non-goal).\n";
p_int += "8) Amount range money-safe (no float).\n";
p_int += "9) Decisions deterministic; first matching rule wins; tests prove it (A1).\n";
p_int += "10) RoutingDecision.gateway always set; decisionToTelemetryAttributes exposes gateway (A3).\n";
p_int += "11) Core package.json has ZERO dependency on payments-routing.\n";
p_int += "12) Routing depends only on core among workspace packages.\n";
p_int += "13) Docs: overview, routing-inputs, selection, safe-fallback, telemetry, README, CHANGELOG.\n";
p_int += "14) Root scripts build/test/typecheck include routing; monorepo + boundaries docs + checker updated.\n";
p_int += "15) Phase 0-20 safety: typecheck, full package tests, build, boundaries, runtime portability green.\n";
p_int += "16) exactOptionalPropertyTypes clean; public API freeze tests pass.\n";
p_int += "17) dist builds (index.js + .d.ts) for routing.\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks packages/reconciliation packages/observability packages/routing internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "19) If Stream A/B/C failed, implement the missing pieces yourself — Phase 21 cannot ship without them.\n";
p_int += "20) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap Target API).\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase21",
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
p_ver += "Verify Phase 21 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) bun run typecheck\n";
p_ver += "3) bun run typecheck:types\n";
p_ver += "4) bun test packages/core packages/testkit packages/webhooks packages/reconciliation packages/observability packages/routing internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_ver += "5) bun test --coverage packages/core\n";
p_ver += "6) bun run build\n";
p_ver += "7) bun run check:boundaries\n";
p_ver += "8) bun run check:runtime-portability\n";
p_ver += "9) bun run validate:package\n";
p_ver += "10) Evidence packages/routing package.json name @paykernel/routing portable:true\n";
p_ver += "11) Evidence createPaymentRouter + route Target API + all 21.1 inputs\n";
p_ver += "12) Evidence select separate from execution (no payment calls in router)\n";
p_ver += "13) Evidence safe fallback deny list: timeout, connection_reset, indeterminate, provider_5xx_uncertain, submitted\n";
p_ver += "14) Evidence allow not_submitted + pre_submission_failure; expert override opt-in only\n";
p_ver += "15) Evidence deterministic decisions + tests\n";
p_ver += "16) Evidence decision.gateway + decisionToTelemetryAttributes\n";
p_ver += "17) Evidence core has no payments-routing dependency\n";
p_ver += "18) Evidence docs present\n";
p_ver += "19) Evidence dist/index.js and dist/index.d.ts after build for routing\n";
p_ver += "20) Evidence root scripts include routing\n";
p_ver += "21) Evidence no production node:/bun: in packages/routing/src\n\n";
p_ver += "Set flags from verify_schema names:\n";
p_ver += "  routing_inputs_ok, select_separate_ok, safe_fallback_ok, deterministic_ok, provider_visible_ok\n";
p_ver += "Set ok=true only if typecheck, tests, build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase21",
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
    write_scratch_file("phase21-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 21 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 21 — each PASS or BLOCKING:\n";
p_gate += "A1) decisions are deterministic and testable.\n";
p_gate += "    Evidence: pure select; first-match rule order; tests with identical inputs; no random/time deps.\n";
p_gate += "A2) unsafe fallback is structurally prevented or requires explicit expert override.\n";
p_gate += "    Evidence: isSafeFallbackEligible false for timeout, connection_reset, indeterminate,\n";
p_gate += "    provider_5xx_uncertain, submitted; evaluateFallback requires confirmUnsafeFallback+reason;\n";
p_gate += "    classify never maps indeterminate → safe; tests for each deny case.\n";
p_gate += "A3) selected provider remains visible in results and telemetry.\n";
p_gate += "    Evidence: RoutingDecision.gateway always set; decisionToTelemetryAttributes; docs.\n\n";
p_gate += "Also require:\n";
p_gate += "- Target API createPaymentRouter + route + select works\n";
p_gate += "- All 21.1 routing inputs supported\n";
p_gate += "- 21.2 selection separate from execution (router does not pay)\n";
p_gate += "- 21.3 select-time fallback ≠ post-attempt auto-switch after uncertain outcomes\n";
p_gate += "- Money-safe amount ranges (no float)\n";
p_gate += "- Package @paykernel/routing portable with core-only dependency\n";
p_gate += "- Core does not depend on routing\n";
p_gate += "- Phase 0-20 safety net still green\n";
p_gate += "- No Phase 22+ sneak-in (customers/disputes/new PSPs)\n";
p_gate += "- No logical bugs: auto-routing indeterminate; float money; non-deterministic order;\n";
p_gate += "  expert override defaulted; router executing createPayment; hidden gateway.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks packages/reconciliation packages/observability packages/routing internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_gate += "  bun run typecheck; check:boundaries.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/routing/docs/phase-21-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-21-gate-report.md (full or pointer).\n";
p_gate += "AND docs/phase-21-gate-report.md pointer.\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase21-adversarial",
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
    write_scratch_file("phase21-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 21 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 21 only — no Phase 22+.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete createPaymentRouter/route/select, all 21.1 inputs, restricted fallback APIs,\n";
    p_fix += "tests, docs, monorepo wiring. Preserve Phase 0-20.\n";
    p_fix += "After fixes re-run typecheck, full tests (include packages/routing), build, boundaries,\n";
    p_fix += "runtime-portability, validate:package.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase21-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 21 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, full package tests including packages/routing,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm A1-A3 with file and test evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase21-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase21-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 21 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 with independent evidence.\n";
    p_gate2 += "Update packages/routing/docs/phase-21-gate-report.md and baseline pointer.\n";
    p_gate2 += "pass=true only if acceptance criteria are evidenced and suite is green.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase21-final",
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
        write_scratch_file("phase21-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 21 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 21,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
