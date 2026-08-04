let meta = #{
    name: "phase-6-typed-outcomes",
    description: "Phase 6 Typed Provider Inputs and Operation Results: critic, implement CommonPaymentInput + PaymentOperationResult + domain statuses + provider refs, integrate, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 6 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "common inputs, outcome unions, domain statuses, provider refs, gateway migration, tests, docs" },
        #{ title: "Integrate", detail: "unify streams, public API, baselines, keep green" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, boundaries, outcome evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 6" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 6 (Typed Provider Inputs and Operation Results) for payments-sdk monorepo",
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
        "common_input_ok", "outcome_union_ok", "domain_statuses_ok",
        "provider_refs_ok", "no_paid_confusion_ok", "indeterminate_explicit_ok",
        "provider_fields_isolated_ok", "compat_ok",
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
        "common_input_ok": #{ "type": "boolean" },
        "outcome_union_ok": #{ "type": "boolean" },
        "domain_statuses_ok": #{ "type": "boolean" },
        "provider_refs_ok": #{ "type": "boolean" },
        "no_paid_confusion_ok": #{ "type": "boolean" },
        "indeterminate_explicit_ok": #{ "type": "boolean" },
        "provider_fields_isolated_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 6 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 6 critic for the payments-sdk monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 6 — Typed Provider Inputs and Operation Results\" completely\n";
