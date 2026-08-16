let meta = #{
    name: "paykernel-leftover-audit-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every 2026-08-16 leftover (round-3) finding",
    phases: [
        #{ title: "Critic", detail: "reconfirm every leftover-audit ID against current code" },
        #{ title: "Fix", detail: "parallel non-overlapping streams for residual findings" },
        #{ title: "Integrate", detail: "typecheck, tests, cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + money-fence invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After leftover-audit-2026-08-16 SHIP_BLOCKED; fix every residual NEW-* ID",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "invariants_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "invariants_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
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

let report_schema = #{
    "type": "object",
    "required": ["ok", "report_path", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "report_path": #{ "type": "string" },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

let audit_doc = root + "/docs/audits/leftover-audit-2026-08-16.md";

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: reconfirming leftover-audit findings in " + root);

let p_critic = "";
p_critic += "Recheck findings from " + audit_doc + " against CURRENT source at " + root + ".\n";
p_critic += "READ-ONLY. Use read_file and grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n";
p_critic += "Do not edit files. Do not commit. Do not trust the audit doc alone — re-read the cited functions.\n\n";
p_critic += "MUST CHECK BLOCKING:\n";
p_critic += "NEW-STRIPE-3: stripeRequest HTTP 200 empty/non-JSON returned as T; create maps missing status to failed; refund maps to pending; fromStripeAmount(undefined)=0\n";
p_critic += "NEW-STRIPE-CKO-200: createCheckoutSession/getCheckoutSession hardcode success:true without id/url assert\n";
p_critic += "NEW-CORE-1: mapHttpAbortError caller abort is PaymentAbortedError; tryIndeterminateFromNetworkError only NetworkError.afterProviderSubmit\n";
p_critic += "NEW-PAYPAL-1: createMalformedResponseError is PayPalApiError status 0, not indeterminate\n";
p_critic += "NEW-PAYMOB-2: throwPaymobApiError unknownOnServerError only status>=500; 429 after POST deletes fence\n";
p_critic += "NEW-MOYASAR-1: createPayment 200 {} maps missing status to failed, no id required\n\n";
p_critic += "MUST CHECK OTHER P1:\n";
p_critic += "NEW-CORE-2 rematch keeps nested payment.status paid; NEW-CORE-3 rematch misses pending/failed/cancelled/reversed;\n";
p_critic += "NEW-CORE-4 Paymob is_capture+partially_captured -> capture.completed; NEW-CORE-5 refund apply no coerce;\n";
p_critic += "NEW-WEBHOOKS-1 processRetryable parallel claim then serial handlers; NEW-RECON-2 processDue same;\n";
p_critic += "NEW-RECON-1 in-flight capturedAmount=0 vs local.amount is drift; NEW-PAYMOB-TTL completed expires/evicts;\n";
p_critic += "NEW-STRIPE-1 getPayment ignores charges.data[0]; NEW-STRIPE-2 id-only charge is observed snapshot;\n";
p_critic += "NEW-PAYMOB-REFUND-0 success+refunded_amount_cents:0 is completed.\n\n";
p_critic += "Note P2 if still present: NEW-PAYMOB-VOID-P NEW-PAYMOB-FP NEW-MOYASAR-2/3 NEW-WEBHOOKS-2 NEW-STORE-1\n";
p_critic += "NEW-CORE-6/7 NEW-MONEY-1/2 NEW-TESTKIT-1/2/3/4/5 NEW-OBS-1 NEW-PAYPAL-2.\n";
p_critic += "Do NOT re-open closed first/session-pass IDs unless the original lie is still in source.\n";
p_critic += "Return confirmed[], already_fixed[], summary. Each confirmed entry is ID — one-line evidence.\n";

let critic = agent(p_critic, #{
    label: "critic:reconfirm",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
if critic != () && critic.success && critic.output != () && critic.output.summary != () {
    log("Critic: " + critic.output.summary);
}

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Fixing leftover-audit findings in parallel streams");

let common = "";
common += "Repo root: " + root + "\n";
common += "Audit source of truth: " + audit_doc + " — read YOUR IDs before editing.\n";
common += "Package: PayKernel monorepo (Bun + TypeScript). Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; add/flip unit tests that lock the lie;\n";
common += "re-read changed regions; prefer existing PaymentStatus values (partially_captured, partially_refunded,\n";
common += "refund_pending, refund_failed, refund_completed, setup_completed, paid, pending, processing, authorized);\n";
common += "fail-closed on incomplete money; never convert uncertain mutation outcomes into a retryable failure that clears a fence;\n";
common += "ALWAYS publish currency together with major-unit amount fields;\n";
common += "Run bun test on touched test files when possible. Skip items critic proves already fixed.\n";
common += "OWN FILES ONLY — do not edit other streams' files.\n";
common += "Return JSON {ok, files_changed, summary, notes, fixed_ids}.\n";

// A — Stripe
let p_a = "";
p_a += common;
p_a += "STREAM A — STRIPE. OWN:\n";
p_a += "- " + root + "/packages/core/src/gateways/stripe/**\n";
p_a += "- " + root + "/packages/core/docs/stripe.md\n";
p_a += "Do NOT edit abort.ts (stream G). Do NOT edit client.ts (stream E).\n";
p_a += "FIX:\n";
p_a += "NEW-STRIPE-3: After response.ok in stripeRequestOnce, if body is empty or JSON.parse failed,\n";
p_a += "  throw NetworkError with afterProviderSubmit:true for mutating methods (POST/PUT/DELETE/PATCH).\n";
p_a += "  Do NOT return {} or {error:{message}} as a PaymentIntent/Refund. Require mutation identity:\n";
p_a += "  create/capture/void need string id; refunds need string id + status. Missing identity after 200\n";
p_a += "  is indeterminate (NetworkError afterProviderSubmit), not failed/pending.\n";
p_a += "  fromStripeAmount(undefined) must not be used on create to invent major 0 — omit amount when\n";
p_a += "  amountMinor is undefined (capture/void already omit).\n";
p_a += "  Evidence: stripe.gateway.ts ~2778-2820, ~799-809, ~1540-1554, ~419-425.\n";
p_a += "NEW-STRIPE-CKO-200: createCheckoutSession and getCheckoutSession must NOT hardcode success:true.\n";
p_a += "  Require session.id (string non-empty). Missing id after 200 is indeterminate/throw, never success:true.\n";
p_a += "  Evidence: ~1970-1981, ~2111-2116.\n";
p_a += "NEW-STRIPE-1: getPayment refund math must reuse stripeSucceededIntentRefundStatus /\n";
p_a += "  stripeChargeSnapshotForRefundStatus (charges.data[0] when latest_charge omitted; refunded:true).\n";
p_a += "  Evidence: getPayment ~1867-1896 vs helper ~877-925.\n";
p_a += "NEW-STRIPE-2: A charge object is unobservable unless refunded===true or amount_refunded is a finite number\n";
p_a += "  (including 0). Id-only {id:'ch_…'} must fail-close to processing on webhook/hydrate paths, same as string id.\n";
p_a += "  Evidence: ~881-882, ~911-912, ~1011-1036, ~2986-3010.\n";
p_a += "Add tests: empty 200 on create/refund/checkout is not failed/pending/success:true;\n";
p_a += "  getPayment omitted latest_charge + charges.data[0].amount_refunded is not paid;\n";
p_a += "  PI.succeeded with latest_charge {id only} is processing not paid.\n";

// B — PayPal
let p_b = "";
p_b += common;
p_b += "STREAM B — PAYPAL. OWN:\n";
p_b += "- " + root + "/packages/core/src/gateways/paypal/**\n";
p_b += "- " + root + "/packages/core/docs/paypal.md\n";
p_b += "Do NOT edit abort.ts (stream G). Do NOT edit webhook-event-map.ts (stream G).\n";
p_b += "FIX:\n";
p_b += "NEW-PAYPAL-1: createMalformedResponseError after a mutating POST (create/capture/refund/void/authorize)\n";
p_b += "  must become indeterminate, not PayPalApiError status 0. Prefer NetworkError({ afterProviderSubmit: true })\n";
p_b += "  so executeWithHooks / tryIndeterminateFromNetworkError returns reconciliationRequired.\n";
p_b += "  Keep asserting id/status. Flip tests that lock rejects.toThrow(GatewayApiError) on 200 missing id\n";
p_b += "  to outcome==='indeterminate' (or NetworkError afterProviderSubmit).\n";
p_b += "  Evidence: paypal.gateway.ts ~1800-1805, ~2250-2284; tests ~2557-2571, ~3696-3705.\n";
p_b += "NEW-PAYPAL-2: paypal.md must say partially_captured is outcome requires_action (code ~1624-1634), not succeeded.\n";
p_b += "Add tests: create/refund HTTP 200 missing id is indeterminate, not a clean API throw.\n";

// C — Paymob
let p_c = "";
p_c += common;
p_c += "STREAM C — PAYMOB. OWN:\n";
p_c += "- " + root + "/packages/core/src/gateways/paymob/**\n";
p_c += "- " + root + "/packages/core/docs/paymob.md\n";
p_c += "Do NOT edit webhook-event-map.ts (stream G owns NEW-CORE-4). Do NOT edit abort.ts.\n";
p_c += "FIX:\n";
p_c += "NEW-PAYMOB-2: After a mutating POST (Intention/Orders/PaymentKey/capture/refund/void), HTTP 429 must\n";
p_c += "  keep the fence. throwPaymobApiError with unknownOnServerError should treat 429 as\n";
p_c += "  PaymobIndeterminateGatewayError (Moyasar isMoyasarDefiniteMutationFailure excludes 429).\n";
p_c += "  mapError RateLimitError after mutation must not cause executeIdempotent to delete the key.\n";
p_c += "  Evidence: ~805-813, ~2710-2725, ~3014-3041; mapError ~1131-1132.\n";
p_c += "NEW-PAYMOB-REFUND-0: refund mutation success + missing/<=0 refunded_amount_cents must not be\n";
p_c += "  completed + totalRefunded:0. Use pending / omit total (Moyasar/Stripe incomplete-refund pattern).\n";
p_c += "  Only completed+succeeded when refunded_amount_cents>0 or inquiry proves positive cumulative.\n";
p_c += "  Evidence: ~1038-1088.\n";
p_c += "NEW-PAYMOB-TTL: Completed fences must NOT expire as a free key. isStoredIdempotencyReplayExpired\n";
p_c += "  should be false for completed (or never delete+re-reserve completed). In-memory prune/evict must\n";
p_c += "  not drop completed mutation fences if that allows same-key re-apply — refuse new keys when full\n";
p_c += "  rather than evicting completed refund/capture/void fences. Paymob has no native idempotency.\n";
p_c += "  Evidence: ~111, ~3010, ~3058-3061, ~3106-3108, ~3195-3205.\n";
p_c += "NEW-PAYMOB-VOID-P: void must honor pending===true like capture/refund (pending/requires_action, not cancelled).\n";
p_c += "  Evidence: ~944-953 vs ~835-841 / ~1039-1043.\n";
p_c += "NEW-PAYMOB-FP: fingerprintParams should use shared core fingerprintParams (Date tag) not JSON.stringify.\n";
p_c += "  Evidence: ~3208-3247 vs packages/core/src/utils/idempotency.ts fingerprintParams.\n";
p_c += "Add tests: 429 after refund POST keeps fence; refund 200 success+refunded 0 is not completed;\n";
p_c += "  expired completed does not re-enter mutation; void pending is not cancelled.\n";

// D — Moyasar
let p_d = "";
p_d += common;
p_d += "STREAM D — MOYASAR. OWN:\n";
p_d += "- " + root + "/packages/core/src/gateways/moyasar/**\n";
p_d += "- " + root + "/packages/core/docs/moyasar.md\n";
p_d += "Do NOT edit abort.ts (stream G). Do NOT edit client.ts (stream E).\n";
p_d += "FIX:\n";
p_d += "NEW-MOYASAR-1: createPayment HTTP 200 must require a non-empty payment.id. Empty {} / missing id\n";
p_d += "  must throw an indeterminate-class error (GatewayApiError with 2xx is already kept as unknown for\n";
p_d += "  mutations — create is not runIdempotentMutation, so throw NetworkError afterProviderSubmit or a\n";
p_d += "  dedicated indeterminate so callers reconcile via given_id/getPayment instead of treating failed).\n";
p_d += "  mapPaymentResponse must not map missing status to failed on a 200 with no id.\n";
p_d += "  Evidence: ~546-559, ~1295-1381, ~1706-1711.\n";
p_d += "NEW-MOYASAR-2: card_auth_* after verify must NOT throw InvalidWebhookError. Parse as provider.unmapped\n";
p_d += "  (or a setup type). handleWebhook remaps InvalidWebhookError to retryable — authentic card-auth\n";
p_d += "  would redeliver forever. Evidence: ~1139-1145.\n";
p_d += "NEW-MOYASAR-3: confirmStcPayOtp is a mutation POST. Fence with runIdempotentMutation or treat\n";
p_d += "  post-submit transport errors as unknown. Evidence: ~1008-1053.\n";
p_d += "Add tests: create 200 {} is not declined failed; card_auth_ parse is unmapped not InvalidWebhookError;\n";
p_d += "  OTP confirm without store/key throws or is fenced.\n";

// E — Webhooks + client rematch
let p_e = "";
p_e += common;
p_e += "STREAM E — WEBHOOKS engine + client handleWebhook rematch. OWN:\n";
p_e += "- " + root + "/packages/webhooks/src/**\n";
p_e += "- " + root + "/packages/webhooks/docs/**\n";
p_e += "- " + root + "/packages/webhooks/README.md\n";
p_e += "- " + root + "/packages/core/src/client.ts\n";
p_e += "- " + root + "/packages/core/docs/webhooks.md\n";
p_e += "Do NOT edit webhook-event-map.ts (stream G). Do NOT edit paymob.gateway.ts (stream C).\n";
p_e += "FIX:\n";
p_e += "NEW-CORE-2: rematchSucceededWebhookDualWriteAgainstDomainStatus must rebuild payment via\n";
p_e += "  paymentFromWebhookEvent (or overwrite payment.status from envelope status) so nested\n";
p_e += "  event.payment.status cannot stay paid when envelope is processing/partial/authorized/refunded.\n";
p_e += "  Evidence: client.ts ~158-191.\n";
p_e += "NEW-CORE-3: rematch must also cover pending/failed/cancelled/reversed (align coerceStableSucceededToDomainStatus).\n";
p_e += "  pending -> payment.processing; failed -> payment.failed; cancelled/reversed -> payment.cancelled or processing.\n";
p_e += "  Evidence: client.ts ~166-177 vs webhook-event-map.ts ~594-616.\n";
p_e += "NEW-WEBHOOKS-1: processRetryable (and processDue-style paths in this package) must NOT hold N unexpired\n";
p_e += "  leases across serial handler I/O. Claim one-at-a-time (or claim next only after previous handler returns),\n";
p_e += "  OR renew remaining claimed leases before each handler. Defaults limit=10 leaseMs=30s are unsafe if\n";
p_e += "  handlers average >=3s. Evidence: engine.ts ~1395-1465.\n";
p_e += "NEW-WEBHOOKS-2: document that processed Paymob TRANSACTION inbox key is obj.id (child refunds have new ids).\n";
p_e += "  If cheap in event-key/docs: recommend not completing on payment.processing for Paymob. Do not change\n";
p_e += "  paymob.gateway.ts event.id here (stream C). Prefer docs + engine comment unless you own event-key only.\n";
p_e += "Add tests: rematch payment.succeeded + processing overwrites nested payment.status;\n";
p_e += "  rematch payment.succeeded + failed is not type-only succeeded;\n";
p_e += "  processRetryable does not claim the whole list before the first handler (or renews).\n";

// F — Stores
let p_f = "";
p_f += common;
p_f += "STREAM F — STORES (Redis ghost members). OWN:\n";
p_f += "- " + root + "/packages/store-redis/src/**\n";
p_f += "- " + root + "/packages/store-redis/docs/**\n";
p_f += "Do NOT edit sql-foundation / postgres / sqlite / d1 / turso / do unless a one-line comment is required.\n";
p_f += "FIX:\n";
p_f += "NEW-STORE-1: listDue/listRetryable ZRANGE + GET missing must ZREM the ghost member so LIMIT windows\n";
p_f += "  cannot fill with dead keys. Apply webhook-inbox and reconciliation Redis stores.\n";
p_f += "  Evidence: store-redis webhook-inbox-store.ts ~242-274; reconciliation-store.ts list path; shared loadListedRecords.\n";
p_f += "Add a unit/test comment or mock-eval test that missing GET drops the member.\n";

// G — Core abort + apply + map
let p_g = "";
p_g += common;
p_g += "STREAM G — CORE runtime abort + operation-result + webhook-event-map + hooks freeze. OWN:\n";
p_g += "- " + root + "/packages/core/src/runtime/abort.ts\n";
p_g += "- " + root + "/packages/core/src/runtime/abort.test.ts if present\n";
p_g += "- " + root + "/packages/core/src/gateways/base.gateway.ts only if needed to accept abort-as-indeterminate\n";
p_g += "- " + root + "/packages/core/src/types/operation-result.ts\n";
p_g += "- " + root + "/packages/core/src/types/operation-result.test.ts\n";
p_g += "- " + root + "/packages/core/src/types/webhook-event-map.ts\n";
p_g += "- " + root + "/packages/core/src/types/payment-event.ts (NEW-MONEY-2 redaction keys only)\n";
p_g += "- " + root + "/packages/core/src/hooks/money-identity.ts\n";
p_g += "- " + root + "/packages/core/docs/operation-results.md if needed\n";
p_g += "Do NOT edit client.ts (stream E). Do NOT edit stripe/paypal/paymob/moyasar gateways.\n";
p_g += "FIX:\n";
p_g += "NEW-CORE-1: mapHttpAbortError — if options.afterProviderSubmit===true, return NetworkError with\n";
p_g += "  afterProviderSubmit:true even when the caller signal aborted (do not use PaymentAbortedError after submit).\n";
p_g += "  Timeout path already uses NetworkError. Evidence: abort.ts ~217-234; base.gateway.ts ~415-423.\n";
p_g += "  Stripe/PayPal/Moyasar already pass afterProviderSubmit on mutating fetch; this one change covers them.\n";
p_g += "NEW-CORE-4: mapPaymobCaptureSettle / mapPaymobFromFlags must not emit capture.completed when status is\n";
p_g += "  partially_captured or isPartialCaptureAmounts. Use payment.processing. Evidence: webhook-event-map.ts ~402-443.\n";
p_g += "NEW-CORE-5: applyOutcomeToGatewayRefundResult must coerce via coerceRefundOutcomeToGatewayStatus and\n";
p_g += "  derive success from the stored outcome (payment apply parity). Evidence: operation-result.ts ~881-916.\n";
p_g += "NEW-CORE-6: coercePaymentOutcomeToGatewayStatus — declined/failed must not persist on paid-like status\n";
p_g += "  (or refuse/demote). Evidence: ~408-452.\n";
p_g += "NEW-CORE-7: add refundedAt to MONEY_IDENTITY_KEYS; clone Dates in shallowCloneResult.\n";
p_g += "  Evidence: hooks/money-identity.ts ~17-46, ~185-198.\n";
p_g += "NEW-MONEY-1: applyOutcomeToGatewayResult / paymentFromGatewayResult copy amount-like fields only when\n";
p_g += "  currency is non-empty AND Number.isFinite. Evidence: operation-result.ts ~249-259, ~672-679.\n";
p_g += "NEW-MONEY-2: WEBHOOK_PAYLOAD_SECRET_KEYS (or hash/encrypt redact list) must include number/cvc/cvv/pan/card\n";
p_g += "  (logger already scrubs these). Evidence: payment-event.ts ~361-384.\n";
p_g += "Add tests for abort-after-submit -> NetworkError afterProviderSubmit; refund apply coerce;\n";
p_g += "  Paymob is_capture+partial -> payment.processing; non-finite amount omitted.\n";

// H — Recon
let p_h = "";
p_h += common;
p_h += "STREAM H — RECONCILIATION compare + scheduler. OWN:\n";
p_h += "- " + root + "/packages/reconciliation/src/**\n";
p_h += "- " + root + "/packages/reconciliation/docs/**\n";
p_h += "Do NOT edit store-* (stream F). Do NOT edit webhooks engine (stream E).\n";
p_h += "FIX:\n";
p_h += "NEW-RECON-1: pending/processing + capturedAmount=0 vs local.amount must NOT be capturedAmount drift.\n";
p_h += "  Treat like auth-hold (consistent) OR route to retry_later even if compare reports inequality.\n";
p_h += "  Evidence: compare.ts ~95-106, ~178-205; policy.ts ~454-593.\n";
p_h += "NEW-RECON-2: processDue must not hold N unexpired leases across serial handlers. Claim one-at-a-time\n";
p_h += "  (or renew remaining before each handler). Same class as NEW-WEBHOOKS-1. Evidence: scheduler.ts ~181-207, ~446-558.\n";
p_h += "Add tests: processing + capturedAmount 0 vs amount is not apply_drift_review;\n";
p_h += "  processDue does not bulk-claim the whole list before the first handler (or renews).\n";

// I — Testkit + obs
let p_i = "";
p_i += common;
p_i += "STREAM I — TESTKIT + OBSERVABILITY. OWN:\n";
p_i += "- " + root + "/packages/testkit/src/**\n";
p_i += "- " + root + "/packages/observability/src/**\n";
p_i += "FIX:\n";
p_i += "NEW-TESTKIT-1: createPaymentFingerprint must include orderId and provider PM/source ids (stripePaymentMethodId,\n";
p_i += "  moyasarSource/tokenId). Different identity + same key -> fingerprint_conflict. Evidence: mock-gateway.ts ~507-521.\n";
p_i += "NEW-TESTKIT-2: remaining capturable hold after partial refund must stay capturable while captured < amount.\n";
p_i += "  Evidence: ~138-141, ~1610-1616.\n";
p_i += "NEW-TESTKIT-3: getPayment must not rewrite ledger to paid on outcome succeeded. Return ledger snapshot.\n";
p_i += "  Evidence: ~561-571, ~964-968, ~1725-1754.\n";
p_i += "NEW-TESTKIT-4: capture:false without capabilities.authorization -> OperationNotSupportedError, not paid.\n";
p_i += "  Evidence: ~1256-1258.\n";
p_i += "NEW-TESTKIT-5: fixture-safety SECRET_PATTERNS must include cs_live_/cs_test_/csk_/pi_…_secret_.\n";
p_i += "NEW-OBS-1: sanitizeSpanStatusMessage must drop embedded PANs (13-19 digit runs), not only sk_/cs_ prefixes.\n";
p_i += "  Evidence: observability/src/redaction.ts ~41-48, ~157-169.\n";
p_i += "Add tests for each.\n";

// J — Docs
let p_j = "";
p_j += common;
p_j += "STREAM J — DOCS audit bookkeeping. OWN:\n";
p_j += "- " + root + "/docs/audits/** only\n";
p_j += "Write " + root + "/docs/audits/leftover-audit-fix-pass-2026-08-16.md with stream ownership and residual IDs.\n";
p_j += "List blocking: NEW-STRIPE-3, NEW-STRIPE-CKO-200, NEW-CORE-1, NEW-PAYPAL-1, NEW-PAYMOB-2, NEW-MOYASAR-1.\n";
p_j += "List other P1: NEW-CORE-2/3/4/5, NEW-WEBHOOKS-1, NEW-RECON-1/2, NEW-PAYMOB-TTL, NEW-STRIPE-1/2, NEW-PAYMOB-REFUND-0.\n";
p_j += "List P2 pack from " + audit_doc + ".\n";
p_j += "Do NOT edit packages/**.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:stripe", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:paypal", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:paymob", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:moyasar", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:stores", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:core", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:recon", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_i, label: "fix:testkit-obs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_j, label: "fix:docs-audit", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok_count = 0;
let impl_fail_count = 0;
let impl_i = 0;
if impl_results != () {
    while impl_i < impl_results.len() {
        let r = impl_results[impl_i];
        if r != () && r.success && r.output != () && r.output.ok == true {
            impl_ok_count += 1;
            if r.output.summary != () {
                log("OK implement: " + r.output.summary);
            }
        } else {
            impl_fail_count += 1;
            log("FAIL implement slot " + impl_i.to_string());
        }
        impl_i += 1;
    }
}
log("Implement done ok=" + impl_ok_count.to_string() + " fail=" + impl_fail_count.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "Integrate leftover-audit-fix-gate streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck across monorepo — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso until green (known sql-foundation bun:sqlite WAL flake may remain — isolate if needed).\n";
p_int += "4) Cross-check invariants from " + audit_doc + ":\n";
p_int += "   - NEW-STRIPE-3 / CKO-200: empty 200 is not success:true / failed create / pending refund\n";
p_int += "   - NEW-CORE-1: caller abort afterProviderSubmit is NetworkError afterProviderSubmit\n";
p_int += "   - NEW-PAYPAL-1: 200 missing id is indeterminate\n";
p_int += "   - NEW-PAYMOB-2: 429 after mutation keeps fence\n";
p_int += "   - NEW-MOYASAR-1: create 200 missing id is not failed/declined\n";
p_int += "5) Update " + root + "/docs/audits/leftover-audit-fix-pass-2026-08-16.md with what landed vs remaining.\n";
p_int += "6) Flip any remaining tests locking the leftover lies. Prefer fail-closed money/fences.\n";
p_int += "Return {ok, files_changed, summary, notes, fixed_ids}.\n";

let int_result = agent(p_int, #{
    label: "integrate:typecheck-test",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || (int_result.output != () && int_result.output.ok != true) {
    log("Integrate reported issues — verify will surface details");
} else if int_result.output != () && int_result.output.summary != () {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify leftover-audit fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso\n";
p_ver += "3) Invariant greps/reads (must hold):\n";
p_ver += "   - NEW-STRIPE-3: empty/non-JSON 200 on mutating stripeRequest is NetworkError afterProviderSubmit or throws before mapping\n";
p_ver += "   - NEW-STRIPE-CKO-200: createCheckoutSession does not hardcode success:true without id\n";
p_ver += "   - NEW-CORE-1: mapHttpAbortError + afterProviderSubmit returns NetworkError\n";
p_ver += "   - NEW-PAYPAL-1: malformed 200 after mutation is afterProviderSubmit / indeterminate\n";
p_ver += "   - NEW-PAYMOB-2: 429 after mutation is indeterminate or fence kept\n";
p_ver += "   - NEW-MOYASAR-1: create requires id on 200\n";
p_ver += "   - NEW-CORE-2/3 rematch nested status + failed/pending\n";
p_ver += "   - NEW-CORE-4 no capture.completed on partial\n";
p_ver += "   - NEW-WEBHOOKS-1 / NEW-RECON-2 no bulk-claim-then-serial without renew\n";
p_ver += "   - NEW-RECON-1 in-flight zero capture not drift\n";
p_ver += "   - NEW-STRIPE-1/2 getPayment + id-only charge\n";
p_ver += "   - NEW-PAYMOB-REFUND-0 / NEW-PAYMOB-TTL\n";
p_ver += "Return typecheck_ok, tests_ok, invariants_ok, failures[], commands_run[], summary, ok=all three true.\n";

let ver = agent(p_ver, #{
    label: "verify:typecheck-test-invariants",
    capability_mode: "all",
    output_schema: verify_schema,
});

let typecheck_ok = false;
let tests_ok = false;
let invariants_ok = false;
let ver_failures = [];
if ver != () && ver.success && ver.output != () {
    if ver.output.typecheck_ok == true { typecheck_ok = true; }
    if ver.output.tests_ok == true { tests_ok = true; }
    if ver.output.invariants_ok == true { invariants_ok = true; }
    if ver.output.failures != () {
        ver_failures = ver.output.failures;
    }
    if ver.output.summary != () {
        log("Verify: " + ver.output.summary);
    }
} else {
    log("Verify agent failed");
    ver_failures.push("verify agent failed or empty");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarially gate PayKernel leftover-audit-fix-gate in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken:\n";
p_gate += "NEW-STRIPE-3: HTTP 200 empty still mapped as PaymentIntent/Refund\n";
p_gate += "NEW-STRIPE-CKO-200: success:true without session id\n";
p_gate += "NEW-CORE-1: caller abort after POST still PaymentAbortedError (not afterProviderSubmit NetworkError)\n";
p_gate += "NEW-PAYPAL-1: 200 missing id still PayPalApiError status 0\n";
p_gate += "NEW-PAYMOB-2: 429 after POST still deletes fence\n";
p_gate += "NEW-MOYASAR-1: create 200 {} still failed/declined\n";
p_gate += "Also list as blocking if still money lies: NEW-CORE-2/3/4/5, NEW-WEBHOOKS-1, NEW-RECON-1/2,\n";
p_gate += "NEW-PAYMOB-TTL, NEW-STRIPE-1/2, NEW-PAYMOB-REFUND-0.\n";
p_gate += "P0: typecheck or tests red (ignore known sql-foundation WAL flake if isolated).\n";
p_gate += "Non-blocking residual PERF-* / NEW-WEBHOOKS-2 docs / NEW-PAYPAL-2 docs allowed if documented.\n";
p_gate += "Return pass (true only if no blocking), blocking[], non_blocking[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:adversarial",
    capability_mode: "all",
    output_schema: gate_schema,
});

let gate_pass = false;
let blocking = [];
let non_blocking = [];
let gate_summary = "gate incomplete";
if gate != () && gate.success && gate.output != () {
    if gate.output.pass == true { gate_pass = true; }
    if gate.output.blocking != () { blocking = gate.output.blocking; }
    if gate.output.non_blocking != () { non_blocking = gate.output.non_blocking; }
    if gate.output.summary != () { gate_summary = gate.output.summary; }
    log("Gate: pass=" + gate_pass.to_string() + " " + gate_summary);
} else {
    blocking.push("gate agent failed");
    log("Gate agent failed");
}

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");
if (blocking != () && blocking.len() > 0) || typecheck_ok != true || tests_ok != true || invariants_ok != true {
    log("Remediating blocking issues");
    let p_fix = "";
    p_fix += "Fix remaining BLOCKING leftover-audit issues in " + root + ".\n";
    p_fix += "typecheck_ok=" + typecheck_ok.to_string() + " tests_ok=" + tests_ok.to_string() + " invariants_ok=" + invariants_ok.to_string() + "\n";
    if blocking != () {
        let bi = 0;
        while bi < blocking.len() {
            p_fix += "- blocking: " + blocking[bi] + "\n";
            bi += 1;
        }
    }
    if ver_failures != () {
        let fi = 0;
        while fi < ver_failures.len() {
            p_fix += "- verify failure: " + ver_failures[fi] + "\n";
            fi += 1;
        }
    }
    p_fix += "Priority: NEW-STRIPE-3/CKO-200, NEW-CORE-1, NEW-PAYPAL-1, NEW-PAYMOB-2, NEW-MOYASAR-1,\n";
    p_fix += "then NEW-CORE-2/3/4/5, NEW-WEBHOOKS-1, NEW-RECON-1/2, NEW-PAYMOB-TTL, NEW-STRIPE-1/2,\n";
    p_fix += "NEW-PAYMOB-REFUND-0, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck && bun test (core+webhooks+recon+routing+testkit+observability+stores).\n";
    p_ver2 += "Re-check blocking invariants from " + audit_doc + " (NEW-STRIPE-3/CKO-200, NEW-CORE-1, NEW-PAYPAL-1, NEW-PAYMOB-2, NEW-MOYASAR-1).\n";
    p_ver2 += "Return typecheck_ok, tests_ok, invariants_ok, failures, commands_run, summary, ok.\n";
    let ver2 = agent(p_ver2, #{
        label: "verify:post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if ver2 != () && ver2.success && ver2.output != () {
        typecheck_ok = false;
        tests_ok = false;
        invariants_ok = false;
        if ver2.output.typecheck_ok == true { typecheck_ok = true; }
        if ver2.output.tests_ok == true { tests_ok = true; }
        if ver2.output.invariants_ok == true { invariants_ok = true; }
        if ver2.output.failures != () { ver_failures = ver2.output.failures; }
        if ver2.output.summary != () { log("Post-remediate verify: " + ver2.output.summary); }
    }

    let p_gate2 = "";
    p_gate2 += "Quick re-gate of " + root + " after remediation. Read code for remaining blocking IDs from " + audit_doc + ".\n";
    p_gate2 += "Return pass, blocking, non_blocking, summary.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = false;
        if gate2.output.pass == true { gate_pass = true; }
        if gate2.output.blocking != () { blocking = gate2.output.blocking; } else { blocking = []; }
        if gate2.output.non_blocking != () { non_blocking = gate2.output.non_blocking; }
        if gate2.output.summary != () { gate_summary = gate2.output.summary; }
    }
    if rem != () && rem.success && rem.output != () && rem.output.summary != () {
        log("Remediate: " + rem.output.summary);
    }
} else {
    log("No remediation needed");
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
let final_pass = gate_pass == true && typecheck_ok == true && tests_ok == true && invariants_ok == true;

let p_rep = "";
p_rep += "Write fix result report to " + root + "/docs/audits/leftover-audit-fix-result-2026-08-16.md\n";
p_rep += "Include: final_pass, typecheck_ok, tests_ok, invariants_ok, gate_pass, implement ok/fail counts,\n";
p_rep += "blocking list, non_blocking residual, summary of what was fixed vs remaining, pointer to " + audit_doc + ".\n";
p_rep += "final_pass=" + final_pass.to_string() + "\n";
p_rep += "typecheck_ok=" + typecheck_ok.to_string() + " tests_ok=" + tests_ok.to_string() + " invariants_ok=" + invariants_ok.to_string() + "\n";
p_rep += "gate_pass=" + gate_pass.to_string() + " gate_summary=" + gate_summary + "\n";
p_rep += "implement ok/fail=" + impl_ok_count.to_string() + "/" + impl_fail_count.to_string() + "\n";
p_rep += "blocking:\n";
if blocking != () {
    let bj = 0;
    while bj < blocking.len() {
        p_rep += "- " + blocking[bj] + "\n";
        bj += 1;
    }
}
p_rep += "non_blocking:\n";
if non_blocking != () {
    let nj = 0;
    while nj < non_blocking.len() {
        p_rep += "- " + non_blocking[nj] + "\n";
        nj += 1;
    }
}
p_rep += "Verify with greps that residual P1 code paths improved. Do not invent fixes not in tree.\n";
p_rep += "Return {ok, report_path, summary}.\n";

let report_agent = agent(p_rep, #{
    label: "report:write-result",
    capability_mode: "read-write",
    output_schema: report_schema,
});
if report_agent != () && report_agent.success && report_agent.output != () && report_agent.output.summary != () {
    let rp = "";
    if report_agent.output.report_path != () { rp = report_agent.output.report_path; }
    log("Report: " + rp + " — " + report_agent.output.summary);
}

log("paykernel-leftover-audit-fix-gate complete final_pass=" + final_pass.to_string());

complete(#{
    final_pass: final_pass,
    typecheck_ok: typecheck_ok,
    tests_ok: tests_ok,
    invariants_ok: invariants_ok,
    gate_pass: gate_pass,
    implement_ok: impl_ok_count,
    implement_fail: impl_fail_count,
    gate_summary: gate_summary,
});
