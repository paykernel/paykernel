let meta = #{
    name: "phase-7-webhook-events",
    description: "Phase 7 Typed and Versioned Webhook Events: critic, implement stable event names + PaymentEvent + ProviderEventMetadata + envelope + raw retention, integrate, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 7 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "event names, PaymentEvent union, metadata, envelope, raw retention, gateway mapping, tests, docs" },
        #{ title: "Integrate", detail: "unify streams, public API, dual-write, keep green" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, boundaries, event evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 7" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 7 (Typed and Versioned Webhook Events) for payments-sdk monorepo",
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
        "stable_names_ok", "payment_event_ok", "provider_metadata_ok",
        "envelope_ok", "raw_retention_ok", "schema_version_ok",
        "handlers_discriminated_ok", "compat_ok",
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
        "stable_names_ok": #{ "type": "boolean" },
        "payment_event_ok": #{ "type": "boolean" },
        "provider_metadata_ok": #{ "type": "boolean" },
        "envelope_ok": #{ "type": "boolean" },
        "raw_retention_ok": #{ "type": "boolean" },
        "schema_version_ok": #{ "type": "boolean" },
        "handlers_discriminated_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 7 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 7 critic for the payments-sdk monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 7 — Typed and Versioned Webhook Events\" completely\n";
