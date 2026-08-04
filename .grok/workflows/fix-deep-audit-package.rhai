let meta = #{
    name: "fix-deep-audit-package",
    description: "Fix all confirmed deep-audit-package findings (P0 logic + packaging + high-value P1/P2) with verify+adversarial gate",
    phases: [
        #{ title: "Recheck", detail: "confirm each blocking finding still present with file:line evidence" },
        #{ title: "Implement", detail: "parallel non-overlapping fix streams for all confirmed blockers + priority polish" },
        #{ title: "Integrate", detail: "cross-stream wiring, docs, boundary script, packaging graph" },
        #{ title: "Verify", detail: "typecheck + full tests + boundaries + portability + invariant greps" },
        #{ title: "Gate", detail: "adversarial re-check of every original blocker" },
        #{ title: "Remediate", detail: "fix any remaining blocking gate items" },
    ],
    when_to_use: "After docs/deep-audit-package-report.md FAIL verdict; close all confirmed blockers",
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
log("Rechecking confirmed deep-audit findings in " + root);

let p_recheck = "";
p_recheck += "Recheck ALL confirmed findings from " + root + "/docs/deep-audit-package-report.md.\n";
p_recheck += "Use read_file and grep ONLY. Do not edit.\n";
p_recheck += "For each item, STILL PRESENT or ALREADY FIXED with file:line evidence.\n\n";
p_recheck += "BLOCKING CHECKLIST:\n";
p_recheck += "B1: Moyasar resolvePaymentStatus compares refunded to amount not captured (partial capture full refund → partially_refunded)\n";
p_recheck += "B2: moyasar.md documents same wrong refund baseline\n";
p_recheck += "B3: ackAfterClaim parking claim increments attempts → premature dead_letter vs maxAttempts handler docs\n";
p_recheck += "B4: claim ignores availableAt across memory/SQL/Redis (only listRetryable gates)\n";
p_recheck += "B5: SQL listRetryable only status=pending — abandoned claimed+expired undrainable via processRetryable\n";
p_recheck += "B6: Redis WEBHOOK_FAIL_LUA no unexpired lease check (complete/SQL fail do)\n";
p_recheck += "B7: Lease fencing uses client clocks not DB NOW() (multi-host skew) — fix if feasible else document honest residual\n";
p_recheck += "B8: publishable store-* hard-depend on private @paykernel/internal-sql-store\n";
p_recheck += "B9: production store adapters hard-depend on full @paykernel/testkit at runtime\n\n";
p_recheck += "NON-BLOCKING (fix if low-cost in same streams):\n";
p_recheck += "N1: shallow after-hook freeze for nested references/nextAction\n";
p_recheck += "N2: NonRetryableHandlerError({deadLetter:false}) poison spin docs or guard\n";
p_recheck += "N3: docs adapter-* path drift → store-*\n";
p_recheck += "N4: core webhooks.md fulfill-from-status sample → isPaidOutcome\n";
p_recheck += "N5: recon moneyEquals string equality false drift\n";
p_recheck += "Return confirmed[], already_fixed[], summary.\n";