p_critic += "(Objective, Tasks 6.1-6.4, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4) and Package Boundary Rules if present.\n";
p_critic += "Phases 0-5 are COMPLETE — preserve baselines, monorepo, plugin architecture, capabilities,\n";
p_critic += "testkit, money model (bigint minors, AmountInput, shared conversion), pack validation.\n";
p_critic += "Do NOT start Phase 7 webhook event schema rewrite, Phase 8 runtime injection, Phase 9 stores,\n";
p_critic += "new real providers, or gateway extraction packages.\n\n";
p_critic += "Audit against EVERY Phase 6 task and acceptance criterion:\n\n";
p_critic += "6.1 Split Common and Provider-Specific Inputs — CommonPaymentInput = {\n";
p_critic += "    amount: Money (or AmountInput for 0.x); orderId?; description?; metadata? }\n";
p_critic += "    Provider adapters expose typed extensions (already partially: MoyasarCreatePaymentParams etc).\n";
p_critic += "    Goal: common contracts NOT polluted by stripePaymentMethodId, moyasarSource, paymob*, etc.\n\n";
p_critic += "6.2 Replace success: boolean with PaymentOperationResult discriminated union:\n";
p_critic += "    | { outcome: 'succeeded'; payment: Payment }\n";
p_critic += "    | { outcome: 'requires_action'; payment: Payment; action: PaymentAction }\n";
p_critic += "    | { outcome: 'declined'; failure: PaymentDecline }\n";
p_critic += "    | { outcome: 'failed'; error: PaymentError }\n";
p_critic += "    | { outcome: 'indeterminate'; providerRequestId?; reconciliationRequired: true }\n";
p_critic += "    pending/requires_action MUST NOT be mistakable for paid/succeeded.\n";
p_critic += "    indeterminate MUST be explicit (never success:false that looks like decline).\n\n";
p_critic += "6.3 Separate Domain Statuses — separate status unions for payments, authorizations,\n";
p_critic += "    captures, refunds, setup/tokenization, disputes, transfers, and payouts.\n";
p_critic += "    Today PaymentStatus is a mega-union mixing payment + refund + setup statuses.\n\n";
p_critic += "6.4 Standardize Provider References — expose:\n";
p_critic += "    internal reference; provider object ID; provider request ID; parent/related IDs;\n";
p_critic += "    provider-native status; normalized status.\n\n";
p_critic += "Acceptance criteria:\n";
p_critic += "- pending or requires-action results cannot be mistaken for paid results\n";
p_critic += "- indeterminate outcomes are explicit\n";
p_critic += "- provider-specific fields do not pollute common inputs\n\n";
p_critic += "Inspect thoroughly:\n";
p_critic += "- packages/core/src/types/payment.types.ts (CreatePaymentParams pollution, GatewayPaymentResult.success,\n";
p_critic += "  PaymentStatus mega-union, GatewayRefundResult.success)\n";
p_critic += "- packages/core/src/types/validation.ts schemas\n";
p_critic += "- packages/core/src/errors.ts (PaymentError hierarchy; is there PaymentDecline?)\n";
p_critic += "- packages/core/src/client.ts and create-payment-client.ts return types\n";
p_critic += "- packages/core/src/hooks/* after-hook freeze of success/status\n";
p_critic += "- All four gateways: how they set success:true/false, map statuses, handle 3DS/requires_action,\n";
p_critic += "  timeouts/indeterminate (esp. Moyasar given_id, Paymob idempotency guard)\n";
p_critic += "- packages/testkit mock gateway outcomes\n";
p_critic += "- packages/core/src/index.ts public exports\n";
p_critic += "- public-api tests, baselines, CHANGELOG patterns\n";
p_critic += "- Phase 5 money still intact (AmountInput, money.ts)\n\n";
p_critic += "CRITICAL GAPS to confirm with evidence:\n";
p_critic += "1) GatewayPaymentResult uses success:boolean — ambiguous for pending/3DS/indeterminate\n";
p_critic += "2) No PaymentOperationResult / outcome discrimination\n";
p_critic += "3) CreatePaymentParams mixes common + all provider fields on one interface\n";
p_critic += "4) PaymentStatus mixes refund_*, setup_completed, payment lifecycle into one bag\n";
p_critic += "5) No standardized ProviderReferences type (gatewayId/orderId/captureId scattered)\n";
p_critic += "6) No Payment / PaymentAction / PaymentDecline domain models for outcome arms\n";
p_critic += "7) Missing type+runtime tests that succeeded cannot be confused with requires_action\n\n";
p_critic += "List concrete GAPS. List ALREADY_PRESENT (provider-specific create param types, PaymentNextAction,\n";
p_critic += "gatewayId/gatewayObjectId fields, nextAction, some indeterminate handling, Money/AmountInput).\n";
p_critic += "stream_plan for implement order. risks: breaking all gateway tests that assert success:true;\n";
p_critic += "hooks freeze of success; 0.x consumers reading .success; exactOptionalPropertyTypes; Phase 5 money\n";
p_critic += "regression; testkit mock drift; conflating throw vs outcome:failed; silent mapping of pending to paid.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase6-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase6-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 6 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 6\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 6 Typed Provider Inputs and Operation Results in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core package is packages/core = @paykernel/core (0.8.0).\n";
common += "Testkit: packages/testkit = @paykernel/testkit (depends on core).\n";
common += "PHASE 6 ONLY: Typed Provider Inputs and Operation Results.\n";
common += "Do NOT start Phase 7 webhooks, Phase 8 runtime, Phase 9 stores, new PSPs, gateway extraction.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-5: monorepo, baselines, plugin architecture,\n";
common += "capabilities, createPaymentClient, registry, factories, pack validation, coverage thresholds,\n";
common += "testkit, Money/AmountInput/bigint conversion (NEVER reintroduce float money math).\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change.\n";
common += "2) No unsafe mutation retries without native idempotency or atomic dedup.\n";
common += "3) Never convert uncertain outcomes into failure — outcome:'indeterminate' with reconciliationRequired.\n";
common += "4) Do not hide provider differences — provider-native status + provider-specific input extensions stay explicit.\n";
common += "5) No secret leakage in errors/logs/fixtures.\n";
common += "6) No framework coupling.\n";
common += "7) No Node-only assumptions in portable packages.\n";
common += "8) Keep 0.x backward compat: GatewayPaymentResult.success MUST remain populated (deprecated)\n";
common += "   for existing callers; new preferred surface is outcome discrimination.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) exactOptionalPropertyTypes is ON — respect optional props carefully.\n";
common += "11) Core must NOT depend on testkit.\n";
common += "12) Money model from Phase 5 stays: AmountInput = number | Money; shared toMinorUnits.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: core types — CommonPaymentInput, outcomes, domain statuses, provider refs
let p_a = "";
p_a += common;
p_a += "STREAM A — CORE TYPE MODEL (Tasks 6.1, 6.2, 6.3, 6.4 types + helpers + public exports).\n";
p_a += "You own packages/core/src/types/payment.types.ts (and new files under types/ if cleaner),\n";
p_a += "packages/core/src/types/operation-result.ts (new if needed), packages/core/src/types/domain-status.ts,\n";
p_a += "packages/core/src/types/provider-refs.ts, packages/core/src/errors.ts (PaymentDecline if needed),\n";
p_a += "packages/core/src/index.ts exports, type tests, unit tests for helpers.\n";
p_a += "Coordinate so Stream B can import helpers and map gateway results.\n\n";

p_a += "### DESIGN PRINCIPLES (non-negotiable)\n";
p_a += "1) Discriminated unions on `outcome` — NEVER treat pending/requires_action as paid/succeeded.\n";
p_a += "2) Indeterminate is EXPLICIT: outcome:'indeterminate' + reconciliationRequired:true.\n";
p_a += "   Do NOT map timeouts-after-submit to outcome:'failed' or success:false alone.\n";
p_a += "3) 0.x compat: keep GatewayPaymentResult with deprecated `success: boolean` dual-written from outcome.\n";
p_a += "   Prefer adding `outcome` + structured fields onto results OR provide PaymentOperationResult as\n";
p_a += "   parallel preferred type + helpers to convert both directions for migration.\n";
p_a += "4) Common inputs must not require stripe*/moyasar*/paypal*/paymob* fields.\n";
p_a += "5) Domain statuses are SEPARATE unions — do not invent fake shared statuses across domains.\n\n";