p_critic += "(Objective, Target Model, Tasks 7.1-7.5, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4) and Package Boundary Rules if present.\n";
p_critic += "Phases 0-6 are COMPLETE — preserve baselines, monorepo, plugin architecture, capabilities,\n";
p_critic += "testkit, money model, typed outcomes (PaymentOperationResult, domain statuses, ProviderReferences),\n";
p_critic += "pack validation. Do NOT start Phase 8 runtime injection, Phase 9 stores, new real providers,\n";
p_critic += "or gateway extraction packages. Do NOT rewrite Phase 6 outcomes.\n\n";
p_critic += "Audit against EVERY Phase 7 task and acceptance criterion:\n\n";
p_critic += "7.1 Define Stable Event Names — consistent names such as:\n";
p_critic += "  payment.created, payment.processing, payment.authorized, payment.succeeded,\n";
p_critic += "  payment.failed, payment.cancelled, capture.completed, refund.pending,\n";
p_critic += "  refund.completed, refund.failed, payment_method.setup_completed,\n";
p_critic += "  dispute.opened, dispute.updated, dispute.closed.\n";
p_critic += "  Today WebhookEvent.type is free-form string (provider-native: payment_paid,\n";
p_critic += "  payment_intent.succeeded, PAYMENT.CAPTURE.COMPLETED, etc.).\n\n";
p_critic += "7.2 Preserve Provider Metadata — ProviderEventMetadata = {\n";
p_critic += "  gateway, eventId, eventType, apiVersion?, livemode?, occurredAt, receivedAt, requestId? }\n";
p_critic += "  Today fields are scattered: gateway, id, type, livemode?, apiVersion?, timestamp as Date.\n\n";
p_critic += "7.3 Persistable Event Envelope — PersistedPaymentEventEnvelope = {\n";
p_critic += "  schemaVersion: '1', event: PaymentEvent, payloadHash, storedAt }\n";
p_critic += "  Exclude raw payloads, secrets, headers, signatures by default.\n\n";
p_critic += "7.4 Make Raw Payload Retention Explicit — opt-in request-local access and optional\n";
p_critic += "  encrypted persistence through application-supplied codec. Today rawPayload is always on WebhookEvent.\n\n";
p_critic += "7.5 Version the Schema — schemaVersion: '1', document compatibility rules,\n";
p_critic += "  never silently change an event's meaning.\n\n";
p_critic += "Target PaymentEvent model (roadmap):\n";
p_critic += "  | { schemaVersion: '1'; type: 'payment.succeeded'; payment: Payment; provider: ProviderEventMetadata }\n";
p_critic += "  | { schemaVersion: '1'; type: 'payment.failed'; payment: Payment; failure: PaymentFailure; provider: ... }\n";
p_critic += "  | { schemaVersion: '1'; type: 'refund.completed'; refund: Refund; provider: ... }\n";
p_critic += "  Extend to cover all stable event names with appropriate arms (payment/refund/capture/setup/dispute).\n\n";
p_critic += "Acceptance criteria:\n";
p_critic += "- handlers receive discriminated events\n";
p_critic += "- provider metadata remains available\n";
p_critic += "- a stable, sanitized event envelope can be persisted by inbox adapters\n\n";
p_critic += "Inspect thoroughly:\n";
p_critic += "- packages/core/src/types/webhook.types.ts (WebhookEvent free-form type + always rawPayload)\n";
p_critic += "- packages/core/src/types/operation-result.ts (Payment, PaymentDecline — reuse)\n";
p_critic += "- packages/core/src/types/domain-status.ts\n";
p_critic += "- packages/core/src/client.ts handleWebhook return type and hooks\n";
p_critic += "- packages/core/src/hooks/* WebhookVerifiedHook receives WebhookEvent\n";
p_critic += "- All four gateways parseWebhookEvent: free-form type, rawPayload always set\n";
p_critic += "  (Moyasar redacts secret_token — good; still always attaches raw)\n";
p_critic += "- packages/testkit mock webhook helpers (generateWebhookEvent, mockPayloadToWebhookEvent)\n";
p_critic += "- packages/core/src/index.ts public exports\n";
p_critic += "- packages/core/docs/webhooks.md\n";
p_critic += "- public-api tests, baselines, CHANGELOG patterns\n";
p_critic += "- Phase 6 outcome types still intact\n\n";
p_critic += "CRITICAL GAPS to confirm with evidence:\n";
p_critic += "1) No PaymentEvent discriminated union with schemaVersion\n";
p_critic += "2) No StablePaymentEventType / stable event name constants\n";
p_critic += "3) No ProviderEventMetadata type\n";
p_critic += "4) No PersistedPaymentEventEnvelope / payloadHash helpers\n";
p_critic += "5) rawPayload always required on WebhookEvent (not opt-in)\n";
p_critic += "6) No provider-native → stable event type mapping layer\n";
p_critic += "7) No PaymentFailure / Refund entity types for event arms (may reuse PaymentDecline)\n";
p_critic += "8) Handlers only get free-form WebhookEvent — not switchable on type discriminant\n";
p_critic += "9) Missing docs for schema versioning + envelope persistence rules\n\n";
p_critic += "List concrete GAPS. List ALREADY_PRESENT (WebhookEvent, gateway parsers, livemode/apiVersion,\n";
p_critic += "Moyasar secret redaction, Payment type, PaymentDecline, hooks, handleWebhook stages).\n";
p_critic += "stream_plan for implement order. risks: breaking all webhook tests that assert type strings;\n";
p_critic += "0.x consumers reading .type as provider-native; always-required rawPayload removal;\n";
p_critic += "exactOptionalPropertyTypes; Phase 6 Payment reuse; secret leakage in envelopes; silent event renames;\n";
p_critic += "testkit mock drift; payloadHash without stable serialization; Date vs ISO strings for persistence.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase7-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase7-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 7 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 7\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 7 Typed and Versioned Webhook Events in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core package is packages/core = @paykernel/core (0.8.0).\n";
common += "Testkit: packages/testkit = @paykernel/testkit (depends on core).\n";
common += "PHASE 7 ONLY: Typed and Versioned Webhook Events.\n";
common += "Do NOT start Phase 8 runtime, Phase 9 stores, new PSPs, gateway extraction.\n";
common += "Do NOT rewrite Phase 6 outcomes/money unless required for PaymentEvent embedding.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-6: monorepo, baselines, plugin architecture,\n";
common += "capabilities, createPaymentClient, registry, factories, pack validation, coverage thresholds,\n";
common += "testkit, Money/AmountInput, PaymentOperationResult/domain statuses/ProviderReferences.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change.\n";
common += "2) No unsafe mutation retries without native idempotency or atomic dedup.\n";
common += "3) Never convert uncertain outcomes into failure.\n";
common += "4) Do not hide provider differences — keep provider-native eventType in ProviderEventMetadata.\n";
common += "5) No secret leakage in errors/logs/fixtures/envelopes/payloadHash inputs.\n";
common += "6) No framework coupling.\n";
common += "7) No Node-only assumptions in portable packages (prefer Web Crypto for hashing).\n";
common += "8) Keep 0.x backward compat: WebhookEvent MUST remain usable; dual-write stable type + legacy fields.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) exactOptionalPropertyTypes is ON — respect optional props carefully.\n";
common += "11) Core must NOT depend on testkit.\n";
common += "12) Never store raw provider payloads by default (Engineering Rule 14).\n";
common += "13) Store timestamps portably as ISO-8601 strings in envelopes (Engineering Rule 15).\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: core types — event names, PaymentEvent, metadata, envelope, raw retention
let p_a = "";
p_a += common;
p_a += "STREAM A — CORE TYPE MODEL (Tasks 7.1-7.5 types + helpers + public exports).\n";
p_a += "You own packages/core/src/types/webhook.types.ts and/or new files:\n";
p_a += "  packages/core/src/types/payment-event.ts (preferred for PaymentEvent + envelope),\n";
p_a += "  packages/core/src/types/webhook-event-map.ts (provider-native → stable mapping),\n";
p_a += "  packages/core/src/types/index.ts, packages/core/src/index.ts exports,\n";
p_a += "  unit tests + type tests for events.\n";
p_a += "Coordinate so Stream B can map gateway parseWebhookEvent outputs.\n\n";

p_a += "### DESIGN PRINCIPLES (non-negotiable)\n";
p_a += "1) Discriminated unions on PaymentEvent.type with schemaVersion:'1' on every arm.\n";
p_a += "2) Stable names are the public contract; provider-native types stay in provider.eventType.\n";
p_a += "3) 0.x compat: keep WebhookEvent interface with existing required fields for current tests.\n";
p_a += "   Prefer EVOLVING WebhookEvent additively:\n";
p_a += "   - type: string (legacy free-form OR stable name — dual-write documented)\n";
p_a += "   - Add optional: schemaVersion?: '1'; event?: PaymentEvent; provider?: ProviderEventMetadata;\n";
p_a += "     stableType?: StablePaymentEventType; payloadHash?: string;\n";
p_a += "   - rawPayload: unknown remains for 0.x request-local handlers but is DEPRECATED for persistence.\n";
p_a += "   - Document: for persistence use toPersistedPaymentEventEnvelope() which STRIPS rawPayload.\n";
p_a += "4) Never silently change meaning of an existing stable event type once defined.\n";
p_a += "5) payloadHash must not include secrets (use redacted canonical payload bytes).\n";
p_a += "6) Reuse Phase 6 Payment / PaymentDecline where possible; introduce PaymentFailure alias or wrapper.\n\n";

