let meta = #{
    name: "phase-19-21-fix-gate",
    description: "Critic, fix, verify, and adversarially gate Phase 19-21 review findings (recon, observability, routing; skip Phase 22)",
    phases: [
        #{ title: "Critic", detail: "confirm each Phase 19-21 finding still present" },
        #{ title: "Fix", detail: "four non-overlapping implementation streams" },
        #{ title: "Verify", detail: "typecheck plus recon/obs/routing/store tests" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "write gate report" },
    ],
    when_to_use: "After a Phase 19-21 (reconciliation + observability + routing) review; fix scheduling liveness, redaction, routing honesty, then gate. Do not implement Phase 22.",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let rem_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
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

fn safe_summary(r) {
    if r == () { return "no-result"; }
    if !r.success { return "failed"; }
    if r.output == () { return "empty-output"; }
    if r.output.summary == () { return "ok"; }
    r.output.summary
}

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Confirming Phase 19-21 findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "Skip Phase 22 entirely.\n";
p_c += "P19-MEM-ATTEMPTS: packages/reconciliation/src/memory-store.ts and packages/testkit/src/memory/memory-stores.ts always attempts+1 after converting expired claimed->scheduled. Durable SQL keeps attempts on expired claimed reclaim (sql-foundation reconciliationClaimTemplates CASE WHEN status=claimed). Conformance suite does not assert attempts unchanged after crash reclaim.\n";
p_c += "P19-REOPEN: Domain memory-store reopens terminal completed/failed/manual_review on schedule (RECON-7). Durable adapters (postgres/sqlite/d1/turso/do/redis) and testkit memory return already_exists. After maxAttempts markManualReview, scheduler.schedule same key is a silent no-op in production.\n";
p_c += "P19-DOCS: packages/reconciliation/README.md and docs/scheduling.md claimDue sketches call complete after reconcile without decideReconciliationPolicy. consistent+pending/processing is retry_later (RECON-3) — completing ends recovery.\n";
p_c += "P19-DO-REPAIR: packages/store-durable-objects/src/stores/reconciliation-store.ts timestamp repair UPDATE lacks free-lease fence (status scheduled OR lease null/expired). Postgres/sqlite templates fence it. Stale repair can clobber a concurrent winner lease_expires_at.\n";
p_c += "P19-CAPTURE: decideReconciliationPolicy update_local_to_paid / mark_consistent does not refuse when provider.status is paid but capturedAmount is zero or less than amount. compareSnapshots only compares capturedAmount if local has it.\n";
p_c += "P20-AUTH-RESTORE: packages/observability/src/redaction.ts restoreOperationalKeysIfRedacted restores authorized leaf when core value-redacted it as [REDACTED] (sk_live / PAN). Tests only cover boolean authorized.\n";
p_c += "P20-TRACER: withPaymentOperation spanAttributesFromContext copies internalReference/inboxEventKey/tenant without redactAttributeBag. Custom PaymentTracer sees raw values. OTEL bridge scrubs; helper does not.\n";
p_c += "P20-ERROR-CODE: sanitizeExceptionForSpan / sanitizeOtelException forward error.code unredacted.\n";
p_c += "P20-TELEMETRY-WRAP: packages/core/src/gateways/gateway-context.ts assigns partial.telemetry raw. Logger is redacted; telemetry is not.\n";
p_c += "P21-EXCLUDE-HONESTY: hasAmountRangeOnlyReject / hasRequiredCapabilitiesOnlyReject skip rules whose gateway is excluded or unhealthy. trySelectFallbackGateway merges attemptedGateways into exclude, so post-attempt fallback can bypass amount min/max and rule-level requiredCapabilities.\n";
p_c += "P21-AMOUNT-RESOLVE: resolveInputAmount string amount does not inherit input.currency. Missing/invalid/unparseable amounts make amountOutsideConfiguredRange false so unconstrained fallback applies. Natural {currency, amount: decimal string} bypasses ROUTE-1.\n";
p_c += "P21-EXPLICIT-STATE: classifySubmissionState returns explicit submissionState first even when outcome is indeterminate / errorKind timeout. Tests lock not_submitted winning over indeterminate. Quieter than expert override.\n";
p_c += "P21-VALIDATION-ERROR: classifyErrorKind validation_error is pre_submission_failure. Bare errorKind without ValidationError object / outcome still allows multi-gateway fallback.\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-19-21",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Four non-overlapping Phase 19-21 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style. Do not weaken tests. Prefer fail-closed money/lease/fallback/redaction.\n";
rules += "Skip any ID the critic already marked ALREADY FIXED. Do not implement Phase 22.\n";

