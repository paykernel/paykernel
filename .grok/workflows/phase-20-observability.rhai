let meta = #{
    name: "phase-20-observability",
    description: "Phase 20 Observability and Operational Diagnostics: critic, implement OperationContext + metrics + redaction + optional OTEL bridge (@paykernel/opentelemetry), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 20 roadmap 20.1-20.4 and acceptance criteria" },
        #{ title: "Implement", detail: "core op-context/redacting telemetry + observability package (metrics, spans, optional OTEL)" },
        #{ title: "Integrate", detail: "wire monorepo workspaces/scripts/boundaries, keep Phase 0-19 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 20 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 20" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 20 (Observability and Operational Diagnostics) for payments-sdk monorepo",
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
        "package_ok", "operation_context_ok", "metrics_ok", "redaction_ok",
        "no_mandatory_otel_core_ok", "provider_request_id_ok", "otel_optional_ok",
        "docs_ok", "compat_ok", "failures", "summary"
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
        "operation_context_ok": #{ "type": "boolean" },
        "metrics_ok": #{ "type": "boolean" },
        "redaction_ok": #{ "type": "boolean" },
        "no_mandatory_otel_core_ok": #{ "type": "boolean" },
        "provider_request_id_ok": #{ "type": "boolean" },
        "otel_optional_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 20 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 20 critic for the payments-sdk monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 20 — Observability and Operational Diagnostics\" completely\n";
p_critic += "(Objective, 20.1 Structured Operation Context, 20.2 Optional OpenTelemetry Integration,\n";
p_critic += "20.3 Metrics, 20.4 Redaction, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage (logs AND telemetry);\n";
p_critic += "  6 no framework coupling in core; 7 no Node-only in portable packages;\n";
p_critic += "  9 phase ends with typecheck/tests/build/docs; 14 no raw payloads by default.\n";
p_critic += "Also section 5 Proposed Repository Structure: packages/observability = optional telemetry package.\n";
p_critic += "Also section 5.1 Package Boundary Rules:\n";
p_critic += "  core must NOT depend on adapters, frameworks, observability OTEL hard deps, webhooks,\n";
p_critic += "  reconciliation, or testkit.\n";
p_critic += "Also release sequence §27: 0.14.x operational diagnostics; 1.1.x full optional OTEL productization —\n";
p_critic += "  Phase 20 STILL implements 20.2 optional OTEL bridge in observability package (peer/optional),\n";
p_critic += "  but core MUST have zero mandatory OpenTelemetry dependency.\n";
p_critic += "Phases 0-19 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent, PaymentRuntime, store contracts, webhook inbox,\n";
p_critic += "sql-store, all adapters, adapter matrix (18), reconciliation (19).\n";
p_critic += "Do NOT start Phase 21+ (routing, customers, new PSPs, gateway extraction).\n";
p_critic += "Do NOT rewrite Phase 5-19 domain/foundation packages unless required for wiring/docs/telemetry hooks.\n\n";

p_critic += "CONTEXT already present from Phase 0-19:\n";
p_critic += "- packages/core TelemetrySink { emit?(event, data?) } on GatewayContext (optional)\n";
p_critic += "- packages/core redact() + createRedactingLogger + SAFE_KEY_ALLOWLIST in utils/logger.ts\n";
p_critic += "- providerRequestId on GatewayPaymentResult / operation results (Phase 6)\n";
p_critic += "- PaymentRuntime (fetch/crypto/clock/uuid) — no telemetry bag on runtime itself\n";
p_critic += "- There is NO packages/observability yet and NO @paykernel/opentelemetry.\n";
p_critic += "- Boundary checker treats unknown packages/* as portable by default; add name if needed.\n";
p_critic += "- Core package.json must NOT list @opentelemetry/* as dependency.\n\n";

p_critic += "Audit against EVERY Phase 20 requirement with evidence (grep/read):\n\n";

p_critic += "Objective: production payment behavior observable without coupling to one vendor.\n\n";

p_critic += "20.1 Structured Operation Context — carry (exactOptionalPropertyTypes-safe):\n";
p_critic += "  operationId, gateway, operationType, tenant/namespace, internalReference,\n";
p_critic += "  providerObjectId, providerRequestId, attemptNumber, duration (ms),\n";
p_critic += "  normalizedOutcome, retry flags, reconciliation flags, inboxEventKey where applicable.\n";
p_critic += "  Provide builders/helpers to create and finalize context (start/end).\n\n";