p_a += "### 7.1 Stable event names\n";
p_a += "```ts\n";
p_a += "export const STABLE_PAYMENT_EVENT_TYPES = [\n";
p_a += "  'payment.created',\n";
p_a += "  'payment.processing',\n";
p_a += "  'payment.authorized',\n";
p_a += "  'payment.succeeded',\n";
p_a += "  'payment.failed',\n";
p_a += "  'payment.cancelled',\n";
p_a += "  'capture.completed',\n";
p_a += "  'refund.pending',\n";
p_a += "  'refund.completed',\n";
p_a += "  'refund.failed',\n";
p_a += "  'payment_method.setup_completed',\n";
p_a += "  'dispute.opened',\n";
p_a += "  'dispute.updated',\n";
p_a += "  'dispute.closed',\n";
p_a += "] as const;\n";
p_a += "export type StablePaymentEventType = (typeof STABLE_PAYMENT_EVENT_TYPES)[number];\n";
p_a += "export function isStablePaymentEventType(v: string): v is StablePaymentEventType;\n";
p_a += "```\n";
p_a += "Also allow an open escape hatch for unmapped provider events WITHOUT pretending they are stable:\n";
p_a += "```ts\n";
p_a += "export type UnmappedPaymentEventType = `provider.${string}`;\n";
p_a += "// OR a dedicated arm: type: 'provider.unmapped' with provider.eventType preserved\n";
p_a += "```\n";
p_a += "Prefer: mapped stable names when known; otherwise PaymentEvent arm:\n";
p_a += "{ schemaVersion:'1'; type:'provider.unmapped'; provider: ProviderEventMetadata; payment?: Payment }\n";
p_a += "so handlers can exhaustively switch without losing unknown events.\n\n";

p_a += "### 7.2 ProviderEventMetadata\n";
p_a += "```ts\n";
p_a += "export type ProviderEventMetadata = {\n";
p_a += "  gateway: string; // GatewayId\n";
p_a += "  eventId: string;\n";
p_a += "  /** Provider-native event type string (never rename silently) */\n";
p_a += "  eventType: string;\n";
p_a += "  apiVersion?: string;\n";
p_a += "  livemode?: boolean;\n";
p_a += "  /** ISO-8601 when the provider says the event occurred */\n";
p_a += "  occurredAt: string;\n";
p_a += "  /** ISO-8601 when the SDK received/parsed the event */\n";
p_a += "  receivedAt: string;\n";
p_a += "  requestId?: string;\n";
p_a += "};\n";
p_a += "```\n\n";

p_a += "### Supporting entity types for event arms\n";
p_a += "Reuse Phase 6 Payment. Define:\n";
p_a += "```ts\n";
p_a += "/** Failure details on payment.failed events — align with PaymentDecline when possible. */\n";
p_a += "export type PaymentFailure = {\n";
p_a += "  code: string;\n";
p_a += "  message: string;\n";
p_a += "  providerCode?: string;\n";
p_a += "  softDecline?: boolean;\n";
p_a += "  raw?: unknown; // never secrets\n";
p_a += "};\n";
p_a += "export type Refund = {\n";
p_a += "  status: 'pending' | 'completed' | 'failed' | string; // prefer RefundDomainStatus\n";
p_a += "  amount?: number;\n";
p_a += "  currency?: string;\n";
p_a += "  references: import('./provider-refs').ProviderReferences;\n";
p_a += "  rawResponse?: unknown;\n";
p_a += "};\n";
p_a += "export type Capture = {\n";
p_a += "  status: string;\n";
p_a += "  amount?: number;\n";
p_a += "  currency?: string;\n";
p_a += "  references: import('./provider-refs').ProviderReferences;\n";
p_a += "};\n";
p_a += "export type Dispute = {\n";
p_a += "  status: string; // prefer DisputeStatus\n";
p_a += "  amount?: number;\n";
p_a += "  currency?: string;\n";
p_a += "  references: import('./provider-refs').ProviderReferences;\n";
p_a += "};\n";
p_a += "export type PaymentMethodSetup = {\n";
p_a += "  status: string; // prefer SetupTokenStatus\n";
p_a += "  token?: string; // gateway token if safe\n";
p_a += "  references: import('./provider-refs').ProviderReferences;\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Exact field sets can be minimal but must support discrimination and persistence without secrets.\n\n";