let p_a = rules;
p_a += "STREAM A — RECON POLICY + DOCS. OWN ONLY:\n";
p_a += "- packages/reconciliation/src/policy.ts\n";
p_a += "- packages/reconciliation/src/policy.test.ts\n";
p_a += "- packages/reconciliation/src/compare.ts (only if needed for captured vs amount)\n";
p_a += "- packages/reconciliation/src/compare.test.ts (only if compare changes)\n";
p_a += "- packages/reconciliation/README.md\n";
p_a += "- packages/reconciliation/docs/scheduling.md\n";
p_a += "- packages/reconciliation/docs/reconciliation.md\n";
p_a += "Do NOT edit memory-store.ts, scheduler.ts, store.ts, or any store-* adapter.\n";
p_a += "FIX P19-CAPTURE: Refuse safe update_local_to_paid and mark_consistent when provider.status is paid-like AND capturedAmount is present and (zero while amount is non-zero, OR not money-equal to amount). Use existing toMinorUnits / moneyEquals / moneyIsNonZero helpers. Missing capturedAmount stays allowed (many providers omit it). Add tests: pending local + paid provider captured 4 vs amount 10 -> not update_local_to_paid; captured 0 + amount 10 -> not paid; captured equal to amount still paid upgrade; status-only local paid + provider paid + captured 4 -> not mark_consistent.\n";
p_a += "FIX P19-DOCS: README claimDue loop and scheduling.md must call decideReconciliationPolicy (or decideReconciliationAction). complete ONLY for mark_consistent / applied safe paid/failed updates. retry / failAndReschedule for retry_later. Never complete on raw outcome===consistent (pending/processing still settling). Show do_not_create_replacement / manual_review / apply_drift_review paths briefly.\n";

let p_b = rules;
p_b += "STREAM B — RECON STORES / MEMORY / CONFORMANCE / DO REPAIR. OWN ONLY:\n";
p_b += "- packages/reconciliation/src/memory-store.ts\n";
p_b += "- packages/reconciliation/src/scheduler.ts (comment/docs in-file only if needed)\n";
p_b += "- packages/reconciliation/src/scheduler.test.ts (reopen / attempts cases)\n";
p_b += "- packages/testkit/src/memory/memory-stores.ts\n";
p_b += "- packages/testkit/src/memory/memory-stores.test.ts if present\n";
p_b += "- packages/testkit/src/storage/reconciliation-conformance.ts\n";
p_b += "- packages/store-postgres/src/stores/reconciliation-store.ts\n";
p_b += "- packages/store-sqlite/src/stores/reconciliation-store.ts\n";
p_b += "- packages/store-d1/src/stores/reconciliation-store.ts\n";
p_b += "- packages/store-turso/src/stores/reconciliation-store.ts\n";
p_b += "- packages/store-durable-objects/src/stores/reconciliation-store.ts\n";
p_b += "- packages/store-redis/src/stores/reconciliation-store.ts\n";
p_b += "- packages/store-redis/src/scripts/reconciliation.lua.ts\n";
p_b += "- packages/sql-foundation only if a shared schedule/reopen template is the cleanest DRY path\n";
p_b += "Do NOT edit policy.ts, observability, or routing.\n";
p_b += "FIX P19-MEM-ATTEMPTS: Expired claimed reclaim must NOT burn attempts. After releaseExpiredLease, if the pre-release status was claimed, keep attempts; only increment when claiming from scheduled. listDue soft-release of expired claimed should restore one attempt (floor 0) OR keep claimed-reclaim path without increment (match SQL CASE WHEN status=claimed THEN attempts). Apply to BOTH domain memory-store and testkit memory-stores. Add conformance case: schedule, claim (attempts=1), abandon, advance clock past lease, listDue then claim — second acquire attempts must equal first (1). Also add a domain memory-store unit test.\n";
p_b += "FIX P19-REOPEN: Adapters SHOULD reopen terminal rows (completed/failed/manual_review) as scheduled under the same key; active scheduled/claimed stay already_exists. Implement atomically: INSERT or ON CONFLICT UPDATE only when status IN terminal; reset attempts=0, clear lease fields, set due_at/subject_id/reason, keep created_at/generation. Return kind scheduled with the reopened record. Align testkit memory with domain memory (currently testkit already_exists on any existing). Add conformance: complete a job then schedule same key -> scheduled (not already_exists); second schedule while scheduled -> already_exists. Do not reopen claimed/scheduled.\n";
p_b += "FIX P19-DO-REPAIR: DO repair UPDATE must use the same free-lease fence as sql-foundation reconciliationTimestampRepairTemplates (status=scheduled OR lease_expires_at IS NULL OR lease_expires_at <= now). Never overwrite an active winner lease_expires_at. Add a unit/comment test if DO tests can express it; at minimum the SQL must match the fence.\n";