p_critic += "20.2 Optional OpenTelemetry Integration — suggested spans:\n";
p_critic += "  payment.create, payment.capture, payment.refund, payment.void,\n";
p_critic += "  payment.webhook.verify, payment.webhook.claim, payment.webhook.process,\n";
p_critic += "  payment.reconcile, payment.store.claim.\n";
p_critic += "  Must be OPTIONAL: no hard dep on @opentelemetry/* from core;\n";
p_critic += "  observability package may use optional peerDependency @opentelemetry/api\n";
p_critic += "  OR duck-typed Tracer/Meter interfaces so apps inject OTEL without packaging it.\n";
p_critic += "  Prefer: define PaymentTracer/PaymentMeter ports + createOpenTelemetryBridge(api)\n";
p_critic += "  that accepts injected @opentelemetry/api-like surface (no static import required at package root).\n\n";

p_critic += "20.3 Metrics — counters and histograms for:\n";
p_critic += "  operation outcomes; provider latency; rate limits; retries;\n";
p_critic += "  webhook duplicates; payload conflicts; handler failures;\n";
p_critic += "  expired/reclaimed leases; reconciliation drift; indeterminate operations;\n";
p_critic += "  adapter latency and errors.\n";
p_critic += "  Provide in-memory MetricsRegistry for tests + sink adapters.\n\n";

p_critic += "20.4 Redaction — telemetry must pass through the SAME redaction model as logs.\n";
p_critic += "  Use core redact() (or re-export). createRedactingTelemetrySink(sink) MUST scrub emit data.\n";
p_critic += "  Expand SAFE_KEY_ALLOWLIST for operational diagnostic keys if missing:\n";
p_critic += "  operationId, providerRequestId, providerObjectId, internalReference, attemptNumber,\n";
p_critic += "  tenant, namespace, inboxEventKey, durationMs, outcome, etc. (without weakening PII rules).\n";
p_critic += "  Sensitive values never emitted by default.\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) provider request IDs support operational debugging\n";
p_critic += "A2) core has no mandatory OpenTelemetry dependency\n";
p_critic += "A3) sensitive values are never emitted by default\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/observability = @paykernel/opentelemetry (NEW publishable portable)\n";
p_critic += "- may depend on @paykernel/core (core) only\n";
p_critic += "- must NOT depend on testkit, adapters, webhooks, reconciliation, frameworks, DB drivers\n";
p_critic += "- core must NOT depend on observability or @opentelemetry/*\n";
p_critic += "- optional peer @opentelemetry/api on observability only (never required to import root entry)\n";
p_critic += "- paymentsSdk.portable: true; no node:/bun: in production sources\n";
p_critic += "- Core may ADD lightweight OperationContext type + createRedactingTelemetrySink using existing redact\n";
p_critic += "  (prefer core for types used on GatewayContext; metrics+OTEL bridge in observability).\n\n";