p_a += "### 7.1+ Target PaymentEvent (full union covering stable names)\n";
p_a += "```ts\n";
p_a += "export type PaymentEventSchemaVersion = '1';\n";
p_a += "export type PaymentEvent =\n";
p_a += "  | { schemaVersion: '1'; type: 'payment.created'; payment: Payment; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'payment.processing'; payment: Payment; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'payment.authorized'; payment: Payment; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'payment.succeeded'; payment: Payment; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'payment.failed'; payment: Payment; failure: PaymentFailure; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'payment.cancelled'; payment: Payment; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'capture.completed'; capture: Capture; payment?: Payment; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'refund.pending'; refund: Refund; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'refund.completed'; refund: Refund; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'refund.failed'; refund: Refund; failure?: PaymentFailure; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'payment_method.setup_completed'; setup: PaymentMethodSetup; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'dispute.opened'; dispute: Dispute; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'dispute.updated'; dispute: Dispute; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'dispute.closed'; dispute: Dispute; provider: ProviderEventMetadata }\n";
p_a += "  | { schemaVersion: '1'; type: 'provider.unmapped'; provider: ProviderEventMetadata; payment?: Payment; note?: string };\n";
p_a += "```\n";
p_a += "Add type guards: isPaymentEvent, isPaymentSucceededEvent, etc. as needed for tests.\n\n";

p_a += "### 7.3 PersistedPaymentEventEnvelope\n";
p_a += "```ts\n";
p_a += "export type PersistedPaymentEventEnvelope = {\n";
p_a += "  schemaVersion: '1';\n";
p_a += "  event: PaymentEvent;\n";
p_a += "  /** Hex or base64url hash of redacted canonical payload bytes (not secrets). */\n";
p_a += "  payloadHash: string;\n";
p_a += "  /** ISO-8601 */\n";
p_a += "  storedAt: string;\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Helpers:\n";
p_a += "1) toPersistedPaymentEventEnvelope(event: PaymentEvent, opts?: { payloadHash?: string; storedAt?: string; rawForHash?: unknown }): PersistedPaymentEventEnvelope\n";
p_a += "   - MUST strip any raw payloads from nested objects when building the envelope event\n";
p_a += "   - MUST NOT include headers/signatures/secrets\n";
p_a += "2) hashWebhookPayload(raw: unknown): string — portable hashing\n";
p_a += "   Prefer Web Crypto subtle when available; for sync unit tests in Bun, may use node:crypto createHash\n";
p_a += "   ONLY if already used in core for webhooks (Stripe/Paymob already use node:crypto).\n";
p_a += "   Canonicalize: JSON.stringify with sorted keys for objects; redact known secret fields\n";
p_a += "   (secret_token, signature, hmac, Authorization, client_secret, etc.).\n";
p_a += "3) assertNoSecretsInEnvelope(envelope) test helper or runtime validation in tests.\n\n";

p_a += "### 7.4 Raw payload retention explicit\n";
p_a += "```ts\n";
p_a += "/** Application-supplied codec for optional encrypted raw storage. */\n";
p_a += "export interface RawWebhookPayloadCodec {\n";
p_a += "  encrypt(plaintext: Uint8Array | string): Promise<string> | string;\n";
p_a += "  decrypt(ciphertext: string): Promise<Uint8Array | string> | Uint8Array | string;\n";
p_a += "}\n";
p_a += "export type RequestLocalWebhookContext = {\n";
p_a += "  /** Request-local only — never put this on PersistedPaymentEventEnvelope. */\n";
p_a += "  rawPayload: unknown;\n";
p_a += "  headers?: Record<string, string>;\n";
p_a += "};\n";
p_a += "export type EncryptedRawPayloadRecord = {\n";
p_a += "  schemaVersion: '1';\n";
p_a += "  ciphertext: string;\n";
p_a += "  /** Codec identifier for the app (not a secret). */\n";
p_a += "  codecId?: string;\n";
p_a += "  payloadHash: string;\n";
p_a += "};\n";
p_a += "export async function encryptRawWebhookPayload(\n";
p_a += "  raw: unknown, codec: RawWebhookPayloadCodec, opts?: { codecId?: string }\n";
p_a += "): Promise<EncryptedRawPayloadRecord>;\n";
p_a += "```\n";
p_a += "Document clearly: default path is request-local raw on WebhookEvent.rawPayload for handlers;\n";
p_a += "persistence uses envelope without raw; apps that need long-term raw storage must call encrypt API.\n\n";

p_a += "### 7.5 Schema versioning\n";
p_a += "Document in packages/core/docs/webhook-events.md (or expand webhooks.md):\n";
p_a += "- schemaVersion starts at '1'\n";
p_a += "- Compatibility rules: additive optional fields OK within v1; changing meaning of type arm requires new schemaVersion\n";
p_a += "- Consumers must switch on schemaVersion + type\n";
p_a += "- Never silently rename stable types\n";
p_a += "Export PAYMENT_EVENT_SCHEMA_VERSION = '1' as const.\n\n";