let p_o = rules;
p_o += "STREAM C — OBSERVABILITY + CORE TELEMETRY WRAP. OWN ONLY:\n";
p_o += "- packages/observability/src/**\n";
p_o += "- packages/observability/docs/** (honesty only if needed)\n";
p_o += "- packages/core/src/gateways/gateway-context.ts\n";
p_o += "- packages/core/src/gateways/gateway-context.test.ts or existing core telemetry tests if present\n";
p_o += "Do NOT edit reconciliation, routing, or store adapters.\n";
p_o += "FIX P20-AUTH-RESTORE: Never restore an authorized leaf that core redacted as [REDACTED] because the VALUE was secret-shaped. Restore only operational booleans / non-secret primitives (true/false). Add test: { authorized: 'sk_live_abc123secret' } stays [REDACTED]; { authorized: false } stays false.\n";
p_o += "FIX P20-TRACER: withPaymentOperation must pass span attributes through redactAttributeBag (same as OTEL bridge). Custom tracers must not see raw secret-shaped internalReference. Add instrumentation test.\n";
p_o += "FIX P20-ERROR-CODE: sanitizeExceptionForSpan and sanitizeOtelException must not forward secret-shaped code strings (reuse core redact / opaque-secret check or drop code if it looks like sk_live/PAN). Name still allowed. Add test: Error with code sk_live_x does not appear in sanitized output.\n";
p_o += "FIX P20-TELEMETRY-WRAP: createDefaultGatewayContext (or createGatewayContext) must wrap provided telemetry with createRedactingTelemetrySink the same way logger is wrapped with createRedactingLogger. Double-wrap must stay safe for non-authorized secrets. Add/adjust a core test: emit cardNumber/secret via ctx.telemetry is redacted.\n";