p_critic += "Also check monorepo wiring gaps: root package.json build/test/typecheck omit observability;\n";
p_critic += "docs/monorepo.md and workspace-boundaries lack observability; no CHANGELOG/README/gate report.\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: OTEL hard dep in core; secrets in telemetry emit; double-wrapping redaction;\n";
p_critic += "breaking TelemetrySink; non-portable node:perf_hooks; coupling to one vendor backend;\n";
p_critic += "Phase 21 routing scope creep; requiring OTEL to use observability metrics; skipping redaction.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase20-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase20-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 20 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 20\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 20 Observability in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core.\n";
common += "Webhooks/reconciliation/testkit/adapters Phase 0-19 COMPLETE — preserve fully.\n";
common += "PHASE 20 ONLY: OperationContext + redacting telemetry + @paykernel/opentelemetry\n";
common += "(metrics, optional span instrumentation, optional OTEL bridge without hard OTEL dep in core).\n";
common += "Do NOT create packages for routing (Phase 21) or new PSPs. Do NOT rewrite adapters.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside observability/core telemetry;\n";
common += "re-read changed regions. Tests are source of truth. Preserve Phase 0-19 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (context, metrics, redaction, optional OTEL bridge).\n";
common += "2) No secret leakage — telemetry uses same redact() model as logs.\n";
common += "3) No framework coupling in core; no mandatory OTEL in core package.json.\n";
common += "4) No Node-only assumptions — portable package (Web APIs / injectable clock).\n";
common += "5) Keep 0.x compat: TelemetrySink remain optional; additive only.\n";
common += "6) exactOptionalPropertyTypes is ON — omit optional keys when absent.\n";
common += "7) Core must NOT depend on observability or @opentelemetry/*.\n";
common += "8) Observability must NOT depend on testkit, adapters, webhooks, reconciliation.\n";
common += "9) Sensitive values never emitted by default (redacting sinks default path).\n";
common += "10) Provider request IDs must be allow-listed and visible on OperationContext for debugging.\n";
common += "11) Optional OTEL: duck-typed or optional peer; root import of observability must work without OTEL installed.\n";
common += "12) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: Core OperationContext + redacting telemetry + SAFE_KEY expansion
let p_a = "";
p_a += common;
p_a += "STREAM A — CORE OPERATION CONTEXT + REDACTING TELEMETRY (20.1 partial, 20.4 foundation).\n";
p_a += "OWN primarily: packages/core/src (additive telemetry/context types + redaction allowlist + tests).\n";
p_a += "Do NOT add @opentelemetry/* to core package.json. Do NOT create packages/observability (Stream B).\n";
p_a += "Do NOT write phase-20-gate-report.md (Gate owns it).\n\n";

p_a += "### 20.1 OperationContext type (core)\n";
p_a += "Add packages/core/src/runtime/operation-context.ts (or utils/operation-context.ts):\n";
p_a += "```ts\n";
p_a += "export type PaymentOperationType =\n";
p_a += "  | \"payment.create\" | \"payment.capture\" | \"payment.refund\" | \"payment.void\"\n";
p_a += "  | \"payment.webhook.verify\" | \"payment.webhook.claim\" | \"payment.webhook.process\"\n";
p_a += "  | \"payment.reconcile\" | \"payment.store.claim\"\n";
p_a += "  | (string & {});\n";
p_a += "export type OperationContext = {\n";
p_a += "  operationId: string;\n";
p_a += "  gateway: string;\n";
p_a += "  operationType: PaymentOperationType | string;\n";
p_a += "  tenant?: string;\n";
p_a += "  namespace?: string;\n";
p_a += "  internalReference?: string;\n";
p_a += "  providerObjectId?: string;\n";
p_a += "  providerRequestId?: string;\n";
p_a += "  attemptNumber?: number;\n";
p_a += "  /** Duration in milliseconds when finalized */\n";
p_a += "  durationMs?: number;\n";
p_a += "  /** Normalized outcome string e.g. succeeded|declined|failed|indeterminate|... */\n";
p_a += "  normalizedOutcome?: string;\n";
p_a += "  retry?: boolean;\n";
p_a += "  reconciliationRequired?: boolean;\n";
p_a += "  inboxEventKey?: string;\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Helpers:\n";
p_a += "  createOperationContext(input): OperationContext  // requires operationId, gateway, operationType\n";
p_a += "  finalizeOperationContext(ctx, { durationMs?, normalizedOutcome?, providerRequestId?, ... }): OperationContext\n";
p_a += "  operationContextToTelemetryData(ctx): Record<string, unknown>  // plain bag for emit\n";
p_a += "exactOptionalPropertyTypes-safe: never assign undefined; omit keys.\n";
p_a += "Export from runtime/index.ts and packages/core/src/index.ts.\n";
p_a += "Update public-api.test.ts freeze if needed (additive exports OK).\n\n";