let recheck = agent(p_recheck, #{
    label: "recheck:deep-audit-findings",
    capability_mode: "read-only",
    output_schema: recheck_schema,
});
let recheck_summary = "recheck incomplete";
if recheck != () && recheck.success && recheck.output != () {
    recheck_summary = recheck.output.summary;
    log("Recheck: " + recheck_summary);
    write_scratch_file("fix-deep-recheck.json", json_encode(recheck.output));
} else {
    log("Recheck agent failed — proceeding with full fix list");
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing deep-audit fixes in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Source of truth: " + root + "/docs/deep-audit-package-report.md\n";
common += "Recheck: " + recheck_summary + "\n";
common += "Rules: read BEFORE edit; minimal surgical diffs; do NOT commit; do NOT push; do NOT publish.\n";
common += "exactOptionalPropertyTypes ON. Keep 0.x backward compat where possible; changelog notes for status-string changes.\n";
common += "Add/update unit tests for every behavior change. Prefer existing patterns/errors/test style.\n";
common += "After edits re-read changed regions. Run focused bun test on touched packages when possible.\n";
common += "Skip items already fixed if recheck proved it. Return {ok, files_changed, summary, notes, fixed_ids}.\n\n";

// Stream A — Moyasar refund base + docs + after-hook nested freeze
let p_a = "";
p_a += common;
p_a += "STREAM A — core money-status + hook freeze. OWN FILES ONLY:\n";
p_a += "- packages/core/src/gateways/moyasar/**\n";
p_a += "- packages/core/docs/moyasar.md\n";
p_a += "- packages/core/docs/behavioral-contracts.md (only if needed for captured-base refund wording consistency)\n";
p_a += "- packages/core/src/gateways/base.gateway.ts (+ related hook tests in packages/core/src/**/*.test.ts)\n";
p_a += "- packages/core/docs/hooks.md if freeze language needs accuracy\n\n";
p_a += "FIX B1/B2 — Moyasar refund completeness baseline = captured when captured > 0 else amount:\n";
p_a += "In resolvePaymentStatus (moyasar.gateway.ts ~1486+):\n";
p_a += "  const refundBaseline = captured > 0 ? captured : amount;\n";
p_a += "  if (refunded > 0 && refunded < refundBaseline) return partially_refunded;\n";
p_a += "  if (refunded >= refundBaseline && refundBaseline > 0) return refunded;\n";
p_a += "Match Stripe/Paymob/behavioral-contracts. Example: amount=10000,captured=3000,refunded=3000 → refunded.\n";
p_a += "Update moyasar.md Partial statuses section to document captured baseline.\n";
p_a += "Add unit tests covering full refund of partial capture → refunded; partial refund of partial capture → partially_refunded;\n";
p_a += "full refund of full capture → refunded; refund without capture uses amount.\n\n";
p_a += "FIX N1 — After-hook nested freeze (non-blocking but do it):\n";
p_a += "shallowCloneResult / restoreMoneyIdentityFields must protect nested references and nextAction identity\n";
p_a += "(deep clone those objects or structured clone top-level + nested own-properties).\n";
p_a += "Do NOT deep-clone rawResponse if huge; freeze/clone nextAction + references at least.\n";
p_a += "Tests: after-hook cannot rewrite nextAction.redirectUrl or references.providerObjectId in returned result.\n";
p_a += "Keep top-level money/outcome forge protection.\n";

// Stream B — Webhooks engine attempt accounting + availableAt claim gate
let p_b = "";
p_b += common;
p_b += "STREAM B — packages/webhooks engine + memory store contracts. OWN:\n";
p_b += "- packages/webhooks/src/**\n";
p_b += "- packages/webhooks/docs/**\n";
p_b += "- packages/testkit memory webhook store ONLY if needed for claim availableAt parity with engine tests\n";
p_b += "Do NOT edit SQL adapters or Redis (stream C/D).\n\n";
p_b += "FIX B3 — ackAfterClaim must not burn handler attempt budget:\n";
p_b += "maxAttempts is documented as max HANDLER attempts.\n";
p_b += "Preferred approach (pick cleanest that keeps crash-boundaries):\n";
p_b += "  Option 1 (preferred): parking fail path restores/decrements attempts so park claim is free; OR\n";
p_b += "  Option 2: claim accepts countAttempt:false for internal use only (not public if possible); OR\n";
p_b += "  Option 3: shouldDeadLetter uses handlerAttempts field incremented only after real handler failure.\n";
p_b += "MUST: maxAttempts=3 + ackAfterClaim → 3 handler failures before dead_letter (regression test).\n";
p_b += "Update types.ts JSDoc if semantics clarify.\n\n";
p_b += "FIX B4 — claim must respect availableAt (product decision A — true backoff):\n";
p_b += "Key-addressed claim on pending row with availableAt > now must NOT reacquire for handler.\n";
p_b += "Return a distinct result: e.g. kind 'not_available' / 'backoff' with availableAt (extend ClaimWebhookResult union).\n";
p_b += "Engine processVerified / processRetryable: on not_available → scheduled_for_retry or equivalent without burning attempts.\n";
p_b += "Update memory-store claim path + engine wiring + docs (store.ts FailWebhookInput wording).\n";
p_b += "Provider redelivery during backoff must not increment attempts toward dead_letter.\n";
p_b += "Tests: fail(retryAfterMs large) then immediate claim(key) → not_available; listRetryable empty until due;\n";
p_b += "after clock advance claim succeeds.\n\n";
p_b += "FIX N2 — NonRetryableHandlerError({deadLetter:false}): document poison risk; prefer auto dead_letter after N or warn in docs.\n";
p_b += "Minimal: docs + test documenting behavior; optional engine cap if cheap.\n";

// Stream C — SQL stores listRetryable abandoned claims + availableAt claim
let p_c = "";
p_c += common;
p_c += "STREAM C — SQL adapters + sql-store claim templates. OWN:\n";
p_c += "- internal/sql-store/src/** (claim algorithm/templates if needed for availableAt)\n";
p_c += "- packages/store-postgres/src/**\n";
p_c += "- packages/store-sqlite/src/**\n";
p_c += "- packages/store-turso/src/**\n";
p_c += "- packages/store-d1/src/**\n";
p_c += "- packages/store-durable-objects/src/**\n";
p_c += "Do NOT edit packages/store-redis (stream D). Do NOT edit packages/webhooks engine (stream B) except if types imported.\n\n";
p_c += "FIX B5 — SQL listRetryable must surface abandoned expired claims:\n";
p_c += "Preferred: soft-release expired claimed → pending on listRetryable/get (match memory/Redis), OR\n";
p_c += "extend WHERE to: (status='pending' AND available_at<=now) OR (status='claimed' AND lease_expires_at<=now).\n";
p_c += "Apply consistently to postgres, sqlite, turso, d1, durable-objects webhook inbox stores.\n";
p_c += "If soft-release on list, clear lease fields and keep attempts.\n";
p_c += "Unit tests per adapter (or shared pattern): claim, advance clock past lease, listRetryable includes key.\n";
p_c += "Update crash-boundaries docs if they claim processRetryable reclaims after expiry.\n\n";
p_c += "FIX B4 SQL side — claim templates/algorithm gate available_at:\n";
p_c += "When status=pending AND available_at > now → do not reclaim; return not_available/backoff outcome.\n";
p_c += "Align decideWebhookClaim in internal/sql-store algorithm with memory (stream B) semantics.\n";
p_c += "Expired lease reclaim still allowed even if available_at future? Prefer: expired lease may reclaim for recovery;\n";
p_c += "pending+future available_at blocks. Document clearly.\n\n";
p_c += "FIX B7 partial — prefer DB-side time in SQL WHERE for lease expiry when driver allows\n";
p_c += "(e.g. lease_expires_at <= NOW() / datetime('now') as alternative or additional to bound param).\n";
p_c += "If too risky for all drivers, document multi-host NTP requirement in adapter docs and leave injectable clock for tests.\n";
p_c += "Do not break FakeClock unit tests — keep dual path if needed (bound now for tests, DB now for prod) only if clean.\n";

// Stream D — Redis fail fencing + availableAt claim
let p_d = "";
p_d += common;
p_d += "STREAM D — Redis adapter only. OWN:\n";
p_d += "- packages/store-redis/src/**\n";
p_d += "- packages/store-redis/docs/**\n\n";
p_d += "FIX B6 — WEBHOOK_FAIL_LUA must require unexpired lease like WEBHOOK_COMPLETE_LUA:\n";
p_d += "After status/token checks, if exp <= nowMs return lease_lost.\n";
p_d += "Add unit/conformance test: claim, expire lease (fake clock or past exp), fail → lease_lost.\n\n";
p_d += "FIX B4 Redis — WEBHOOK_CLAIM_LUA: if status pending and available_ms > nowMs return not_available (new result code).\n";
p_d += "Wire results parser + store.claim() to match webhooks ClaimWebhookResult union from stream B.\n";
p_d += "Coordinate result kind names with stream B (use same string/discriminant).\n";
p_d += "Expired lease reclaim still OK for recovery.\n\n";
p_d += "B7 Redis: if easy, document TIME caveat; optional hybrid — not required if tests depend on ARGV nowMs.\n";

// Stream E — Packaging: store-contracts extract + adapter deps
let p_e = "";
p_e += common;
p_e += "STREAM E — packaging graph (B8/B9). OWN:\n";
p_e += "- NEW package packages/store-contracts/ (create)\n";
p_e += "- packages/testkit (re-export from store-contracts; keep BC)\n";
p_e += "- packages/store-*/package.json + production src imports of @paykernel/testkit contracts/errors\n";
p_e += "- root package.json workspaces already packages/*\n";
p_e += "- scripts/check-workspace-boundaries.ts if new package needs rules\n";
p_e += "- docs/monorepo.md, docs/workspace-boundaries.md path drift N3 (adapter-* → store-*)\n";
p_e += "- packages/core/docs/webhooks.md N4 fulfill sample → isPaidOutcome\n";
p_e += "Do NOT rewrite SQL claim logic (streams C/D).\n\n";
p_e += "FIX B9 — Extract @paykernel/store-contracts:\n";
p_e += "Move production store contract types + StoreError hierarchy + adapter-manifest types from\n";
p_e += "packages/testkit/src/storage/contracts.ts and adapter-manifest.ts (and any error classes)\n";
p_e += "into packages/store-contracts with zero dependency on mock gateway / memory NON_PRODUCTION factories.\n";
p_e += "Package must be publishable, portable, typecheck+build like siblings.\n";
p_e += "testkit re-exports all moved symbols for backward compatibility.\n";
p_e += "All store-* production src: import contracts/errors from @paykernel/store-contracts.\n";
p_e += "package.json: dependency @paykernel/store-contracts; @paykernel/testkit only in devDependencies for tests/conformance.\n";
p_e += "Update root build/typecheck scripts to include store-contracts BEFORE adapters if needed.\n\n";
p_e += "FIX B8 — private internal-sql-store dependency:\n";
p_e += "Preferred durable fix for published tarballs (pick one and implement fully):\n";
p_e += "  A) Bundle @paykernel/internal-sql-store into each SQL adapter dist at build time and REMOVE it from\n";
p_e += "     runtime dependencies (use relative source import during monorepo build / bun build noExternal).\n";
p_e += "  B) If bundling is too fragile, create publishable public package @paykernel/sql-foundation that is the\n";
p_e += "     same code as internal/sql-store (or re-exports it) and is NOT under internal/* private rule;\n";
p_e += "     adapters depend on sql-foundation; keep internal as thin re-export OR migrate path.\n";
p_e += "Must keep: internal stays free of core/webhooks; boundaries script green; adapters still work in workspace.\n";
p_e += "Document decision in packages/store-postgres/README (or monorepo.md) briefly.\n";
p_e += "After graph change: bun install; typecheck adapters; tests for store-postgres unit + store-contracts public-api.\n\n";
p_e += "Also N3/N4 docs fixes listed above.\n";

// Stream F — recon moneyEquals + report remediation notes
let p_f = "";
p_f += common;
p_f += "STREAM F — recon money compare + audit report remediation section. OWN:\n";
p_f += "- packages/reconciliation/src/** (moneyEquals / compare helpers)\n";
p_f += "- packages/reconciliation/docs/** if needed\n";
p_f += "- docs/deep-audit-package-report.md (append Remediation section only; do not delete history)\n\n";
p_f += "FIX N5 — moneyEquals must not treat '10' vs '10.00' as different money when same numeric value/currency.\n";
p_f += "Prefer canonical compare via core Money/DecimalString helpers if importable without boundary break,\n";
p_f += "or normalize decimal strings before equality. Add unit tests.\n";
p_f += "reconciliation may depend on core only — OK to use @paykernel/core money utils if exported.\n";
p_f += "Append ## Remediation (post fix-deep-audit-package) to deep-audit report summarizing fixed IDs.\n";

let implement_jobs = [
    #{ prompt: p_a, label: "fix:A-moyasar-hooks", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:B-webhooks-engine", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:C-sql-stores", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:D-redis", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:E-packaging", capability_mode: "execute", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:F-recon-report", capability_mode: "execute", output_schema: implement_schema },
];

let impl_results = parallel(implement_jobs);
let impl_summaries = [];
let impl_i = 0;
while impl_i < impl_results.len() {
    let r = impl_results[impl_i];
    if r != () && r.success && r.output != () {
        log("Implement slot " + impl_i.to_string() + ": " + r.output.summary);
        impl_summaries.push(r.output.summary);
        write_scratch_file("fix-deep-impl-" + impl_i.to_string() + ".json", json_encode(r.output));
    } else {
        log("Implement slot " + impl_i.to_string() + " FAILED");
        impl_summaries.push("slot " + impl_i.to_string() + " failed");
    }
    impl_i += 1;
}

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
log("Integrating cross-stream wiring");

let p_int = "";
p_int += common;
p_int += "INTEGRATE after parallel streams A–F in " + root + ".\n";
p_int += "Stream summaries: " + json_encode(impl_summaries) + "\n\n";
p_int += "Your job: fix cross-stream breakages and unify types.\n";
p_int += "1) ClaimWebhookResult / not_available discriminant must match across webhooks + all adapters + testkit memory.\n";
p_int += "2) If store-contracts package was created, ensure all adapters compile; testkit re-exports; root scripts include it.\n";
p_int += "3) If availableAt claim gate added only in some stores, finish remaining stores for parity.\n";
p_int += "4) Run bun install if package.json changed.\n";
p_int += "5) Fix any TypeScript errors you introduce; do not leave broken imports.\n";
p_int += "6) Ensure public-api freeze tests still pass if exports moved.\n";
p_int += "7) Do not commit.\n";
p_int += "Return {ok, files_changed, summary, notes, fixed_ids}.\n";

let integrate = agent(p_int, #{
    label: "integrate:deep-audit-fixes",
    capability_mode: "execute",
    output_schema: implement_schema,
});
if integrate != () && integrate.success && integrate.output != () {
    log("Integrate: " + integrate.output.summary);
    write_scratch_file("fix-deep-integrate.json", json_encode(integrate.output));
} else {
    log("Integrate agent failed");
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Verifying deep-audit fixes");

let p_ver = "";
p_ver += "Verify deep-audit fixes in " + root + ". You MAY run shell commands. Do NOT commit.\n\n";
p_ver += "Run:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun test\n";
p_ver += "4) cd " + root + " && bun run check:boundaries\n";
p_ver += "5) cd " + root + " && bun run check:runtime-portability\n\n";
p_ver += "Invariant greps (must hold):\n";
p_ver += "I1) Moyasar resolvePaymentStatus uses captured baseline (rg refundBaseline or captured > 0 ? captured)\n";
p_ver += "I2) Redis WEBHOOK_FAIL_LUA has exp <= nowMs lease_lost before mutating\n";
p_ver += "I3) SQL listRetryable includes claimed+expired OR soft-release path (not only status=pending alone)\n";
p_ver += "I4) Production store-* package.json dependencies must NOT list @paykernel/testkit (devDependencies OK)\n";
p_ver += "I5) Either no runtime dep on private internal-sql-store in publishable adapters OR documented bundle/sql-foundation solution exists and package graph is consistent\n";
p_ver += "I6) claim path references availableAt/available_at gate somewhere in memory+SQL+Redis\n";
p_ver += "I7) Test exists for ackAfterClaim + maxAttempts handler budget\n\n";
p_ver += "Set ok=true only if typecheck, tests, boundaries, portability, and invariants all pass.\n";
p_ver += "Return full verify_schema.\n";

let verify = agent(p_ver, #{
    label: "verify:deep-audit-fixes",
    capability_mode: "execute",
    output_schema: verify_schema,
});
let verify_ok = false;
let verify_summary = "verify failed";
if verify != () && verify.success && verify.output != () {
    verify_ok = verify.output.ok == true;
    verify_summary = verify.output.summary;
    log("Verify ok=" + verify_ok.to_string() + " — " + verify_summary);
    write_scratch_file("fix-deep-verify.json", json_encode(verify.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate on original blockers");

let p_gate = "";
p_gate += "Adversarial gate for deep-audit fixes at " + root + ".\n";
p_gate += "READ-ONLY verification with read_file/grep. Do NOT trust stream summaries.\n";
p_gate += "Verify summary: " + verify_summary + "\n\n";
p_gate += "For EACH original blocker B1–B9, set checklist line FIXED|STILL_OPEN|PARTIAL with evidence.\n";
p_gate += "B1 Moyasar captured refund baseline\n";
p_gate += "B2 moyasar.md docs baseline\n";
p_gate += "B3 ackAfterClaim attempt budget (test + code)\n";
p_gate += "B4 claim availableAt gate (memory+SQL+Redis)\n";
p_gate += "B5 SQL abandoned claimed+expired recoverable via listRetryable/processRetryable\n";
p_gate += "B6 Redis fail requires unexpired lease\n";
p_gate += "B7 clock fencing (FIXED if DB now used, or PARTIAL if documented honest residual only)\n";
p_gate += "B8 internal-sql-store private dep resolved for publish\n";
p_gate += "B9 adapters no runtime testkit dependency\n\n";
p_gate += "Also note N1–N5 status briefly.\n";
p_gate += "pass=true only if B1–B6 and B8–B9 are FIXED and verify_ok was true (B7 may be PARTIAL with doc).\n";
p_gate += "If verify failed, pass=false and list failures as blocking.\n";
p_gate += "Write remediation summary append to docs/deep-audit-package-report.md if not already, path in report_path.\n";
p_gate += "Return gate_schema.\n";

let gate = agent(p_gate, #{
    label: "gate:deep-audit-fixes",
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
    write_scratch_file("fix-deep-gate.json", json_encode(gate.output));
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
    log("Remediating remaining blockers: " + json_encode(gate_blocking));
    let p_rem = "";
    p_rem += common;
    p_rem += "REMEDIATE remaining blocking items after gate failed.\n";
    p_rem += "Blocking list: " + json_encode(gate_blocking) + "\n";
    p_rem += "Verify: " + verify_summary + "\n";
    p_rem += "Gate: " + gate_summary + "\n\n";
    p_rem += "Fix every remaining STILL_OPEN/PARTIAL that is required for pass (B1–B6, B8–B9).\n";
    p_rem += "B7 PARTIAL with clear multi-host NTP docs is acceptable if code path is hard.\n";
    p_rem += "Re-run focused tests after fixes. Do not commit.\n";
    p_rem += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_rem, #{
        label: "remediate:deep-audit-blockers",
        capability_mode: "execute",
        output_schema: fix_schema,
    });
    if rem != () && rem.success && rem.output != () {
        log("Remediate: " + rem.output.summary);
        write_scratch_file("fix-deep-remediate.json", json_encode(rem.output));
    }

    // Post-remediate verify
    let p_ver2 = "";
    p_ver2 += "Post-remediation verify at " + root + ".\n";
    p_ver2 += "Run typecheck, bun test, check:boundaries, check:runtime-portability.\n";
    p_ver2 += "Re-check invariants I1–I7 from the fix workflow.\n";
    p_ver2 += "Return verify_schema; ok only if all green.\n";
    let verify2 = agent(p_ver2, #{
        label: "verify2:post-remediate",
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    if verify2 != () && verify2.success && verify2.output != () {
        verify_ok = verify2.output.ok == true;
        verify_summary = verify2.output.summary;
        log("Verify2 ok=" + verify_ok.to_string() + " — " + verify_summary);
        write_scratch_file("fix-deep-verify2.json", json_encode(verify2.output));
    }

    // Final gate
    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation at " + root + ".\n";
    p_gate2 += "Verify: " + verify_summary + "\n";
    p_gate2 += "Re-check B1–B9 FIXED|STILL_OPEN|PARTIAL with evidence. pass only if B1–B6,B8–B9 FIXED and verify ok.\n";
    p_gate2 += "Update docs/deep-audit-package-report.md remediation section.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate2:final",
        capability_mode: "execute",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true && verify_ok;
        gate_summary = gate2.output.summary;
        log("Gate2 pass=" + gate_pass.to_string() + " — " + gate_summary);
        write_scratch_file("fix-deep-gate2.json", json_encode(gate2.output));
    } else {
        gate_pass = false;
    }
}

if gate_pass {
    log("fix-deep-audit-package COMPLETE — PASS");
} else {
    log("fix-deep-audit-package COMPLETE — FAIL: " + gate_summary);
}