p_a += "### 6.1 CommonPaymentInput\n";
p_a += "```ts\n";
p_a += "import type { Money } from '../utils/money';\n";
p_a += "import type { AmountInput } from './payment.types'; // or colocate\n";
p_a += "export type PaymentMetadata = Record<string, unknown>;\n";
p_a += "/** Common payment fields shared across providers (no provider-specific keys). */\n";
p_a += "export type CommonPaymentInput = {\n";
p_a += "  /** Prefer Money; number remains 0.x deprecated via AmountInput */\n";
p_a += "  amount: AmountInput; // roadmap shows Money; 0.x uses AmountInput for compat\n";
p_a += "  orderId?: string;\n";
p_a += "  description?: string;\n";
p_a += "  metadata?: PaymentMetadata;\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Refactor CreatePaymentParams conceptually:\n";
p_a += "- Document that common fields come from CommonPaymentInput.\n";
p_a += "- Prefer: CreatePaymentParams extends CommonPaymentInput & { currency, callbackUrl, capture?, idempotencyKey? }\n";
p_a += "  PLUS optional provider-specific fields STILL allowed on CreatePaymentParams for 0.x convenience,\n";
p_a += "  BUT also ensure typed extensions exist (Moyasar/Stripe/PayPal/Paymob Create params) as the clean path.\n";
p_a += "- Export CommonPaymentInput and document that provider packages/adapters should extend it rather than\n";
p_a += "  dumping provider fields into the common contract.\n";
p_a += "- Add a type test proving CommonPaymentInput has NO stripePaymentMethodId / moyasarSource / paymob* keys\n";
p_a += "  (use Assignability / Expect keys or keyof checks).\n\n";

p_a += "### 6.2 PaymentOperationResult + supporting types\n";
p_a += "Introduce a normalized Payment snapshot used inside outcomes:\n";
p_a += "```ts\n";
p_a += "export type PaymentAction =\n";
p_a += "  | { type: 'redirect'; url: string; [key: string]: unknown }\n";
p_a += "  | { type: 'use_stripe_sdk'; clientSecret?: string; [key: string]: unknown }\n";
p_a += "  | { type: 'stcpay_otp'; /* Moyasar */ [key: string]: unknown }\n";
p_a += "  | { type: string; [key: string]: unknown }; // open for provider-native\n";
p_a += "// Prefer reusing/aligning with existing PaymentNextAction where possible.\n";
p_a += "\n";
p_a += "export type PaymentDecline = {\n";
p_a += "  code: string;\n";
p_a += "  message: string;\n";
p_a += "  /** Provider decline code if different from normalized code */\n";
p_a += "  providerCode?: string;\n";
p_a += "  softDecline?: boolean;\n";
p_a += "  raw?: unknown; // never secrets\n";
p_a += "};\n";
p_a += "\n";
p_a += "export type Payment = {\n";
p_a += "  /** Normalized payment lifecycle status (PaymentDomainStatus) */\n";
p_a += "  status: PaymentDomainStatus;\n";
p_a += "  amount?: number; // 0.x major units; document Money future\n";
p_a += "  currency?: string;\n";
p_a += "  references: ProviderReferences;\n";
p_a += "  redirectUrl?: string;\n";
p_a += "  clientSecret?: string;\n";
p_a += "  nextAction?: PaymentNextAction;\n";
p_a += "  fee?: number;\n";
p_a += "  capturedAmount?: number;\n";
p_a += "  refundedAmount?: number;\n";
p_a += "  rawResponse?: unknown;\n";
p_a += "};\n";
p_a += "\n";
p_a += "export type PaymentOperationOutcome =\n";
p_a += "  | 'succeeded'\n";
p_a += "  | 'requires_action'\n";
p_a += "  | 'declined'\n";
p_a += "  | 'failed'\n";
p_a += "  | 'indeterminate';\n";
p_a += "\n";
p_a += "export type PaymentOperationResult =\n";
p_a += "  | { outcome: 'succeeded'; payment: Payment }\n";
p_a += "  | { outcome: 'requires_action'; payment: Payment; action: PaymentAction }\n";
p_a += "  | { outcome: 'declined'; failure: PaymentDecline; payment?: Payment }\n";
p_a += "  | { outcome: 'failed'; error: PaymentErrorLike; payment?: Payment }\n";
p_a += "  | {\n";
p_a += "      outcome: 'indeterminate';\n";
p_a += "      providerRequestId?: string;\n";
p_a += "      reconciliationRequired: true;\n";
p_a += "      payment?: Payment;\n";
p_a += "      message?: string;\n";
p_a += "    };\n";
p_a += "```\n";
p_a += "PaymentErrorLike: serializable shape { name, message, code, statusCode? } derived from PaymentError\n";
p_a += "OR allow PaymentError instance in the failed arm if JSON is not required for the type itself.\n";
p_a += "Prefer a plain serializable object for the public result so results can be logged safely.\n\n";