p_a += "### 20.4 createRedactingTelemetrySink (core)\n";
p_a += "In packages/core/src/gateways/gateway-context.ts OR utils/telemetry.ts:\n";
p_a += "```ts\n";
p_a += "export function createRedactingTelemetrySink(sink: TelemetrySink): TelemetrySink {\n";
p_a += "  return {\n";
p_a += "    emit(event, data?) {\n";
p_a += "      if (data === undefined) sink.emit?.(event);\n";
p_a += "      else sink.emit?.(event, redact(data) as Record<string, unknown>);\n";
p_a += "    },\n";
p_a += "  };\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Use existing redact from utils/logger.ts — SAME model as logs.\n";
p_a += "Expand SAFE_KEY_ALLOWLIST (lowercase keys) for diagnostics:\n";
p_a += "  operationid, operationtype, providerrequestid, providerobjectid, internalreference,\n";
p_a += "  attemptnumber, durationms, duration, tenant, namespace, inboxeventkey,\n";
p_a += "  normalizedoutcome, outcome, reconciliationrequired, retry, retryable.\n";
p_a += "Do NOT allowlist: secret, token, card, email, phone, authorization (bearer), clientsecret, etc.\n";
p_a += "Tests: redacting sink strips secrets; allowlisted providerRequestId survives; logger allowlist tests updated.\n\n";

p_a += "### A1 providerRequestId operational debugging\n";
p_a += "Confirm providerRequestId already on payment results (Phase 6). Document in docs if thin.\n";
p_a += "Add short docs/observability.md or docs/telemetry.md in core pointing to OperationContext + redacting sink.\n";
p_a += "Allowlist ensures providerRequestId is not redacted as containing 'request' alone is fine;\n";
p_a += "explicit allowlist is required because patterns might expand later.\n";
p_a += "Add unit test: OperationContext with providerRequestId round-trips through redacting sink.\n\n";

p_a += "### Public exports\n";
p_a += "Export: OperationContext, PaymentOperationType, createOperationContext, finalizeOperationContext,\n";
p_a += "operationContextToTelemetryData, createRedactingTelemetrySink, TelemetrySink (already).\n";
p_a += "Do NOT break existing GatewayContext / TelemetrySink shapes.\n\n";

p_a += "### Tests Stream A\n";
p_a += "packages/core/src/runtime/operation-context.test.ts (or adjacent):\n";
p_a += "- create/finalize omit absent optionals\n";
p_a += "- toTelemetryData includes providerRequestId\n";
p_a += "packages/core: createRedactingTelemetrySink redacts card/token/secret; keeps providerRequestId\n";
p_a += "Update utils.test.ts SAFE_KEY_ALLOWLIST cases for new keys\n";
p_a += "Run: cd packages/core && bun test (at least new files) && bun run typecheck\n";

// Stream B: observability package — metrics + spans + optional OTEL
let p_b = "";
p_b += common;
p_b += "STREAM B — packages/observability @paykernel/opentelemetry (20.2, 20.3, glue for 20.1/20.4).\n";
p_b += "OWN: packages/observability/** (NEW package). May use core exports for redact/TelemetrySink/OperationContext.\n";
p_b += "If Stream A has not landed OperationContext yet, define compatible types locally and re-export from core when present,\n";
p_b += "OR implement local OperationContext that mirrors Stream A (prefer import from core after bun install).\n";
p_b += "Do NOT write phase-20-gate-report.md.\n\n";