p_a += "### Mapping helpers (provider-native → stable)\n";
p_a += "```ts\n";
p_a += "export function mapProviderEventTypeToStable(\n";
p_a += "  gateway: string,\n";
p_a += "  providerEventType: string,\n";
p_a += "  context?: { status?: string; objectType?: string }\n";
p_a += "): StablePaymentEventType | 'provider.unmapped';\n";
p_a += "```\n";
p_a += "Cover at least:\n";
p_a += "- Stripe: payment_intent.succeeded → payment.succeeded; payment_intent.payment_failed → payment.failed;\n";
p_a += "  payment_intent.canceled → payment.cancelled; payment_intent.created → payment.created;\n";
p_a += "  charge.refunded / refund.created/updated → refund.*; checkout.session.completed paid → payment.succeeded;\n";
p_a += "  setup_completed path → payment_method.setup_completed; disputes if present → dispute.*\n";
p_a += "- Moyasar: payment_paid → payment.succeeded; payment_failed/payment_faild → payment.failed;\n";
p_a += "  payment_authorized → payment.authorized; refund-ish statuses → refund.*\n";
p_a += "- PayPal: PAYMENT.CAPTURE.COMPLETED → capture.completed or payment.succeeded (document choice);\n";
p_a += "  payment capture refunded → refund.completed; etc.\n";
p_a += "- Paymob: success transaction → payment.succeeded; failed → payment.failed; TOKEN → setup_completed;\n";
p_a += "  void/refund flags → payment.cancelled / refund.completed\n";
p_a += "Export mapping tables as pure data + pure functions; unit test exhaustively for known types.\n\n";

p_a += "### Build PaymentEvent from legacy WebhookEvent\n";
p_a += "```ts\n";
p_a += "export function webhookEventToPaymentEvent(\n";
p_a += "  event: WebhookEvent,\n";
p_a += "  opts?: { receivedAt?: string; requestId?: string }\n";
p_a += "): PaymentEvent;\n";
p_a += "export function attachPaymentEvent(event: WebhookEvent, opts?): WebhookEvent;\n";
p_a += "// sets event.event (PaymentEvent), stableType, provider metadata fields, dual-writes type to stable when mapped\n";
p_a += "```\n";
p_a += "CRITICAL COMPAT for WebhookEvent.type dual-write:\n";
p_a += "Historical tests expect provider-ish types (payment_paid, payment_intent.succeeded).\n";
p_a += "Strategy (document + implement consistently):\n";
p_a += "A) Keep WebhookEvent.type as TODAY (provider-native or already-normalized gateway string).\n";
p_a += "B) Add WebhookEvent.stableType with the stable name when mappable.\n";
p_a += "C) PaymentEvent.type is ALWAYS the stable name (or provider.unmapped).\n";
p_a += "D) Prefer handlers to use event.event (PaymentEvent) or map via webhookEventToPaymentEvent.\n";
p_a += "Do NOT break existing assertions on event.type without updating tests carefully.\n";
p_a += "If Moyasar already normalizes types, inspect normalizeWebhookEventType and align.\n\n";

p_a += "### Public exports (packages/core/src/index.ts)\n";
p_a += "Export types: StablePaymentEventType, PaymentEvent, PaymentEventSchemaVersion,\n";
p_a += "ProviderEventMetadata, PersistedPaymentEventEnvelope, PaymentFailure, Refund (event entity),\n";
p_a += "Capture, Dispute, PaymentMethodSetup, RawWebhookPayloadCodec, EncryptedRawPayloadRecord,\n";
p_a += "RequestLocalWebhookContext, Unmapped arm types as needed.\n";
p_a += "Export values: STABLE_PAYMENT_EVENT_TYPES, PAYMENT_EVENT_SCHEMA_VERSION, isStablePaymentEventType,\n";
p_a += "mapProviderEventTypeToStable, webhookEventToPaymentEvent, toPersistedPaymentEventEnvelope,\n";
p_a += "hashWebhookPayload, encryptRawWebhookPayload, attachPaymentEvent / buildProviderEventMetadata.\n";
p_a += "Update public-api.test.ts freeze list and public-api.types.test.ts with PaymentEvent discrimination tests.\n\n";

p_a += "### Tests for Stream A\n";
p_a += "packages/core/src/types/payment-event.test.ts (and/or webhook-events.acceptance.test.ts):\n";
p_a += "- every stable name is in the const array and isStablePaymentEventType true\n";
p_a += "- PaymentEvent discrimination: switch on type narrows payment vs refund vs dispute arms\n";
p_a += "- webhookEventToPaymentEvent maps paid → payment.succeeded with Payment + provider metadata\n";
p_a += "- failed → payment.failed with failure\n";
p_a += "- unknown provider type → provider.unmapped preserving provider.eventType\n";
p_a += "- toPersistedPaymentEventEnvelope has no rawPayload key anywhere (JSON.stringify check)\n";
p_a += "- hashWebhookPayload redacts secret_token / signature\n";
p_a += "- encryptRawWebhookPayload roundtrip with fake codec\n";
p_a += "- schemaVersion is literally '1'\n";
p_a += "- mapProviderEventTypeToStable table for stripe/moyasar/paypal/paymob known types\n";
p_a += "- type tests: PaymentEvent arms not assignable across types; envelope requires schemaVersion\n\n";

p_a += "### Docs\n";
p_a += "packages/core/docs/webhook-events.md covering stable names, PaymentEvent, metadata, envelope,\n";
p_a += "raw retention, schema versioning, migration from free-form WebhookEvent.type.\n";
p_a += "Update packages/core/docs/webhooks.md with cross-links. CHANGELOG Unreleased Phase 7.\n";
p_a += "Do NOT write phase-7-gate-report.md (Gate owns it).\n\n";

p_a += "After implement: bun test packages/core/src/types packages/core/src/public-api.test.ts\n";
p_a += "and typecheck core. Stream B migrates gateway parsers to attach PaymentEvent.\n";