p_a += "### 6.2b Evolve GatewayPaymentResult (0.x dual write)\n";
p_a += "```ts\n";
p_a += "export interface GatewayPaymentResult {\n";
p_a += "  /** @deprecated Prefer `outcome`. Kept for 0.x. Dual-written from outcome mapping. */\n";
p_a += "  success: boolean;\n";
p_a += "  /** Preferred Phase 6 outcome. When present, clients should switch on this. */\n";
p_a += "  outcome?: PaymentOperationOutcome;\n";
p_a += "  // existing fields...\n";
p_a += "  /** Standardized provider references (preferred over ad-hoc id fields alone). */\n";
p_a += "  references?: ProviderReferences;\n";
p_a += "  /** Structured decline when outcome is declined (or success false with decline). */\n";
p_a += "  decline?: PaymentDecline;\n";
p_a += "  /** Explicit indeterminate marker when outcome is indeterminate. */\n";
p_a += "  reconciliationRequired?: boolean;\n";
p_a += "  providerRequestId?: string;\n";
p_a += "  // keep gatewayId, status, redirectUrl, amount, nextAction, rawResponse, etc.\n";
p_a += "}\n";
p_a += "```\n";
p_a += "Add pure helpers in packages/core/src/types/operation-result.ts or utils/operation-result.ts:\n";
p_a += "1) mapGatewayResultToOperationResult(result: GatewayPaymentResult): PaymentOperationResult\n";
p_a += "2) applyOutcomeToGatewayResult(base fields + outcome): GatewayPaymentResult\n";
p_a += "   — sets success correctly: only outcome==='succeeded' => success true;\n";
p_a += "     requires_action => success true OR false? SEE BELOW.\n";
p_a += "CRITICAL COMPAT MAPPING for success (document in JSDoc + money/outcome docs):\n";
p_a += "- Historically gateways set success:true when the API call succeeded even if payment is pending/3DS.\n";
p_a += "  Preserve that: success means 'HTTP/API call completed without transport failure', NOT 'paid'.\n";
p_a += "  Document this clearly. The NEW signal for paid is outcome==='succeeded' AND status in paid set.\n";
p_a += "- outcome==='succeeded' => success:true; status paid/approved/authorized (as appropriate)\n";
p_a += "- outcome==='requires_action' => success:true (API ok, customer action needed); status pending/processing\n";
p_a += "- outcome==='declined' => success:false; status failed\n";
p_a += "- outcome==='failed' => success:false; status failed\n";
p_a += "- outcome==='indeterminate' => success:false is WRONG semantics for money safety;\n";
p_a += "  set success:false ONLY if 0.x tests require it, but MUST set outcome:'indeterminate' +\n";
p_a += "  reconciliationRequired:true so new clients never treat it as a definitive decline.\n";
p_a += "  Prefer success:false with outcome indeterminate for 'do not treat as paid', with explicit docs.\n";
p_a += "3) isPaidOutcome(result): boolean — true ONLY for outcome==='succeeded' with paid-like statuses\n";
p_a += "4) isRequiresActionOutcome(result): boolean\n";
p_a += "5) isIndeterminateOutcome(result): boolean\n";
p_a += "Type tests: requires_action is not assignable to succeeded arm; isPaidOutcome false for pending.\n\n";

p_a += "### 6.3 Separate Domain Statuses\n";
p_a += "```ts\n";
p_a += "/** Payment charge/intent lifecycle only (no refund_* / setup_*). */\n";
p_a += "export type PaymentDomainStatus =\n";
p_a += "  | 'pending' | 'processing' | 'authorized' | 'approved' | 'paid'\n";
p_a += "  | 'partially_captured' | 'failed' | 'cancelled' | 'reversed'\n";
p_a += "  | 'refunded' | 'partially_refunded'; // terminal payment states reflecting refunds OK\n";
p_a += "\n";
p_a += "export type AuthorizationStatus =\n";
p_a += "  | 'pending' | 'authorized' | 'captured' | 'partially_captured' | 'voided' | 'expired' | 'failed';\n";
p_a += "\n";
p_a += "export type CaptureStatus =\n";
p_a += "  | 'pending' | 'completed' | 'partially_completed' | 'failed';\n";
p_a += "\n";
p_a += "export type RefundDomainStatus = 'pending' | 'completed' | 'failed'; // align with RefundStatus\n";
p_a += "\n";
p_a += "export type SetupTokenStatus =\n";
p_a += "  | 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled';\n";
p_a += "\n";
p_a += "export type DisputeStatus =\n";
p_a += "  | 'needs_response' | 'under_review' | 'won' | 'lost' | 'warning_closed' | 'charge_refunded';\n";
p_a += "\n";
p_a += "export type TransferStatus =\n";
p_a += "  | 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled' | 'reversed';\n";
p_a += "\n";
p_a += "export type PayoutStatus =\n";
p_a += "  | 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';\n";
p_a += "```\n";
p_a += "PaymentStatus (legacy mega-union) MUST remain as a union of the historical values for 0.x\n";
p_a += "(include refund_pending, refund_completed, refund_failed, setup_completed) and be documented as\n";
p_a += "deprecated in favor of domain-specific statuses. Prefer:\n";
p_a += "export type PaymentStatus = PaymentDomainStatus | 'refund_pending' | 'refund_completed'\n";
p_a += "  | 'refund_failed' | 'setup_completed';\n";
p_a += "so existing assignments still typecheck. Add isPaymentDomainStatus() helper.\n";
p_a += "RefundStatus already exists — alias RefundDomainStatus = RefundStatus if identical.\n\n";