let p_d = rules;
p_d += "STREAM D — ROUTING HONESTY. OWN ONLY:\n";
p_d += "- packages/routing/src/**\n";
p_d += "- packages/routing/docs/safe-fallback.md\n";
p_d += "- packages/routing/docs/selection.md\n";
p_d += "- packages/routing/docs/matching.md if merchantPreference wording is still 'exact'\n";
p_d += "Do NOT edit reconciliation, observability, or store adapters.\n";
p_d += "FIX P21-EXCLUDE-HONESTY: hasAmountRangeOnlyReject and hasRequiredCapabilitiesOnlyReject must still consider rules whose gateway is excluded or unhealthy. Post-attempt trySelectFallbackGateway must not send $50 to unconstrained fallback after excluding an amountMin=100 rule, and must not drop rule-level requiredCapabilities. Add tests that pass attemptedGateways / excludeGateways / unhealthy health map.\n";
p_d += "FIX P21-AMOUNT-RESOLVE: resolveInputAmount for string amount must use input.currency when amountCurrency is omitted. amountOutsideConfiguredRange / hasAmountRangeOnlyReject: a range rule (min/max set, amountCurrency present or inherited) plus missing/unparseable/invalid input amount is an honesty violation (true) so select-time fallback cannot silently accept it. Cross-currency with a resolvable different currency stays not-an-amount-honesty-violation (other criteria). Add tests: {currency:'USD', amount:'50.00'} against USD min 100 throws NoRouteMatchError; missing amount against a range rule throws; JPY '10.50' against a JPY range throws.\n";
p_d += "FIX P21-EXPLICIT-STATE: Explicit submissionState must NOT override money-moving / uncertain evidence (outcome indeterminate/succeeded/failed/declined/requires_action, or timeout/connection_reset/provider_5xx_uncertain/submitted error kinds) into a SAFE state. Safe explicit state + unsafe evidence -> use the unsafe evidence (fail-closed). Expert override remains the only way to allow unsafe fallback. Flip the test that locks not_submitted winning over indeterminate+timeout. Explicit state may still win when there is no conflicting money evidence.\n";
p_d += "FIX P21-VALIDATION-ERROR: errorKind 'validation_error' alone is not enough for pre_submission_failure. Keep name===ValidationError / code validation_error on a ValidationError-shaped object as pre_submit. Bare errorKind validation_error without that object -> indeterminate (same class as invalid_request). Flip the locked test. Update safe-fallback.md so apps never map provider 400 to validation_error.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:recon-policy-docs", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:recon-stores", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_o, label: "fix:observability", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:routing", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and targeted Phase 19-21 tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root with command evidence (paste relevant fail lines):\n";
p_v += "1) bun run typecheck\n";
p_v += "2) bun test packages/reconciliation packages/observability packages/routing packages/testkit packages/store-postgres packages/store-sqlite packages/store-d1 packages/store-turso packages/store-durable-objects packages/store-redis packages/sql-foundation packages/core/src/gateways\n";
p_v += "Env-gated live adapter skips are OK. Failing unit tests are not OK.\n";
p_v += "3) Grep/read invariants (must hold):\n";
p_v += "   - memory recon stores do not attempts+1 on expired claimed reclaim\n";
p_v += "   - durable recon schedule reopens terminal rows (or testkit+SQL all agree)\n";
p_v += "   - DO recon repair has free-lease fence\n";
p_v += "   - policy refuses paid upgrade when capturedAmount present and != amount\n";
p_v += "   - recon README/scheduling complete only after policy, not raw consistent\n";
p_v += "   - authorized sk_live stays [REDACTED] after redactTelemetryData\n";
p_v += "   - withPaymentOperation attributes go through redactAttributeBag\n";
p_v += "   - gateway-context wraps telemetry\n";
p_v += "   - routing exclude/unhealthy still honor amount/capability bounds\n";
p_v += "   - string amount inherits input.currency\n";
p_v += "   - explicit not_submitted does not beat indeterminate/timeout\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Phase 19-21 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence.\n";
p_g += "BLOCKERS:\n";
p_g += "P19-MEM-ATTEMPTS: Domain AND testkit memory recon claim do not increment attempts when reclaiming expired claimed (SQL semantics). Conformance asserts attempts unchanged.\n";
p_g += "P19-REOPEN: Durable adapters + testkit memory reopen terminal completed/failed/manual_review on schedule; active rows already_exists. Conformance locks this.\n";
p_g += "P19-DO-REPAIR: DO repair UPDATE fenced to free/expired lease (not any non-terminal row).\n";
p_g += "P19-CAPTURE: Paid-like + capturedAmount present and not equal to amount is not safe update_local_to_paid / mark_consistent.\n";
p_g += "P19-DOCS: README/scheduling do not complete recon jobs on raw consistent without policy.\n";
p_g += "P20-AUTH-RESTORE: secret-shaped authorized values stay [REDACTED].\n";
p_g += "P20-TRACER: withPaymentOperation redacts span attribute bags.\n";
p_g += "P20-ERROR-CODE: sanitized exception code cannot carry sk_live/PAN.\n";
p_g += "P20-TELEMETRY-WRAP: default gateway context wraps telemetry in redacting sink.\n";
p_g += "P21-EXCLUDE-HONESTY: excluded/unhealthy bounded rule still blocks unconstrained fallback for out-of-range amount / missing rule caps.\n";
p_g += "P21-AMOUNT-RESOLVE: string amount + input.currency participates in range honesty; missing/invalid amount on a range rule is fail-closed.\n";
p_g += "P21-EXPLICIT-STATE: explicit not_submitted does not override indeterminate/timeout evidence.\n";
p_g += "P21-VALIDATION-ERROR: bare errorKind validation_error is not pre_submission_failure.\n";
p_g += "Non-blocking allowed: processDue maxInFlightByGateway still per-call; listDeadLetter still needs scan/keys; no first-class ProviderLookupPort on gateways; Phase 22 still absent; leftover nits in matching.md if already fixed.\n";
p_g += "Return {pass, blocking, non_blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:adversarial",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
log("Gate: " + safe_summary(gate));

let gate_pass = false;
if gate != () && gate.success && gate.output != () && gate.output.pass == true {
    gate_pass = true;
}