p_b += "### Create package packages/observability\n";
p_b += "Name: @paykernel/opentelemetry version 0.1.0\n";
p_b += "type module; exports \".\" and optionally \"./otel\" subpath for OTEL bridge only\n";
p_b += "main/types dist; files: dist, docs, README, LICENSE\n";
p_b += "dependency: @paykernel/core workspace:*\n";
p_b += "peerDependencies OPTIONAL: @opentelemetry/api (optionalDependencies or peerDependenciesMeta optional:true)\n";
p_b += "  Root entry MUST NOT static-import @opentelemetry/api — only ./otel subpath or factory that receives injected API.\n";
p_b += "devDependencies: @types/bun, typescript, optionally @opentelemetry/api for tests only\n";
p_b += "paymentsSdk: { portable: true }\n";
p_b += "publishConfig access public provenance true\n";
p_b += "scripts: build (bun build + build:types), typecheck, test — mirror webhooks/reconciliation\n";
p_b += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist, exclude **/*.test.ts\n";
p_b += "Copy MIT LICENSE from packages/webhooks\n";
p_b += "After package.json exists: run bun install from monorepo root.\n\n";

p_b += "### Recommended source layout\n";
p_b += "packages/observability/src/\n";
p_b += "  index.ts                 # public root exports (NO otel static import)\n";
p_b += "  context.ts               # re-export or wrap core OperationContext helpers if needed\n";
p_b += "  metrics.ts               # PaymentMetrics + createInMemoryMetrics + metric name constants\n";
p_b += "  spans.ts                 # PaymentSpanNames constants + PaymentTracer port + no-op tracer\n";
p_b += "  instrumentation.ts       # withOperation / recordOperation helpers (metrics+telemetry+span)\n";
p_b += "  redaction.ts             # createRedactingTelemetrySink re-export from core + redactTelemetryData\n";
p_b += "  otel.ts                  # OPTIONAL bridge: createOpenTelemetryBridge(api) duck-typed — NO hard import\n";
p_b += "  public-api.test.ts\n";
p_b += "  metrics.test.ts / instrumentation.test.ts / redaction.test.ts / otel.test.ts / spans.test.ts\n\n";

p_b += "### 20.3 Metrics API\n";
p_b += "```ts\n";
p_b += "type Counter = { add(value: number, attributes?: Record<string, string | number | boolean>): void };\n";
p_b += "type Histogram = { record(value: number, attributes?: Record<string, string | number | boolean>): void };\n";
p_b += "type PaymentMetrics = {\n";
p_b += "  operationOutcomes: Counter;      // labels: gateway, operationType, outcome\n";
p_b += "  providerLatencyMs: Histogram;  // gateway, operationType\n";
p_b += "  rateLimits: Counter;            // gateway\n";
p_b += "  retries: Counter;               // gateway, operationType\n";
p_b += "  webhookDuplicates: Counter;\n";
p_b += "  payloadConflicts: Counter;\n";
p_b += "  handlerFailures: Counter;\n";
p_b += "  expiredLeases: Counter;         // store/claim expired\n";
p_b += "  reclaimedLeases: Counter;\n";
p_b += "  reconciliationDrift: Counter;\n";
p_b += "  indeterminateOperations: Counter;\n";
p_b += "  adapterLatencyMs: Histogram;   // adapter, operation\n";
p_b += "  adapterErrors: Counter;         // adapter, errorKind\n";
p_b += "};\n";
p_b += "```\n";
p_b += "createInMemoryPaymentMetrics(): PaymentMetrics & { snapshot(): ... } for tests\n";
p_b += "createNoopPaymentMetrics(): PaymentMetrics\n";
p_b += "METRIC_NAMES constant object documenting stable names.\n";
p_b += "Attributes must be redacted or only accept non-sensitive primitives — document never pass secrets as attribute values.\n\n";

p_b += "### 20.2 Spans + optional OTEL\n";
p_b += "PAYMENT_SPAN_NAMES =\n";
p_b += "  payment.create | payment.capture | payment.refund | payment.void |\n";
p_b += "  payment.webhook.verify | payment.webhook.claim | payment.webhook.process |\n";
p_b += "  payment.reconcile | payment.store.claim\n";
p_b += "PaymentTracer port:\n";
p_b += "  startSpan(name, attributes?): { end(status?: { code: 'ok'|'error'; message? }); setAttribute(k,v); recordException?(e) }\n";
p_b += "createNoopTracer()\n";
p_b += "createOpenTelemetryBridge(otelApi: { trace: { getTracer(name): { startActiveSpan | startSpan } } }): PaymentTracer\n";
p_b += "  — duck-typed; accepts injected API object so root package has zero @opentelemetry dependency.\n";
p_b += "  Tests can pass a mock API; optional devDep @opentelemetry/api only if you want real smoke (not required).\n";
p_b += "If using exports \"./otel\", still keep factory injection preferred over static import.\n\n";

p_b += "### Instrumentation helper\n";
p_b += "withPaymentOperation({ context, metrics?, tracer?, telemetry?, clock? }, fn):\n";
p_b += "  - start span with operationType\n";
p_b += "  - await fn(ctx)\n";
p_b += "  - record latency histogram + outcome counter\n";
p_b += "  - emit telemetry event via redacting sink if provided\n";
p_b += "  - finalize durationMs on context\n";
p_b += "  - map indeterminate → indeterminateOperations counter; drift flags → reconciliationDrift when applicable\n";
p_b += "Never throw away indeterminate as failure for metrics labels.\n\n";

p_b += "### Public exports (index.ts)\n";
p_b += "createInMemoryPaymentMetrics, createNoopPaymentMetrics, METRIC_NAMES,\n";
p_b += "PAYMENT_SPAN_NAMES, createNoopTracer, createOpenTelemetryBridge,\n";
p_b += "withPaymentOperation, recordPaymentOperation,\n";
p_b += "createRedactingTelemetrySink (re-export from core),\n";
p_b += "createOperationContext / finalizeOperationContext (re-export from core if available),\n";
p_b += "types: PaymentMetrics, PaymentTracer, OperationContext, etc.\n";
p_b += "public-api.test.ts freezes runtime export names.\n\n";

p_b += "### Tests Stream B (must prove acceptance)\n";
p_b += "- metrics counters/histograms record; snapshot works\n";
p_b += "- all 20.3 metric kinds exist on PaymentMetrics\n";
p_b += "- redaction: secrets never reach TelemetrySink behind createRedactingTelemetrySink\n";
p_b += "- providerRequestId survives redaction in emit data (A1)\n";
p_b += "- createOpenTelemetryBridge with mock API creates/ends spans with correct names (A2 optional path)\n";
p_b += "- root import works without requiring @opentelemetry/api installed (A2)\n";
p_b += "- withPaymentOperation records latency + outcome; indeterminate counted separately\n";
p_b += "- no node:/bun: in production sources\n";
p_b += "Run: cd packages/observability && bun test && bun run typecheck\n";

// Stream C: docs + monorepo wiring in parallel after A+B sequential first... 
// Actually phase-19 did A first then B+C parallel. We'll do A then B sequential then C parallel with docs.
// For speed: A and B can be sequential because B may need A's exports. Implement A then B in sequence.

let a_result = agent(p_a, #{
    label: "impl:20-core-context",
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

let b_result = agent(p_b, #{
    label: "impl:20-observability-pkg",
    capability_mode: "all",
    output_schema: implement_schema,
});

let b_ok = false;
let b_summary = "stream B failed";
if b_result != () && b_result.success && b_result.output != () {
    b_ok = b_result.output.ok == true;
    b_summary = b_result.output.summary;
    log("Stream B ok=" + b_ok.to_string() + " — " + b_summary);
} else {
    log("Stream B agent failed");
}

// Parallel: D docs; C monorepo wiring
log("Implementing Phase 20 docs and monorepo wiring in parallel");

let p_d = "";
p_d += common;
p_d += "STREAM D — DOCUMENTATION for Phase 20.\n";
p_d += "OWN: packages/observability/README.md, packages/observability/docs/*.md,\n";
p_d += "packages/observability/CHANGELOG.md Unreleased Phase 20,\n";
p_d += "packages/core/docs/observability.md or telemetry.md (if Stream A didn't fully),\n";
p_d += "cross-link packages/core/docs/logging.md (telemetry uses same redaction),\n";
p_d += "packages/core/docs/runtime.md telemetry section update,\n";
p_d += "docs/monorepo.md layout (observability present),\n";
p_d += "docs/workspace-boundaries.md (observability portable, may depend on core only; core no OTEL),\n";
p_d += "root README package table if packages listed.\n";
p_d += "Do NOT write phase-20-gate-report.md (Gate owns it).\n\n";

p_d += "### packages/observability/docs/ MUST cover\n";
p_d += "1) overview.md — purpose: vendor-neutral operational diagnostics; package boundary; no mandatory OTEL\n";
p_d += "2) operation-context.md — 20.1 fields, builders, providerRequestId debugging\n";
p_d += "3) metrics.md — 20.3 counters/histograms, names, attribute rules (no secrets)\n";
p_d += "4) redaction.md — same model as logs; createRedactingTelemetrySink; allowlisted diagnostic keys\n";
p_d += "5) opentelemetry.md — optional bridge, inject @opentelemetry/api, span names list, core never depends on OTEL\n";
p_d += "6) instrumentation.md — withPaymentOperation usage samples\n\n";

p_d += "### README\n";
p_d += "Install, quickstart: metrics + redacting telemetry + optional OTEL bridge.\n";
p_d += "Explicit: core has no mandatory OTEL; secrets never emitted by default; providerRequestId for debugging.\n\n";

p_d += "### CHANGELOG\n";
p_d += "Unreleased: initial @paykernel/opentelemetry + core OperationContext/redacting telemetry.\n\n";

p_d += "### Cross-links accuracy\n";
p_d += "Re-read actual exports after writing; fix wrong API names. No Phase 21 routing claims.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — MONOREPO WIRING.\n";
p_c += "OWN: root package.json scripts (build/test/typecheck include observability),\n";
p_c += "docs/monorepo.md, docs/workspace-boundaries.md,\n";
p_c += "scripts/check-workspace-boundaries.ts — add @paykernel/opentelemetry to portable name list if present,\n";
p_c += "and ensure core must not depend on observability (like webhooks/reconciliation isolation).\n";
p_c += "If boundary rules need: observability may depend on core only; core must not depend on observability.\n";
p_c += "Do NOT write gate report.\n\n";

p_c += "### Root package.json updates (required)\n";
p_c += "build order: core first, then webhooks, reconciliation, observability, then testkit, sql-store, adapters.\n";
p_c += "Include filter for @paykernel/opentelemetry.\n";
p_c += "typecheck: include observability\n";
p_c += "test: add packages/observability to bun test list\n";
p_c += "build:types: include observability\n";
p_c += "description mention observability package\n\n";

p_c += "### Boundaries\n";
p_c += "Run bun run check:boundaries after wiring; fix any violations.\n";
p_c += "Ensure portable production sources have no node:/bun: imports.\n";
p_c += "Update workspace-boundaries.md: observability present, portable, depends on core only;\n";
p_c += "core isolation includes no @paykernel/opentelemetry and no @opentelemetry/*.\n\n";

p_c += "### After wiring run\n";
p_c += "bun install\n";
p_c += "bun run --filter @paykernel/opentelemetry build || (cd packages/observability && bun run build)\n";
p_c += "bun test packages/observability packages/core\n";
p_c += "bun run check:boundaries\n";

let jobs = [
    #{ prompt: p_d, label: "impl:20-docs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:20-monorepo", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok = 0;
let impl_fail = 0;
if a_ok { impl_ok += 1; } else { impl_fail += 1; }
if b_ok { impl_ok += 1; } else { impl_fail += 1; }
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
p_int += "You are integrating Phase 20 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 21 routing.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/observability exists as @paykernel/opentelemetry@0.1.0 with portable:true.\n";
p_int += "2) OperationContext carries 20.1 fields; create/finalize helpers; providerRequestId for debugging.\n";
p_int += "3) createRedactingTelemetrySink uses core redact() — same model as logs (20.4).\n";
p_int += "4) SAFE_KEY_ALLOWLIST includes operational diagnostic keys without weakening PII rules.\n";
p_int += "5) PaymentMetrics exposes all 20.3 counters/histograms with tests.\n";
p_int += "6) Span name constants for all 20.2 suggested spans.\n";
p_int += "7) Optional OTEL bridge via injection/duck-typing; root entry works WITHOUT @opentelemetry/api.\n";
p_int += "8) Core package.json has ZERO @opentelemetry/* and ZERO payments-observability deps (A2).\n";
p_int += "9) Observability depends only on core; no testkit/adapters/webhooks/reconciliation.\n";
p_int += "10) Sensitive values never emitted by default (A3) — proven by redaction tests.\n";
p_int += "11) Docs: overview, operation-context, metrics, redaction, opentelemetry, instrumentation, README, CHANGELOG.\n";
p_int += "12) Root scripts build/test/typecheck include observability; monorepo + boundaries docs updated.\n";
p_int += "13) withPaymentOperation records latency/outcomes including indeterminate.\n";
p_int += "14) Phase 0-19 safety: typecheck, full package tests, build, boundaries, runtime portability green.\n";
p_int += "15) exactOptionalPropertyTypes clean; public API freeze tests pass.\n";
p_int += "16) dist builds (index.js + .d.ts) for core + observability.\n";
p_int += "17) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks packages/reconciliation packages/observability internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "18) If Stream A/B failed, implement the missing pieces yourself — Phase 20 cannot ship without them.\n";
p_int += "19) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap).\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase20",
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
p_ver += "Verify Phase 20 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) bun run typecheck\n";
p_ver += "3) bun run typecheck:types\n";
p_ver += "4) bun test packages/core packages/testkit packages/webhooks packages/reconciliation packages/observability internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_ver += "5) bun test --coverage packages/core\n";
p_ver += "6) bun run build\n";
p_ver += "7) bun run check:boundaries\n";
p_ver += "8) bun run check:runtime-portability\n";
p_ver += "9) bun run validate:package\n";
p_ver += "10) Evidence packages/observability package.json name @paykernel/opentelemetry portable:true\n";
p_ver += "11) Evidence OperationContext fields 20.1 + helpers\n";
p_ver += "12) Evidence PaymentMetrics 20.3 instruments exist + tests\n";
p_ver += "13) Evidence createRedactingTelemetrySink uses redact; secrets stripped; providerRequestId kept\n";
p_ver += "14) Evidence core package.json has no @opentelemetry and no payments-observability\n";
p_ver += "15) Evidence optional OTEL bridge without hard root import of @opentelemetry/api\n";
p_ver += "16) Evidence span name constants for payment.create/capture/refund/void/webhook.*/reconcile/store.claim\n";
p_ver += "17) Evidence docs present\n";
p_ver += "18) Evidence dist/index.js and dist/index.d.ts after build for observability\n";
p_ver += "19) Evidence root scripts include observability\n";
p_ver += "20) Evidence no production node:/bun: in packages/observability/src\n\n";
p_ver += "Set flags from verify_schema names. Set ok=true only if typecheck, tests, build, boundaries,\n";
p_ver += "and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase20",
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
    write_scratch_file("phase20-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 20 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 20 — each PASS or BLOCKING:\n";
p_gate += "A1) provider request IDs support operational debugging.\n";
p_gate += "    Evidence: OperationContext.providerRequestId; not redacted; tests; docs.\n";
p_gate += "A2) core has no mandatory OpenTelemetry dependency.\n";
p_gate += "    Evidence: packages/core/package.json has no @opentelemetry/*; no static otel import in core src;\n";
p_gate += "    observability optional bridge only; root observability import without otel package.\n";
p_gate += "A3) sensitive values are never emitted by default.\n";
p_gate += "    Evidence: createRedactingTelemetrySink + tests that secrets are redacted; same redact() as logs.\n\n";
p_gate += "Also require:\n";
p_gate += "- Package @paykernel/opentelemetry portable with core-only dependency\n";
p_gate += "- OperationContext 20.1 fields present\n";
p_gate += "- Metrics 20.3 all instruments present\n";
p_gate += "- Span names 20.2 present\n";
p_gate += "- Redaction 20.4 via core redact model\n";
p_gate += "- Phase 0-19 safety net still green\n";
p_gate += "- No Phase 21 routing sneak-in\n";
p_gate += "- No logical bugs: OTEL hard-required; secrets in attributes; core→observability dep;\n";
p_gate += "  node-only imports; converting indeterminate metrics incorrectly to failure-only.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks packages/reconciliation packages/observability internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_gate += "  bun run typecheck; check:boundaries.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/observability/docs/phase-20-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-20-gate-report.md (full or pointer).\n";
p_gate += "AND docs/phase-20-gate-report.md pointer.\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase20-adversarial",
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
    write_scratch_file("phase20-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 20 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 20 only — no Phase 21 routing.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete OperationContext, redacting telemetry, observability package (metrics, spans, optional OTEL),\n";
    p_fix += "tests, docs, monorepo wiring. Preserve Phase 0-19.\n";
    p_fix += "After fixes re-run typecheck, full tests, build, boundaries, runtime-portability, validate:package.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase20-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 20 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, full package tests including packages/observability,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm A1-A3 with file and test evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase20-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase20-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 20 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 with independent evidence.\n";
    p_gate2 += "Update packages/observability/docs/phase-20-gate-report.md and baseline pointer.\n";
    p_gate2 += "pass=true only if acceptance criteria are evidenced and suite is green.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase20-final",
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
        write_scratch_file("phase20-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 20 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 20,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