p_a += "### 6.4 ProviderReferences\n";
p_a += "```ts\n";
p_a += "export type ProviderReferences = {\n";
p_a += "  /** SDK/internal correlation id if any (orderId from merchant, idempotency key, etc.) */\n";
p_a += "  internalReference?: string;\n";
p_a += "  /** Primary provider object ID (PaymentIntent id, Moyasar payment id, etc.) */\n";
p_a += "  providerObjectId: string;\n";
p_a += "  /** Provider request / idempotency / correlation id from the provider if available */\n";
p_a += "  providerRequestId?: string;\n";
p_a += "  /** Related IDs: order, capture, authorization, refund, charge, customer, etc. */\n";
p_a += "  parentId?: string;\n";
p_a += "  relatedIds?: {\n";
p_a += "    orderId?: string;\n";
p_a += "    captureId?: string;\n";
p_a += "    authorizationId?: string;\n";
p_a += "    refundId?: string;\n";
p_a += "    chargeId?: string;\n";
p_a += "    customerId?: string;\n";
p_a += "    [key: string]: string | undefined;\n";
p_a += "  };\n";
p_a += "  /** Provider-native status string as returned by the API */\n";
p_a += "  providerNativeStatus?: string;\n";
p_a += "  /** Normalized domain status for this object */\n";
p_a += "  normalizedStatus: PaymentStatus | string;\n";
p_a += "  gateway: GatewayId;\n";
p_a += "};\n";
p_a += "```\n";
p_a += "Helper: buildProviderReferences({ gateway, gatewayId, status, orderId, captureId, ... })\n";
p_a += "When building GatewayPaymentResult, set references AND keep legacy gatewayId/orderId/captureId fields\n";
p_a += "populated (0.x).\n\n";

p_a += "### Public exports (packages/core/src/index.ts)\n";
p_a += "Export types: CommonPaymentInput, PaymentMetadata, Payment, PaymentAction, PaymentDecline,\n";
p_a += "PaymentOperationResult, PaymentOperationOutcome, PaymentDomainStatus, AuthorizationStatus,\n";
p_a += "CaptureStatus, RefundDomainStatus (or RefundStatus already), SetupTokenStatus, DisputeStatus,\n";
p_a += "TransferStatus, PayoutStatus, ProviderReferences,\n";
p_a += "and helpers: mapGatewayResultToOperationResult, isPaidOutcome, isRequiresActionOutcome,\n";
p_a += "isIndeterminateOutcome, buildProviderReferences, applyOutcomeFields (name as implemented).\n";
p_a += "Update public-api.test.ts freeze list and public-api.types.test.ts.\n\n";

p_a += "### Tests for Stream A\n";
p_a += "packages/core/src/types/operation-result.test.ts (or similar):\n";
p_a += "- map requires_action result => outcome requires_action; isPaidOutcome false\n";
p_a += "- map paid status + success => outcome succeeded; isPaidOutcome true\n";
p_a += "- map declined => outcome declined with PaymentDecline\n";
p_a += "- map indeterminate markers => outcome indeterminate + reconciliationRequired true\n";
p_a += "- never maps pending/requires_action to succeeded\n";
p_a += "- CommonPaymentInput keyof excludes provider fields (type test)\n";
p_a += "- domain status unions are distinct (type tests)\n";
p_a += "- ProviderReferences built correctly from gateway result fields\n\n";

p_a += "### Docs\n";
p_a += "packages/core/docs/operation-results.md (or outcomes.md) covering outcomes, success deprecation,\n";
p_a += "indeterminate, migration from success:boolean. Cross-link README. CHANGELOG Unreleased Phase 6.\n";
p_a += "Do NOT write phase-6-gate-report.md (Gate owns it).\n\n";

p_a += "After implement: bun test packages/core/src/types packages/core/src/public-api.test.ts\n";
p_a += "and typecheck core. Stream B migrates gateways onto outcome + references.\n";