let a_result = agent(p_a, #{
    label: "impl:7-event-types",
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
log("Implementing Phase 7 gateway mapping, acceptance tests, testkit/docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — MIGRATE ALL GATEWAYS + CLIENT TO ATTACH PAYMENT EVENTS (Tasks 7.1-7.4 runtime).\n";
p_b += "PRECONDITION: Stream A may have created payment-event types/helpers. If missing, create the type\n";
p_b += "module + helpers yourself (copy Stream A requirements) then migrate gateways.\n";
p_b += "OWN: packages/core/src/gateways/{moyasar,stripe,paypal,paymob}/*.ts parseWebhookEvent paths;\n";
p_b += "packages/core/src/client.ts handleWebhook; gateway.interface.ts JSDoc if needed;\n";
p_b += "base.gateway if shared webhook helpers.\n\n";
p_b += "GOAL: Every parseWebhookEvent returns WebhookEvent that:\n";
p_b += "1) Keeps all 0.x fields (id, type, gateway, paymentId, gatewayPaymentId, status, timestamp, rawPayload, ...)\n";
p_b += "2) Attaches PaymentEvent via attachPaymentEvent / webhookEventToPaymentEvent (event field)\n";
p_b += "3) Sets stableType when mappable\n";
p_b += "4) Sets provider metadata (ProviderEventMetadata) with ISO occurredAt/receivedAt\n";
p_b += "5) Sets payloadHash optional for convenience (hash of redacted raw)\n";
p_b += "6) Continues to redact secrets from rawPayload (Moyasar secret_token already)\n";
p_b += "7) PaymentEvent.schemaVersion is '1'; PaymentEvent.type is stable or provider.unmapped\n";
p_b += "8) payment.failed arms include PaymentFailure when failure info available\n";
p_b += "9) refund/capture/setup/dispute arms use correct entity objects when status mapping indicates\n\n";

p_b += "### Mapping accuracy (must not lie)\n";
p_b += "- paid/approved success webhooks → payment.succeeded (Payment with paid-like status)\n";
p_b += "- authorized-only → payment.authorized (status authorized, NOT paid)\n";
p_b += "- pending/created → payment.created or payment.processing as appropriate\n";
p_b += "- failed/declined → payment.failed with failure\n";
p_b += "- cancelled/voided → payment.cancelled\n";
p_b += "- refund completed → refund.completed (Refund entity), not payment.succeeded\n";
p_b += "- setup_completed → payment_method.setup_completed\n";
p_b += "- Never map unknown types to payment.succeeded\n";
p_b += "- Preserve provider.eventType as the original provider string\n\n";

p_b += "### Client surface\n";
p_b += "handleWebhook may keep Promise<WebhookEvent>. Optionally enrich after parse:\n";
p_b += "if gateway forgot attachPaymentEvent, client can call attachPaymentEvent before hooks.\n";
p_b += "Prefer gateways attach; client as safety net is OK and tested.\n";
p_b += "WebhookVerifiedHook still receives WebhookEvent; document that handlers should switch on\n";
p_b += "event.event?.type or webhookEventToPaymentEvent(event).type for discrimination.\n";
p_b += "Do not break hook signatures.\n\n";

p_b += "### Per gateway notes\n";
p_b += "Moyasar: payment_paid → succeeded; payment_failed/faild → failed; payment_authorized → authorized;\n";
p_b += "  keep secret_token redaction; livemode from live.\n";
p_b += "Stripe: extensive type switch already for status — map those same cases to stable types;\n";
p_b += "  apiVersion + livemode already; occurredAt from created unix; disputes if any in parser.\n";
p_b += "PayPal: CAPTURE.COMPLETED → capture.completed or payment.succeeded (pick one, document, test);\n";
p_b += "  refund events → refund.*; keep supplementary ids in Payment.references.\n";
p_b += "Paymob: success → payment.succeeded; fail → payment.failed; TOKEN → setup_completed;\n";
p_b += "  void/refund flags → cancelled/refund.completed.\n\n";

p_b += "### Tests\n";
p_b += "Update gateway webhook tests: existing type/status assertions still pass; ADD:\n";
p_b += "- event.event is defined with schemaVersion '1'\n";
p_b += "- stableType or event.event.type is the expected stable name for known cases\n";
p_b += "- provider.eventType preserves provider-native\n";
p_b += "- toPersistedPaymentEventEnvelope(event.event) has no raw secrets\n";
p_b += "Run: bun test packages/core\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — ACCEPTANCE TESTS + TYPE TESTS + DISCRIMINATION GUARANTEES (Phase 7 AC).\n";
p_c += "OWN: packages/core/src/types/*event* tests, packages/core/src/webhook-events*.test.ts,\n";
p_c += "public-api.types.test.ts extensions, cross-gateway event consistency tests.\n";
p_c += "If helpers missing, implement minimal helpers first.\n\n";

p_c += "REQUIRED TESTS (acceptance criteria lock):\n";
p_c += "1) Handlers receive discriminated events:\n";
p_c += "   - PaymentEvent union exhaustiveness test (switch on type)\n";
p_c += "   - webhookEventToPaymentEvent / handleWebhook attach event field\n";
p_c += "   - payment.succeeded arm has payment: Payment, not failure\n";
p_c += "   - payment.failed arm has failure: PaymentFailure\n";
p_c += "   - refund.completed arm has refund: Refund\n";
p_c += "2) Provider metadata remains available:\n";
p_c += "   - every PaymentEvent has provider: ProviderEventMetadata with gateway, eventId, eventType,\n";
p_c += "     occurredAt, receivedAt (ISO strings)\n";
p_c += "   - provider.eventType is provider-native, not rewritten away\n";
p_c += "3) Stable sanitized envelope for inbox adapters:\n";
p_c += "   - toPersistedPaymentEventEnvelope produces schemaVersion, event, payloadHash, storedAt\n";
p_c += "   - JSON of envelope must NOT contain rawPayload, secret_token, signature, hmac, headers\n";
p_c += "   - payloadHash stable for same redacted input\n";
p_c += "4) Stable names present for all roadmap 7.1 names\n";
p_c += "5) schemaVersion '1' on all arms; type test that wrong version is not assignable without cast\n";
p_c += "6) Raw retention: encryptRawWebhookPayload with test codec; envelope path never includes raw by default\n";
p_c += "7) Mapping: never map unknown → payment.succeeded\n";
p_c += "8) 0.x: WebhookEvent still has id/type/gateway/status/timestamp/rawPayload for existing code\n";
p_c += "9) Phase 6 regression: operation-result tests still pass; money tests still pass\n\n";
p_c += "Run bun test packages/core && bun run typecheck:types\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — TESTKIT ALIGNMENT + DOCS + CHANGELOG + BASELINE HOOKS.\n";
p_d += "OWN: packages/testkit mock webhook helpers; docs; CHANGELOG; public API freeze.\n\n";

p_d += "### Testkit\n";
p_d += "generateWebhookEvent / mockPayloadToWebhookEvent / mock gateway parseWebhookEvent must:\n";
p_d += "- still return WebhookEvent with 0.x fields\n";
p_d += "- attach PaymentEvent (schemaVersion 1, stable type when possible)\n";
p_d += "- support generating stable types via options if easy (type option may accept stable names)\n";
p_d += "Update mock-gateway tests. Keep bun test packages/testkit green.\n";
p_d += "Import helpers from @paykernel/core — never reimplement mapping inconsistently.\n\n";

p_d += "### Docs (must exist before gate)\n";
p_d += "1) packages/core/docs/webhook-events.md — full Phase 7 guide:\n";
p_d += "   - Stable event name catalog (7.1 list)\n";
p_d += "   - PaymentEvent discriminated union examples\n";
p_d += "   - ProviderEventMetadata fields\n";
p_d += "   - PersistedPaymentEventEnvelope for inbox adapters\n";
p_d += "   - Raw payload retention: request-local vs encrypted opt-in codec\n";
p_d += "   - schemaVersion compatibility rules\n";
p_d += "   - Migration: free-form type → stableType + event field\n";
p_d += "   - Handler example: switch (event.event.type) { case 'payment.succeeded': ... }\n";
p_d += "2) Update packages/core/docs/webhooks.md — link to webhook-events.md; note dual-write\n";
p_d += "3) packages/core/CHANGELOG.md Unreleased: Phase 7 section\n";
p_d += "4) packages/core/README.md brief note if webhook section exists\n";
p_d += "5) packages/testkit/README.md note about PaymentEvent on mock webhooks\n\n";

p_d += "### Baselines\n";
p_d += "Public API additive exports expected. Regenerate if standard:\n";
p_d += "  bun run baseline:api\n";
p_d += "Read packages/core/docs/baseline/README.md first.\n";
p_d += "Update public-api.test.ts freeze list for new exports.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:7-gateway-events", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:7-acceptance-tests", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "impl:7-testkit-docs", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 7 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 8+.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) STABLE_PAYMENT_EVENT_TYPES includes all roadmap 7.1 names; isStablePaymentEventType works.\n";
p_int += "2) PaymentEvent discriminated union with schemaVersion:'1' on every arm; exported.\n";
p_int += "3) ProviderEventMetadata with gateway, eventId, eventType, occurredAt, receivedAt (+ optional fields).\n";
p_int += "4) PersistedPaymentEventEnvelope + toPersistedPaymentEventEnvelope strips raw/secrets.\n";
p_int += "5) hashWebhookPayload redacts secrets; encryptRawWebhookPayload opt-in codec path exists.\n";
p_int += "6) mapProviderEventTypeToStable + webhookEventToPaymentEvent helpers exported.\n";
p_int += "7) All 4 gateways attach PaymentEvent (or client safety-net guarantees handleWebhook does).\n";
p_int += "8) WebhookEvent 0.x fields preserved (id, type, gateway, status, timestamp, rawPayload).\n";
p_int += "9) Handlers can discriminate via event.event.type; type tests prove narrowing.\n";
p_int += "10) provider.eventType preserves provider-native names.\n";
p_int += "11) docs/webhook-events.md + CHANGELOG + public API exports + freeze tests.\n";
p_int += "12) Testkit mock webhooks attach PaymentEvent; tests green.\n";
p_int += "13) Phase 0-6 safety: money + outcomes intact, typecheck, tests core+testkit, build, boundaries.\n";
p_int += "14) Coverage thresholds for core still met.\n";
p_int += "15) No secret leakage in envelopes; no Phase 8 runtime; no new packages.\n";
p_int += "16) Logical bugs to eliminate: mapping unknown→succeeded; envelope containing rawPayload;\n";
p_int += "    renaming provider.eventType; silent schema meaning change; breaking rawPayload 0.x;\n";
p_int += "    Date-only fields in envelope without ISO strings; dropping Phase 6 Payment reuse incorrectly.\n";
p_int += "17) exactOptionalPropertyTypes careful with optional event/stableType/provider fields.\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run validate:package  (if time; at least pack:check + typecheck)\n";
p_int += "19) If Stream A failed, implement types fully yourself. Phase 7 cannot ship without them.\n";
p_int += "20) Regenerate API baseline if standard after additive exports.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase7",
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
p_ver += "Verify Phase 7 completion in " + root + " with hard evidence from commands and file reads.\n";
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
p_ver += "9) bun run validate:package (or pack:check + publint + attw)\n";
p_ver += "10) Evidence STABLE_PAYMENT_EVENT_TYPES includes all 7.1 names (read source)\n";
p_ver += "11) Evidence PaymentEvent discriminated union with schemaVersion '1' (read types)\n";
p_ver += "12) Evidence ProviderEventMetadata complete fields\n";
p_ver += "13) Evidence PersistedPaymentEventEnvelope + strip raw tests\n";
p_ver += "14) Evidence raw retention codec API + tests\n";
p_ver += "15) Evidence mapProviderEventTypeToStable / webhookEventToPaymentEvent\n";
p_ver += "16) Evidence all 4 gateways or client attach PaymentEvent (grep event: / attachPaymentEvent)\n";
p_ver += "17) Evidence WebhookEvent still has rawPayload (0.x)\n";
p_ver += "18) Evidence docs/webhook-events.md exists\n";
p_ver += "19) Evidence Phase 6 outcomes still green (operation-result tests)\n";
p_ver += "20) Evidence Phase 5 money still green\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- stable_names_ok: 7.1 catalog present + isStablePaymentEventType\n";
p_ver += "- payment_event_ok: PaymentEvent union + mapping helpers\n";
p_ver += "- provider_metadata_ok: ProviderEventMetadata on events\n";
p_ver += "- envelope_ok: persistable envelope without raw/secrets\n";
p_ver += "- raw_retention_ok: opt-in codec path; default no raw in envelope\n";
p_ver += "- schema_version_ok: schemaVersion '1' + docs compatibility rules\n";
p_ver += "- handlers_discriminated_ok: discrimination tests + handleWebhook attaches\n";
p_ver += "- compat_ok: WebhookEvent 0.x fields + existing webhook tests pass\n";
p_ver += "Set ok=true only if typecheck, tests (core+testkit), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase7",
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
    write_scratch_file("phase7-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 7 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 7 — each PASS or BLOCKING:\n";
p_gate += "A1) handlers receive discriminated events.\n";
p_gate += "    Evidence: PaymentEvent union; attach on handleWebhook/parseWebhookEvent; type+runtime tests\n";
p_gate += "    showing switch narrowing; payment.succeeded vs payment.failed vs refund.completed arms.\n";
p_gate += "A2) provider metadata remains available.\n";
p_gate += "    Evidence: ProviderEventMetadata on every PaymentEvent; provider.eventType native;\n";
p_gate += "    gateway/eventId/occurredAt/receivedAt present in tests.\n";
p_gate += "A3) a stable, sanitized event envelope can be persisted by inbox adapters.\n";
p_gate += "    Evidence: PersistedPaymentEventEnvelope; toPersistedPaymentEventEnvelope; tests prove\n";
p_gate += "    no rawPayload/secrets/headers; payloadHash + storedAt + schemaVersion.\n\n";
p_gate += "Also require Phase 7 tasks 7.1-7.5 deliverables:\n";
p_gate += "- 7.1 Stable event names catalog (full list)\n";
p_gate += "- 7.2 ProviderEventMetadata\n";
p_gate += "- 7.3 PersistedPaymentEventEnvelope\n";
p_gate += "- 7.4 Explicit raw payload retention (opt-in codec)\n";
p_gate += "- 7.5 schemaVersion '1' + compatibility docs\n";
p_gate += "- Phase 0-6 safety net still green; boundaries; no core→testkit dep\n";
p_gate += "- No logical bugs: unknown→succeeded; secrets in envelope; provider.eventType rewritten away;\n";
p_gate += "  breaking 0.x WebhookEvent; missing discrimination; float money reintroduction.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit; bun run typecheck; check:boundaries.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-7-gate-report.md\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase7-adversarial",
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
    write_scratch_file("phase7-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 7 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 7 only — no Phase 8 runtime, no new providers.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete stable names, PaymentEvent, ProviderEventMetadata, envelope, raw retention codec,\n";
    p_fix += "gateway/client attach, tests, docs as needed.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase7-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 7 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit, coverage, build, boundaries.\n";
    p_re += "Confirm all 7.1-7.5 deliverables and acceptance criteria with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase7-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase7-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 7 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/core/docs/baseline/phase-7-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 7.1-7.5 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase7-final",
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
        write_scratch_file("phase7-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 7 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 7,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
