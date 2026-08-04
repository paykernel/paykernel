let meta = #{
    name: "fix-deep-audit-residual",
    description: "Fix residual deep-audit-package blockers (Paymob dual-write false-paid, recon listDue recovery, Redis recon fail fence, Redis webhook listRetryable) + high-value non-blocking with verify+adversarial gate",
    phases: [
        #{ title: "Recheck", detail: "confirm each residual blocker still present with file:line evidence" },
        #{ title: "Implement", detail: "parallel non-overlapping fix streams for R1–R9 + priority polish" },
        #{ title: "Integrate", detail: "cross-stream wiring, conformance tests, docs, report remediation" },
        #{ title: "Verify", detail: "typecheck + full tests + boundaries + portability + invariant greps" },
        #{ title: "Gate", detail: "adversarial re-check of every residual blocker" },
        #{ title: "Remediate", detail: "fix any remaining blocking gate items" },
    ],
    when_to_use: "After docs/deep-audit-package-report.md residual FAIL (Paymob dual-write + recon/webhook recovery); prior B1–B6/B8–B9 already fixed",
};

let recheck_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "boundaries_ok", "portability_ok", "invariants_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "portability_ok": #{ "type": "boolean" },
        "invariants_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "test_summary": #{ "type": "string" },
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
        "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
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

// ─── Recheck ─────────────────────────────────────────────────────
phase("Recheck");
log("Rechecking residual deep-audit findings in " + root);

let p_recheck = "";
p_recheck += "Recheck ALL residual blocking findings from " + root + "/docs/deep-audit-package-report.md.\n";
p_recheck += "Use read_file and grep ONLY. Do not edit.\n";
p_recheck += "For each item, STILL PRESENT or ALREADY FIXED with file:line evidence.\n\n";
p_recheck += "RESIDUAL BLOCKING CHECKLIST (current report SoT):\n";
p_recheck += "R1: Paymob amount-only refund dual-write: status=refunded but PaymentEvent.type/stableType=payment.succeeded\n";
p_recheck += "R2: Paymob mapPaymobFromFlags success short-circuit before status/amount-derived refunds\n";
p_recheck += "R3: Paymob mapTransactionStatus amount-aware vs mapPaymobFromFlags flag-only systematic dual-write skew\n";
p_recheck += "R4: Docs under-specify amount-only refund dual-write / stableType agreement\n";
p_recheck += "R5: SQL recon listDue (postgres/sqlite/turso/d1/DO) only status=scheduled; never soft-releases expired claimed\n";
p_recheck += "R6: Redis recon listDue ZSET-only after claim ZREM; expired claimed not re-queued without get\n";
p_recheck += "R7: Redis RECON_FAIL_LUA omits unexpired-lease fence (RECON_COMPLETE / WEBHOOK_FAIL / SQL have it)\n";
p_recheck += "R8: Redis webhook listRetryable ZSET-only; abandoned claimed not bulk soft-released (SQL does)\n";
p_recheck += "R9: Cross-adapter recon fail fencing split (SQL vs Redis vs memory) — pairs with R7\n\n";
p_recheck += "NON-BLOCKING (fix if low-cost in same streams):\n";
p_recheck += "N1: Paymob is_auth+captured under-maps to payment.authorized (same mapper rework as R1–R3)\n";
p_recheck += "N2: processRetryable default does not unwrap PersistedPaymentEventEnvelope.event\n";
p_recheck += "N3: SQL recon markManualReview weaker fence (no lease_expires_at>now)\n";
p_recheck += "N4: AbortError→not_submitted fallback docs / safer classification notes\n";
p_recheck += "N5: Postgres listRetryable comment claims Redis recovery parity (docs honesty)\n";
p_recheck += "N6: root README package table omits sql-foundation/store-contracts\n";
p_recheck += "N7: PayPal PAYMENT.REFUND.COMPLETED map vs parse honesty\n";
p_recheck += "N8: vestigial webhook status 'failed' docs/schema note\n";
p_recheck += "Return confirmed[], already_fixed[], summary.\n";