let verify_ok = false;
if verify != () && verify.success && verify.output != () && verify.output.ok == true {
    verify_ok = true;
}

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");
if gate_pass && verify_ok {
    log("Gate passed and verify ok; skipping remediate");
} else {
    log("Remediating remaining Phase 19-21 blockers");
    let blockers = "";
    if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
        for b in gate.output.blocking {
            blockers += b + "\n";
        }
    }
    if !verify_ok {
        blockers += "Verify failed or incomplete. Re-run typecheck and failing tests after fixes.\n";
        if verify != () && verify.success && verify.output != () && verify.output.failures != () {
            blockers += "Verify failures: " + json_encode(verify.output.failures) + "\n";
        }
    }
    if blockers == "" {
        blockers += "Gate missing or failed closed. Re-read P19-MEM-ATTEMPTS P19-REOPEN P19-DO-REPAIR P19-CAPTURE P19-DOCS P20-AUTH-RESTORE P20-TRACER P20-ERROR-CODE P20-TELEMETRY-WRAP P21-EXCLUDE-HONESTY P21-AMOUNT-RESOLVE P21-EXPLICIT-STATE P21-VALIDATION-ERROR and fix any still present.\n";
    }

    let p_r = rules;
    p_r += "REMEDIATE remaining Phase 19-21 blockers. You may edit packages/reconciliation, packages/observability, packages/routing, packages/testkit memory+recon conformance, packages/store-*, packages/sql-foundation, packages/core/src/gateways/gateway-context.ts.\n";
    p_r += "Do not implement Phase 22. Do not commit.\n";
    p_r += "Blockers:\n";
    p_r += blockers;
    p_r += "Fix them with tests. Then run bun run typecheck and bun test on the touched packages.\n";
    p_r += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_r, #{
        label: "remediate:blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));

    let p_v2 = "";
    p_v2 += "Re-verify " + root + " after remediation.\n";
    p_v2 += "Run bun run typecheck and bun test packages/reconciliation packages/observability packages/routing packages/testkit packages/store-postgres packages/store-sqlite packages/store-d1 packages/store-turso packages/store-durable-objects packages/store-redis packages/sql-foundation.\n";
    p_v2 += "Re-check blocking invariants from the gate list. Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}.\n";
    let ver2 = agent(p_v2, #{
        label: "verify:post-remediate",
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    log("Post-remediate verify: " + safe_summary(ver2));
    if ver2 != () && ver2.success && ver2.output != () && ver2.output.ok == true {
        verify_ok = true;
    }

    let p_g2 = "";
    p_g2 += "Quick re-gate of " + root + " after remediation. READ-ONLY. Read code for remaining Phase 19-21 blockers only.\n";
    p_g2 += "pass=true only if no blocking IDs remain. Return {pass, blocking, non_blocking, summary}.\n";
    let gate2 = agent(p_g2, #{
        label: "gate:post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    log("Post-remediate gate: " + safe_summary(gate2));
    if gate2 != () && gate2.success && gate2.output != () && gate2.output.pass == true {
        gate_pass = true;
    } else if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = false;
    }
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
log("Writing Phase 19-21 fix-gate report");

let p_rep = "";
p_rep += "Write a gate report to " + root + "/packages/core/docs/baseline/phase-19-21-fix-gate-report.md\n";
p_rep += "and a short pointer at " + root + "/docs/phase-19-21-fix-gate-report.md matching docs/phase-19-gate-report.md style.\n";
p_rep += "Repo: " + root + "\n";
p_rep += "Use read_file/grep plus critic/fix/verify/gate outcomes. Be honest. Do not claim PASS without file:line evidence.\n";
p_rep += "Include: verdict, per-ID table (P19-MEM-ATTEMPTS P19-REOPEN P19-DO-REPAIR P19-CAPTURE P19-DOCS P20-AUTH-RESTORE P20-TRACER P20-ERROR-CODE P20-TELEMETRY-WRAP P21-EXCLUDE-HONESTY P21-AMOUNT-RESOLVE P21-EXPLICIT-STATE P21-VALIDATION-ERROR), typecheck/tests, remaining nits. Note Phase 22 was out of scope.\n";
p_rep += "Match the style of packages/core/docs/baseline/phase-19-gate-report.md (shorter is OK).\n";
p_rep += "Return {ok, report_path, summary}.\n";

let report = agent(p_rep, #{
    label: "report:gate",
    capability_mode: "all",
    output_schema: report_schema,
});
log("Report: " + safe_summary(report));

let report_path = "";
if report != () && report.success && report.output != () && report.output.report_path != () {
    report_path = report.output.report_path;
}

complete(#{
    summary: "Phase 19-21 critic/fix/verify/gate finished. Gate pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + ". " + safe_summary(report),
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    report_path: report_path,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