let a_result = agent(p_a, #{
    label: "impl:6-type-model",
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
log("Implementing Phase 6 gateway migration, tests, testkit/docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — MIGRATE ALL GATEWAYS TO OUTCOMES + PROVIDER REFERENCES (Tasks 6.2, 6.4 runtime).\n";
p_b += "PRECONDITION: Stream A may have created operation-result helpers and types. If missing, create\n";
p_b += "the type module + helpers yourself (copy Stream A requirements) then migrate gateways.\n";
p_b += "OWN: packages/core/src/gateways/{moyasar,stripe,paypal,paymob}/*.ts result construction paths;\n";
p_b += "base.gateway.ts if it constructs results; hooks freeze list if success/outcome fields need freeze.\n\n";
p_b += "GOAL: Every createPayment/capturePayment/voidPayment/getPayment (and refund where applicable)\n";
p_b += "returns GatewayPaymentResult with:\n";
p_b += "1) outcome set correctly (succeeded | requires_action | declined | failed | indeterminate)\n";
p_b += "2) references: ProviderReferences populated (providerObjectId = gatewayId at minimum)\n";
p_b += "3) success dual-written per documented mapping (0.x)\n";
p_b += "4) nextAction/action for requires_action paths\n";
p_b += "5) decline object when declined\n";
p_b += "6) reconciliationRequired:true + outcome indeterminate for uncertain transport/timeout-after-submit\n\n";

p_b += "### Mapping rules (apply consistently)\n";
p_b += "- Paid/approved/authorized (when auth-only is intentional success): outcome 'succeeded'\n";
p_b += "  (document: authorized-without-capture is still succeeded operation for authorize flow;\n";
p_b += "   payment.status remains 'authorized' not 'paid')\n";
p_b += "- 3DS / redirect / STC OTP / requires_action: outcome 'requires_action' + action/nextAction\n";
p_b += "  MUST NOT use outcome 'succeeded' even if success:true for API-ok\n";
p_b += "- Card declined / soft decline responses that complete without throw: outcome 'declined'\n";
p_b += "- Thrown GatewayApiError paths can stay throws (client error hooks) OR map to failed where\n";
p_b += "  gateways currently return success:false objects — keep existing throw-vs-return behavior\n";
p_b += "  per gateway to avoid breaking tests; when returning objects with success:false, set outcome.\n";
p_b += "- Timeouts / connection loss AFTER request likely submitted: outcome 'indeterminate',\n";
p_b += "  reconciliationRequired:true, providerRequestId if known. NEVER invent success paid.\n\n";

p_b += "### Per gateway notes\n";
p_b += "Moyasar: 3DS redirectUrl => requires_action; paid/authorized statuses => succeeded;\n";
p_b += "  idempotency indeterminate guards already exist — wire outcome indeterminate.\n";
p_b += "Stripe: requires_action / requires_payment_method / requires_confirmation mapping;\n";
p_b += "  card_declined => declined; PaymentIntent succeeded => succeeded; set references with PI id,\n";
p_b += "  charge id when present, providerNativeStatus = Stripe status string.\n";
p_b += "PayPal: CREATED/APPROVAL pending redirect => requires_action; COMPLETED capture => succeeded;\n";
p_b += "  set orderId/captureId/authorizationId inside references.relatedIds AND legacy fields.\n";
p_b += "Paymob: intention/pending checkout => requires_action; success transactions => succeeded;\n";
p_b += "  declined messages => declined; indeterminate idempotency path => indeterminate.\n\n";

p_b += "### Hooks freeze\n";
p_b += "Read hooks.manager after-hook freeze of money/identity fields. Ensure outcome, references,\n";
p_b += "decline, reconciliationRequired, providerRequestId cannot be flipped by after-hooks to fake paid.\n";
p_b += "Extend freeze list if currently only freezes success/status/amount/gatewayId.\n\n";

p_b += "### Client surface\n";
p_b += "PaymentClient methods may keep Promise<GatewayPaymentResult>. Optionally add convenience\n";
p_b += "wrappers later — NOT required if helpers exist. Do not break overloads.\n\n";

p_b += "### Tests\n";
p_b += "Update gateway tests: existing success assertions still pass; ADD assertions that:\n";
p_b += "- paid path has outcome==='succeeded'\n";
p_b += "- 3DS/redirect path has outcome==='requires_action' and NOT succeeded\n";
p_b += "- references.providerObjectId is set\n";
p_b += "Run: bun test packages/core\n";
p_b += "Do NOT break Phase 5 money conversion paths.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — ACCEPTANCE TESTS + TYPE TESTS + NO-CONFUSION GUARANTEES (Phase 6 AC).\n";
p_c += "OWN: packages/core/src/types/* tests, packages/core/src/operation-results*.test.ts,\n";
p_c += "public-api.types.test.ts extensions, cross-gateway outcome consistency tests.\n";
p_c += "If helpers missing, implement minimal helpers first.\n\n";

p_c += "REQUIRED TESTS (acceptance criteria lock):\n";
p_c += "1) pending or requires_action CANNOT be mistaken for paid:\n";
p_c += "   - isPaidOutcome({ success:true, status:'pending', outcome:'requires_action', ... }) === false\n";
p_c += "   - isPaidOutcome for status paid + outcome succeeded === true\n";
p_c += "   - Type-level: switch on PaymentOperationResult outcome exhaustiveness test\n";
p_c += "2) indeterminate is explicit:\n";
p_c += "   - mapGatewayResultToOperationResult with reconciliationRequired true => outcome indeterminate\n";
p_c += "   - arm has reconciliationRequired: true literally (const true)\n";
p_c += "3) provider-specific fields do not pollute CommonPaymentInput:\n";
p_c += "   - type test: keyof CommonPaymentInput is only amount|orderId|description|metadata (and maybe currency if you put it there — prefer amount+orderId+description+metadata per roadmap;\n";
p_c += "     currency may live on CreatePaymentParams)\n";
p_c += "   - Assigning stripePaymentMethodId to CommonPaymentInput is a type error (expect-error test)\n";
p_c += "4) Domain statuses: PaymentDomainStatus does not include 'setup_completed' or 'refund_pending'\n";
p_c += "   (those stay on legacy PaymentStatus only)\n";
p_c += "5) ProviderReferences required fields present in helper output\n";
p_c += "6) Gateway integration smoke: at least one test per gateway or shared table verifying outcome\n";
p_c += "   field on createPayment mock/real unit path if Stream B set them\n";
p_c += "7) Refund GatewayRefundResult: add outcome? optional if time — at minimum document; prefer\n";
p_c += "   RefundOperationResult parallel type with succeeded|failed|pending|indeterminate if low cost\n";
p_c += "8) Regression: money() / AmountInput still work; no float conversion reintroduced\n\n";

p_c += "Run bun test packages/core && bun run typecheck:types\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — TESTKIT ALIGNMENT + DOCS + CHANGELOG + BASELINE HOOKS.\n";
p_d += "OWN: packages/testkit mock gateway results (set outcome + references), conformance if needed;\n";
p_d += "docs; CHANGELOG; public API freeze; monorepo docs cross-links.\n\n";

p_d += "### Testkit\n";
p_d += "Mock gateway must return GatewayPaymentResult with outcome and references so consumers testing\n";
p_d += "against mock learn the Phase 6 shape. Prefer import helpers from core.\n";
p_d += "Update mock-gateway tests. Keep bun test packages/testkit green.\n\n";

p_d += "### Docs (must exist before gate)\n";
p_d += "1) packages/core/docs/operation-results.md — full Phase 6 guide:\n";
p_d += "   - PaymentOperationResult arms with examples\n";
p_d += "   - Why success:boolean is ambiguous and deprecated for payment-state decisions\n";
p_d += "   - isPaidOutcome / mapGatewayResultToOperationResult\n";
p_d += "   - indeterminate + reconciliationRequired (engineering rule 3)\n";
p_d += "   - CommonPaymentInput vs provider extensions\n";
p_d += "   - Domain status unions vs legacy PaymentStatus\n";
p_d += "   - ProviderReferences fields\n";
p_d += "   - Migration checklist for 0.x apps\n";
p_d += "2) Cross-link from packages/core/README.md, docs/custom-gateways.md, docs/behavioral-contracts.md if present\n";
p_d += "3) packages/core/CHANGELOG.md Unreleased: Phase 6 outcomes, CommonPaymentInput, domain statuses, refs\n";
p_d += "4) packages/testkit/README.md note about mock outcomes\n\n";

p_d += "### Baselines\n";
p_d += "Public API additive exports expected. Regenerate if standard:\n";
p_d += "  bun run baseline:api\n";
p_d += "Read packages/core/docs/baseline/README.md first.\n";
p_d += "Update public-api.test.ts freeze list for new exports.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:6-gateway-outcomes", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:6-acceptance-tests", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "impl:6-testkit-docs", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 6 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 7+.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) CommonPaymentInput exists and excludes provider-specific fields (type-tested).\n";
p_int += "2) PaymentOperationResult discriminated union with all 5 outcomes exists and is exported.\n";
p_int += "3) Helpers: mapGatewayResultToOperationResult, isPaidOutcome, isRequiresActionOutcome,\n";
p_int += "   isIndeterminateOutcome, buildProviderReferences (names may vary slightly but must exist).\n";
p_int += "4) GatewayPaymentResult has outcome?, references?, success still present (deprecated dual-write).\n";
p_int += "5) All 4 gateways set outcome + references on primary payment operations.\n";
p_int += "6) Domain status unions exist for payments, authorizations, captures, refunds, setup, disputes,\n";
p_int += "   transfers, payouts; legacy PaymentStatus preserved for 0.x.\n";
p_int += "7) pending/requires_action cannot be mistaken for paid (helpers + tests).\n";
p_int += "8) indeterminate is explicit with reconciliationRequired:true.\n";
p_int += "9) Hooks cannot flip outcome/references to fake paid (freeze list updated).\n";
p_int += "10) Testkit mock returns outcome + references; tests green.\n";
p_int += "11) docs/operation-results.md + CHANGELOG + public API exports + freeze tests.\n";
p_int += "12) Phase 0-5 safety: money model intact, typecheck, tests core+testkit, build, boundaries, pack path.\n";
p_int += "13) Coverage thresholds for core still met.\n";
p_int += "14) No secret leakage; no Phase 7 webhook rewrite; no new packages.\n";
p_int += "15) Logical bugs to eliminate: mapping 3DS to succeeded; mapping timeout to failed without\n";
p_int += "    indeterminate; success:true interpreted as paid in helpers; CommonPaymentInput polluted;\n";
p_int += "    dropping legacy gatewayId fields; breaking after-hook freeze; float money reintroduction.\n";
p_int += "16) exactOptionalPropertyTypes careful with optional outcome/references.\n";
p_int += "17) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run validate:package  (if time; at least pack:check + typecheck)\n";
p_int += "18) If Stream A failed, implement types fully yourself. Phase 6 cannot ship without them.\n";
p_int += "19) Regenerate API baseline if standard after additive exports.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase6",
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
p_ver += "Verify Phase 6 completion in " + root + " with hard evidence from commands and file reads.\n";
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
p_ver += "10) Evidence CommonPaymentInput exported and type-tested without provider fields\n";
p_ver += "11) Evidence PaymentOperationResult with 5 outcomes (read types)\n";
p_ver += "12) Evidence isPaidOutcome false for requires_action/pending (tests)\n";
p_ver += "13) Evidence indeterminate + reconciliationRequired (types + tests + gateway path if any)\n";
p_ver += "14) Evidence domain status unions exist (grep PaymentDomainStatus AuthorizationStatus etc)\n";
p_ver += "15) Evidence ProviderReferences + gateway references population (grep)\n";
p_ver += "16) Evidence all 4 gateways set outcome (grep outcome: in gateways)\n";
p_ver += "17) Evidence success still present for 0.x (GatewayPaymentResult)\n";
p_ver += "18) Evidence docs/operation-results.md exists\n";
p_ver += "19) Evidence hooks freeze outcome/references if after-hooks exist\n";
p_ver += "20) Evidence Phase 5 money still green (money tests pass)\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- common_input_ok: CommonPaymentInput split + no provider pollution\n";
p_ver += "- outcome_union_ok: PaymentOperationResult + helpers + gateway outcome fields\n";
p_ver += "- domain_statuses_ok: separate status unions + legacy PaymentStatus kept\n";
p_ver += "- provider_refs_ok: ProviderReferences type + population\n";
p_ver += "- no_paid_confusion_ok: requires_action/pending not treated as paid\n";
p_ver += "- indeterminate_explicit_ok: explicit indeterminate outcome\n";
p_ver += "- provider_fields_isolated_ok: common input isolation\n";
p_ver += "- compat_ok: success dual-write / 0.x tests still pass\n";
p_ver += "Set ok=true only if typecheck, tests (core+testkit), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase6",
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
    write_scratch_file("phase6-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 6 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 6 — each PASS or BLOCKING:\n";
p_gate += "A1) pending or requires-action results cannot be mistaken for paid results.\n";
p_gate += "    Evidence: isPaidOutcome / mapGatewayResultToOperationResult tests; gateway requires_action\n";
p_gate += "    paths set outcome requires_action not succeeded; type discrimination.\n";
p_gate += "A2) indeterminate outcomes are explicit.\n";
p_gate += "    Evidence: PaymentOperationResult indeterminate arm with reconciliationRequired:true;\n";
p_gate += "    helpers; gateway or helper tests; never only success:false without outcome.\n";
p_gate += "A3) provider-specific fields do not pollute common inputs.\n";
p_gate += "    Evidence: CommonPaymentInput type + type tests excluding stripe/moyasar/paymob/paypal fields.\n\n";
p_gate += "Also require Phase 6 tasks 6.1-6.4 deliverables:\n";
p_gate += "- 6.1 CommonPaymentInput + provider typed extensions path\n";
p_gate += "- 6.2 PaymentOperationResult replaces success-as-paid semantics; success deprecated dual-write\n";
p_gate += "- 6.3 Separate domain status unions (payment, auth, capture, refund, setup, dispute, transfer, payout)\n";
p_gate += "- 6.4 ProviderReferences standardized fields\n";
p_gate += "- Phase 0-5 safety net still green (including money); boundaries; no core→testkit dep\n";
p_gate += "- No logical bugs: 3DS as paid; timeout as definitive failed; CommonPaymentInput pollution;\n";
p_gate += "  after-hooks forging outcome; missing references on gateway results.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit; bun run typecheck; check:boundaries.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-6-gate-report.md\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase6-adversarial",
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
    write_scratch_file("phase6-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 6 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 6 only — no Phase 7 webhooks, no new providers.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete CommonPaymentInput, PaymentOperationResult, domain statuses, ProviderReferences,\n";
    p_fix += "gateway outcome dual-write, helpers, tests, docs, hooks freeze as needed.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase6-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 6 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit, coverage, build, boundaries.\n";
    p_re += "Confirm all 6.1-6.4 deliverables and acceptance criteria with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase6-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase6-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 6 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/core/docs/baseline/phase-6-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 6.1-6.4 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase6-final",
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
        write_scratch_file("phase6-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 6 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 6,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