let recheck = agent(p_recheck, #{
    label: "recheck:residual-findings",
    capability_mode: "read-only",
    output_schema: recheck_schema,
});
let recheck_summary = "recheck incomplete";
if recheck != () && recheck.success && recheck.output != () {
    recheck_summary = recheck.output.summary;
    log("Recheck: " + recheck_summary);
    write_scratch_file("fix-residual-recheck.json", json_encode(recheck.output));
} else {
    log("Recheck agent failed — proceeding with full residual fix list");
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing residual deep-audit fixes in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Source of truth: " + root + "/docs/deep-audit-package-report.md\n";
common += "Recheck: " + recheck_summary + "\n";
common += "Rules: read BEFORE edit; minimal surgical diffs; do NOT commit; do NOT push; do NOT publish.\n";
common += "exactOptionalPropertyTypes ON. Keep 0.x backward compat where possible; changelog notes for behavior changes.\n";
common += "Add/update unit tests for every behavior change. Prefer existing patterns/errors/test style.\n";
common += "After edits re-read changed regions. Run focused bun test on touched packages when possible.\n";
common += "Skip items already fixed if recheck proved it. Return {ok, files_changed, summary, notes, fixed_ids}.\n\n";

// Stream A — Paymob dual-write + docs + auth/capture stableType
let p_a = "";
p_a += common;
p_a += "STREAM A — Paymob Phase 7 dual-write false-paid class (R1–R4, N1). OWN FILES ONLY:\n";
p_a += "- packages/core/src/types/webhook-event-map.ts (mapPaymobFromFlags)\n";
p_a += "- packages/core/src/gateways/paymob/** (map context, parseWebhookEvent dual-write, tests)\n";
p_a += "- packages/core/docs/paymob.md\n";
p_a += "- packages/core/docs/webhook-events.md (amount-only refund dual-write warning / stableType agreement)\n";
p_a += "- packages/core/docs/behavioral-contracts.md only if needed for dual-write wording\n";
p_a += "- packages/core/CHANGELOG.md Unreleased\n";
p_a += "Do NOT edit store adapters or webhooks engine.\n\n";
p_a += "ROOT CAUSE: mapPaymobFromFlags treats flags.success===true as payment.succeeded BEFORE consulting\n";
p_a += "status or amount-derived refunds. mapTransactionStatus correctly sets refunded/partially_refunded from\n";
p_a += "refunded_amount_cents alone. paymobMapContextFromTransaction returns {flags} only (no amounts).\n";
p_a += "Dual-write attaches PaymentEvent with flag-only map → status=refunded + stableType=payment.succeeded.\n\n";
p_a += "FIX R1–R3 — Prefer event.status / amount-derived signals over bare success:\n";
p_a += "1) In mapPaymobFromFlags: BEFORE success→payment.succeeded short-circuit, if context.status is\n";
p_a += "   refunded or partially_refunded (or amount refunds > 0 if amounts passed), map to refund.completed\n";
p_a += "   (or appropriate refund stable type already used elsewhere for refunds).\n";
p_a += "2) Preferred: pass amount/refund context from paymobMapContextFromTransaction / parseWebhookEvent so\n";
p_a += "   dual-write map agrees with mapTransactionStatus order (pending → void → refund amounts → capture → auth).\n";
p_a += "3) Align is_auth+captured: if status is partially_captured/paid OR captured amounts indicate capture,\n";
p_a += "   do NOT emit payment.authorized (N1). Prefer payment.succeeded / capture-appropriate stable type\n";
p_a += "   consistent with existing Phase 7 maps for paid/partially_captured.\n";
p_a += "4) Do NOT invent paid from uncertain outcomes. Fail-closed on unknown.\n\n";
p_a += "TESTS (mandatory):\n";
p_a += "- amount-only refunded_amount_cents without is_refund flag: WebhookEvent.status refunded/partially_refunded\n";
p_a += "  AND PaymentEvent.type AND stableType === refund.completed (or existing refund stable string).\n";
p_a += "- full refund of partial capture amount-only → not payment.succeeded.\n";
p_a += "- is_auth + captured_amount dual-write does not emit payment.authorized when status is paid/partially_captured.\n";
p_a += "- existing flag-based refund tests still pass.\n\n";
p_a += "FIX R4 — Document in paymob.md + webhook-events.md that amount-only refunds dual-write refund stable types,\n";
p_a += "not payment.succeeded. Add changelog entry under Unreleased.\n";

// Stream B — SQL recon listDue soft-release + markManualReview fence + docs
let p_b = "";
p_b += common;
p_b += "STREAM B — SQL recon listDue recovery (R5) + markManualReview fence (N3). OWN:\n";
p_b += "- packages/store-postgres/src/** recon stores + tests + docs\n";
p_b += "- packages/store-sqlite/src/** recon\n";
p_b += "- packages/store-turso/src/** recon\n";
p_b += "- packages/store-d1/src/** recon\n";
p_b += "- packages/store-durable-objects/src/** recon\n";
p_b += "- packages/sql-foundation/** if shared listDue helper/algorithm exists\n";
p_b += "- packages/testkit recon conformance if present (listDue-after-abandon)\n";
p_b += "- packages/reconciliation/docs/crash-boundaries.md if wording needs accuracy\n";
p_b += "Do NOT edit store-redis (stream C). Do NOT edit paymob (stream A).\n\n";
p_b += "FIX R5 — listDue must rediscover abandoned expired claims:\n";
p_b += "Match the webhook listRetryable B5 pattern already fixed on SQL:\n";
p_b += "Preferred: inside listDue, soft-release status=claimed AND lease_expires_at <= now → scheduled\n";
p_b += "(clear lease fields; keep attempts/payload), THEN SELECT scheduled due.\n";
p_b += "Apply to postgres, sqlite, turso, d1, DO reconciliation stores consistently.\n";
p_b += "Memory already soft-releases in listDue — match that behavior.\n";
p_b += "Key-addressed claim reclaim by known key remains; this is about POLL discovery.\n\n";
p_b += "TESTS (mandatory per adapter unit or shared pattern):\n";
p_b += "claim job → advance clock past lease → listDue MUST return the job key (without external get first).\n";
p_b += "If testkit has reconciliation-conformance, add listDue-after-abandon case for all adapters under conformance.\n\n";
p_b += "FIX N3 — markManualReview WHERE should require lease_expires_at > now (parity with complete/fail)\n";
p_b += "on SQL adapters that support it. Add unit test for expired lease → lease_lost.\n\n";
p_b += "Update crash-boundaries / adapter docs that claim poll recovery works after lease expiry.\n";

// Stream C — Redis recon listDue + RECON_FAIL fence + webhook listRetryable
let p_c = "";
p_c += common;
p_c += "STREAM C — Redis recovery + recon fail fencing (R6, R7, R8, R9). OWN:\n";
p_c += "- packages/store-redis/src/**\n";
p_c += "- packages/store-redis/docs/**\n";
p_c += "- packages/store-redis tests/integration\n";
p_c += "Do NOT edit SQL adapters (stream B) or paymob (stream A).\n\n";
p_c += "FIX R7/R9 — RECON_FAIL_LUA must require unexpired lease like RECON_COMPLETE_LUA and WEBHOOK_FAIL_LUA:\n";
p_c += "After status=claimed + token match, if exp <= nowMs return lease_lost (do not mutate).\n";
p_c += "nowMs is already parsed — use it for fencing. Add registry/integration test: claim, expire, fail → lease_lost.\n\n";
p_c += "FIX R6 — Redis recon listDue rediscovery:\n";
p_c += "RECON_CLAIM_LUA ZREMs due index; expired claimed are off-index; soft-release+ZADD only in RECON_GET.\n";
p_c += "listDue is ZRANGEBYSCORE only → claimDue/processDue starve after crash.\n";
p_c += "Preferred approaches (pick cleanest, document):\n";
p_c += "  A) listDue bulk soft-release path: SCAN/secondary expiry index of claimed keys, soft-release expired\n";
p_c += "     claimed→scheduled + ZADD due index, then ZRANGEBYSCORE; OR\n";
p_c += "  B) claim without ZREM until complete/fail (design change — more invasive);\n";
p_c += "  C) maintain a claimed-expiry ZSET parallel index updated on claim/complete/fail/renew.\n";
p_c += "Goal: after claim + lease expire, listDue returns the job WITHOUT a prior get on that key.\n";
p_c += "Test: claim → expire → listDue includes key.\n\n";
p_c += "FIX R8 — Redis webhook listRetryable abandoned-claim drain:\n";
p_c += "Same class as R6 for webhook inbox. SQL bulk soft-releases claimed+expired→pending in listRetryable.\n";
p_c += "Implement parity for Redis: bulk soft-release/re-index expired claimed into retry ZSET inside listRetryable\n";
p_c += "(or shared helper used by listRetryable). processRetryable must discover abandoned work after crash.\n";
p_c += "Test: claim webhook → expire lease → listRetryable includes key WITHOUT prior get.\n";
p_c += "Fix/remove inaccurate comments that claim Redis recovery matches SQL if they still claim false parity.\n";
p_c += "Update scripts-atomicity / crash-boundaries redis docs.\n";

// Stream D — Webhooks processRetryable envelope unwrap helper + docs
let p_d = "";
p_d += common;
p_d += "STREAM D — webhooks durable_retry integrator footgun (N2, N8). OWN:\n";
p_d += "- packages/webhooks/src/**\n";
p_d += "- packages/webhooks/docs/**\n";
p_d += "- packages/webhooks/README.md\n";
p_d += "- packages/core/docs/webhooks.md only if sample needs resolveEvent unwrap (optional)\n";
p_d += "Do NOT edit store adapters or paymob.\n\n";
p_d += "FIX N2 — processRetryable default materialization:\n";
p_d += "When payloadRef parses as PersistedPaymentEventEnvelope (schemaVersion+event+payloadHash),\n";
p_d += "default resolveEvent should unwrap .event so handlers receive PaymentEvent not the wrapper.\n";
p_d += "Keep override resolveEvent for custom stores. Backward compat: if parse is already a plain PaymentEvent\n";
p_d += "(no envelope shape), use as-is. Add unit tests for both shapes.\n";
p_d += "Document in webhook-inbox.md / README that recommended dual-write envelopes auto-unwrap on processRetryable.\n\n";
p_d += "FIX N8 — Document that WebhookInboxStatus 'failed' is unused by engine (pending|dead_letter only),\n";
p_d += "or remove from public docs if cheap without breaking types. Prefer docs honesty if type removal is BC-breaking.\n";

// Stream E — routing AbortError docs + root README + PayPal honesty + report
let p_e = "";
p_e += common;
p_e += "STREAM E — docs/polish + report remediation (N4, N5, N6, N7) + audit report append. OWN:\n";
p_e += "- packages/routing/src/** only if AbortError classification needs safer docs comment or optional flag\n";
p_e += "- packages/routing/docs/**\n";
p_e += "- packages/core/src/gateways/paypal/** only for PAYMENT.REFUND.COMPLETED map/parse honesty\n";
p_e += "- packages/core/docs/paypal.md if needed\n";
p_e += "- README.md (root package table)\n";
p_e += "- packages/store-postgres docs comments claiming Redis list recovery parity (N5)\n";
p_e += "- docs/deep-audit-package-report.md (append residual remediation section only; do not delete history)\n";
p_e += "- packages/*/CHANGELOG.md Unreleased for packages you touch\n";
p_e += "Do NOT rewrite recon listDue SQL/Redis logic (streams B/C) or Paymob dual-write (stream A).\n\n";
p_e += "FIX N4 — Document that AbortError→not_submitted + default-allow fallback is unsafe if abort can be post-accept;\n";
p_e += "recommend treating AbortError as indeterminate / manual_review or custom classifySubmissionState for multi-gateway.\n";
p_e += "Code change only if trivial and tested; docs minimum.\n\n";
p_e += "FIX N6 — Root README package table: include @paykernel/sql-foundation and @paykernel/store-contracts;\n";
p_e += "stop describing internal-sql-store as the publishable foundation if inaccurate.\n\n";
p_e += "FIX N7 — PayPal PAYMENT.REFUND.COMPLETED: either map+parse both support refund.completed, or remove from map\n";
p_e += "and document Unsupported honestly. Prefer implement parse path if low cost with tests.\n\n";
p_e += "FIX N5 — Correct store-postgres (and siblings) comments that claim Redis list recovery parity if still wrong\n";
p_e += "after stream C; if stream C fixed Redis, update comments to true parity language.\n\n";
p_e += "Append ## Remediation (post fix-deep-audit-residual) to docs/deep-audit-package-report.md\n";
p_e += "summarizing R1–R9 / N* status. Do not erase historical sections.\n";

// Stream F — recon scheduler/conformance if needed for listDue-after-abandon shared tests
let p_f = "";
p_f += common;
p_f += "STREAM F — reconciliation package tests/docs for scheduler recovery contract. OWN:\n";
p_f += "- packages/reconciliation/src/** (scheduler tests only unless bug)\n";
p_f += "- packages/reconciliation/docs/**\n";
p_f += "- packages/testkit/** recon conformance / memory listDue soft-release tests if needed for shared contract\n";
p_f += "Do NOT edit SQL/Redis store implementation bodies owned by B/C except testkit memory if already correct.\n\n";
p_f += "Ensure createReconciliationScheduler crash recovery contract is tested at package level with memory store:\n";
p_f += "schedule → claim → expire lease → processDue/claimDue via listDue rediscovers job.\n";
p_f += "Document in crash-boundaries.md that SQL/Redis adapters must soft-release/re-index in listDue (R5/R6).\n";
p_f += "If memory already soft-releases, add regression test so it cannot regress.\n";
p_f += "CHANGELOG Unreleased for reconciliation if behavior/docs change.\n";

let implement_jobs = [
    #{ prompt: p_a, label: "fix:A-paymob-dualwrite", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:B-sql-recon-listdue", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:C-redis-recovery-fence", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:D-webhooks-envelope", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:E-docs-paypal-report", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:F-recon-contract-tests", capability_mode: "execute", output_schema: implement_schema },
];

let impl_results = parallel(implement_jobs);
let impl_summaries = [];
let impl_i = 0;
while impl_i < impl_results.len() {
    let r = impl_results[impl_i];
    if r != () && r.success && r.output != () {
        log("Implement slot " + impl_i.to_string() + ": " + r.output.summary);
        impl_summaries.push(r.output.summary);
        write_scratch_file("fix-residual-impl-" + impl_i.to_string() + ".json", json_encode(r.output));
    } else {
        log("Implement slot " + impl_i.to_string() + " FAILED");
        impl_summaries.push("slot " + impl_i.to_string() + " failed");
    }
    impl_i += 1;
}

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
log("Integrating residual fix streams");

let p_int = "";
p_int += common;
p_int += "INTEGRATE after parallel residual streams A–F in " + root + ".\n";
p_int += "Stream summaries: " + json_encode(impl_summaries) + "\n\n";
p_int += "Your job: fix cross-stream breakages and finish incomplete items.\n";
p_int += "1) Paymob dual-write tests green; stableType agreement for amount-only refunds.\n";
p_int += "2) SQL recon listDue soft-release present on ALL SQL adapters (postgres/sqlite/turso/d1/DO).\n";
p_int += "3) Redis RECON_FAIL unexpired lease; Redis recon listDue rediscovery; Redis webhook listRetryable rediscovery.\n";
p_int += "4) Conformance/unit tests for listDue-after-abandon exist and pass for memory at minimum.\n";
p_int += "5) processRetryable envelope unwrap does not break existing tests.\n";
p_int += "6) Run bun install if needed; fix TS errors; do not commit.\n";
p_int += "7) Append/update residual remediation section on deep-audit report if missing.\n";
p_int += "Return {ok, files_changed, summary, notes, fixed_ids}.\n";

let integrate = agent(p_int, #{
    label: "integrate:residual-fixes",
    capability_mode: "execute",
    output_schema: implement_schema,
});
if integrate != () && integrate.success && integrate.output != () {
    log("Integrate: " + integrate.output.summary);
    write_scratch_file("fix-residual-integrate.json", json_encode(integrate.output));
} else {
    log("Integrate agent failed");
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Verifying residual deep-audit fixes");

let p_ver = "";
p_ver += "Verify residual deep-audit fixes in " + root + ". You MAY run shell commands. Do NOT commit.\n\n";
p_ver += "Run:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun test\n";
p_ver += "4) cd " + root + " && bun run check:boundaries\n";
p_ver += "5) cd " + root + " && bun run check:runtime-portability\n\n";
p_ver += "Invariant greps (must hold):\n";
p_ver += "I1) mapPaymobFromFlags does NOT map bare success to payment.succeeded when status/amounts indicate refund\n";
p_ver += "    (rg for refund/status preference in webhook-event-map.ts / paymob gateway dual-write path)\n";
p_ver += "I2) Test asserts amount-only Paymob refund dual-write stableType is refund (not payment.succeeded)\n";
p_ver += "I3) SQL recon listDue soft-releases claimed+expired OR equivalent rediscovery (not only status=scheduled alone)\n";
p_ver += "I4) Redis RECON_FAIL_LUA has exp <= nowMs → lease_lost before mutating\n";
p_ver += "I5) Redis recon listDue rediscovery path exists (soft-release/re-index/SCAN/claimed-expiry index)\n";
p_ver += "I6) Redis webhook listRetryable rediscovery of abandoned claimed exists\n";
p_ver += "I7) processRetryable unwraps PersistedPaymentEventEnvelope.event by default OR documented helper + tests\n\n";
p_ver += "Set ok=true only if typecheck, tests, boundaries, portability, and invariants all pass.\n";
p_ver += "Return full verify_schema.\n";

let verify = agent(p_ver, #{
    label: "verify:residual-fixes",
    capability_mode: "execute",
    output_schema: verify_schema,
});
let verify_ok = false;
let verify_summary = "verify failed";
if verify != () && verify.success && verify.output != () {
    verify_ok = verify.output.ok == true;
    verify_summary = verify.output.summary;
    log("Verify ok=" + verify_ok.to_string() + " — " + verify_summary);
    write_scratch_file("fix-residual-verify.json", json_encode(verify.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate on residual blockers");

let p_gate = "";
p_gate += "Adversarial gate for residual deep-audit fixes at " + root + ".\n";
p_gate += "READ-ONLY verification with read_file/grep. Do NOT trust stream summaries.\n";
p_gate += "Verify summary: " + verify_summary + "\n\n";
p_gate += "For EACH residual blocker R1–R9, set checklist line FIXED|STILL_OPEN|PARTIAL with absolute path evidence.\n";
p_gate += "R1 Paymob amount-only refund dual-write not payment.succeeded\n";
p_gate += "R2 mapPaymobFromFlags no bare-success short-circuit over refunds\n";
p_gate += "R3 amount-aware status vs stableType agreement for refunds (and auth+capture not under-map if fixed)\n";
p_gate += "R4 docs describe dual-write agreement for amount-only refunds\n";
p_gate += "R5 SQL recon listDue soft-release expired claimed (all SQL adapters)\n";
p_gate += "R6 Redis recon listDue rediscovery without prior get\n";
p_gate += "R7 Redis RECON_FAIL unexpired-lease fence\n";
p_gate += "R8 Redis webhook listRetryable abandoned-claim drain\n";
p_gate += "R9 recon fail fencing parity SQL/Redis/memory\n\n";
p_gate += "Also note N1–N8 status briefly.\n";
p_gate += "pass=true only if R1–R9 are FIXED and verify was ok (N* may remain PARTIAL with docs).\n";
p_gate += "If verify failed, pass=false and list failures as blocking.\n";
p_gate += "Update docs/deep-audit-package-report.md residual remediation if needed; path in report_path.\n";
p_gate += "Return gate_schema.\n";

let gate = agent(p_gate, #{
    label: "gate:residual-fixes",
    capability_mode: "execute",
    output_schema: gate_schema,
});

let gate_pass = false;
let gate_blocking = [];
let gate_summary = "gate failed";
if gate != () && gate.success && gate.output != () {
    gate_pass = gate.output.pass == true;
    gate_summary = gate.output.summary;
    if gate.output.blocking != () {
        gate_blocking = gate.output.blocking;
    }
    log("Gate pass=" + gate_pass.to_string() + " — " + gate_summary);
    write_scratch_file("fix-residual-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed");
    gate_blocking.push("Gate agent failed");
}

if !verify_ok {
    gate_pass = false;
    gate_blocking.push("Verify failed: " + verify_summary);
}

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");

if gate_pass {
    log("Gate passed — no remediation needed");
} else {
    log("Remediating remaining residual blockers: " + json_encode(gate_blocking));
    let p_rem = "";
    p_rem += common;
    p_rem += "REMEDIATE remaining residual blocking items after gate failed.\n";
    p_rem += "Blocking list: " + json_encode(gate_blocking) + "\n";
    p_rem += "Verify: " + verify_summary + "\n";
    p_rem += "Gate: " + gate_summary + "\n\n";
    p_rem += "Fix every remaining STILL_OPEN/PARTIAL required for pass (R1–R9).\n";
    p_rem += "Priority: Paymob false-paid dual-write first, then recon listDue SQL/Redis, then RECON_FAIL fence, then webhook Redis list.\n";
    p_rem += "Re-run focused tests after fixes. Do not commit.\n";
    p_rem += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_rem, #{
        label: "remediate:residual-blockers",
        capability_mode: "execute",
        output_schema: fix_schema,
    });
    if rem != () && rem.success && rem.output != () {
        log("Remediate: " + rem.output.summary);
        write_scratch_file("fix-residual-remediate.json", json_encode(rem.output));
    }

    let p_ver2 = "";
    p_ver2 += "Post-remediation verify at " + root + ".\n";
    p_ver2 += "Run typecheck, bun test, check:boundaries, check:runtime-portability.\n";
    p_ver2 += "Re-check invariants I1–I7 from the residual fix workflow.\n";
    p_ver2 += "Return verify_schema; ok only if all green.\n";
    let verify2 = agent(p_ver2, #{
        label: "verify2:post-remediate-residual",
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    if verify2 != () && verify2.success && verify2.output != () {
        verify_ok = verify2.output.ok == true;
        verify_summary = verify2.output.summary;
        log("Verify2 ok=" + verify_ok.to_string() + " — " + verify_summary);
        write_scratch_file("fix-residual-verify2.json", json_encode(verify2.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after residual remediation at " + root + ".\n";
    p_gate2 += "Verify: " + verify_summary + "\n";
    p_gate2 += "Re-check R1–R9 FIXED|STILL_OPEN|PARTIAL with evidence. pass only if R1–R9 FIXED and verify ok.\n";
    p_gate2 += "Update docs/deep-audit-package-report.md residual remediation section.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate2:final-residual",
        capability_mode: "execute",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true && verify_ok;
        gate_summary = gate2.output.summary;
        log("Gate2 pass=" + gate_pass.to_string() + " — " + gate_summary);
        write_scratch_file("fix-residual-gate2.json", json_encode(gate2.output));
    } else {
        gate_pass = false;
    }
}

if gate_pass {
    log("fix-deep-audit-residual COMPLETE — PASS");
} else {
    log("fix-deep-audit-residual COMPLETE — FAIL: " + gate_summary);
}
