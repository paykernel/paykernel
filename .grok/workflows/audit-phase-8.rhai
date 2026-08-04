let meta = #{
    name: "audit-phase-8",
    description: "Independent deep audit of roadmap Phase 8 runtime portability — closes gap when multi-phase audit agent fails",
    phases: [
        #{ title: "Live-Checks", detail: "typecheck, runtime tests, portability scan, greps" },
        #{ title: "Deep-Audit", detail: "fail-closed roadmap 8.1-8.5 + acceptance vs source" },
        #{ title: "Verify-Findings", detail: "adversarial skeptics on candidate issues" },
        #{ title: "Report", detail: "append Phase 8 independent re-audit to phase-5-8 report" },
    ],
    when_to_use: "Re-audit Phase 8 alone after a multi-phase audit lost the Phase 8 agent, or before shipping runtime changes",
};

let live_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "runtime_tests_ok", "portability_ok", "test_summary", "grep_hits", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "runtime_tests_ok": #{ "type": "boolean" },
        "portability_ok": #{ "type": "boolean" },
        "test_summary": #{ "type": "string" },
        "grep_hits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let phase_audit_schema = #{
    "type": "object",
    "required": [
        "phase", "roadmap_tasks", "acceptance", "blocking", "non_blocking",
        "logic_bugs", "dead_code", "missing_tests", "honest_gaps", "summary"
    ],
    "properties": #{
        "phase": #{ "type": "integer" },
        "roadmap_tasks": #{
            "type": "array",
            "maxItems": 15,
            "items": #{
                "type": "object",
                "required": ["id", "status", "evidence"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "status": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "gap": #{ "type": "string" },
                },
            },
        },
        "acceptance": #{
            "type": "array",
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["id", "status", "evidence"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "status": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "gap": #{ "type": "string" },
                },
            },
        },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "logic_bugs": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "dead_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "missing_tests": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "honest_gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "severity", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "severity": #{ "type": "string" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "file": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "dismissed", "phase8", "report_path", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "dismissed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "phase8": #{ "type": "string" },
        "report_path": #{ "type": "string" },
        "appended": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

// ─── Live checks ─────────────────────────────────────────────────
phase("Live-Checks");
log("Phase 8 live checks in " + root);

let p_live = "";
p_live += "You are the live-check agent for an independent Phase 8 audit of " + root + ".\n";
p_live += "You MAY run shell commands. Do NOT edit production source. Do NOT commit.\n\n";
p_live += "Run and record exit status:\n";
p_live += "1) cd " + root + " && bun run typecheck\n";
p_live += "2) cd " + root + " && bun run check:runtime-portability\n";
p_live += "3) cd " + root + " && bun test packages/core/src/runtime packages/core/src/gateways/gateway-runtime-injection.test.ts scripts/check-runtime-portability.test.ts\n";
p_live += "Capture test_summary like 'N pass, 0 fail, F files'.\n\n";
p_live += "Greps (record hits in grep_hits[]):\n";
p_live += "A) Production banned builtins (exclude *.test.ts):\n";
p_live += "   rg -n \"from ['\\\"]node:|from ['\\\"]bun:|from ['\\\"]cloudflare:\" packages/core/src --glob '!**/*.test.ts'\n";
p_live += "B) PaymentRuntime shape + createPaymentRuntime export\n";
p_live += "C) All 4 gateways use this.fetch or injected fetch for HTTP\n";
p_live += "D) hmacSha256Hex / hmacSha512Hex / timingSafeEqual in stripe/paymob/moyasar webhooks\n";
p_live += "E) combineAbortSignals + clearTimeout/finally on gateway HTTP timeouts\n";
p_live += "F) createPaymentClient runtime + legacy PaymentClientConfig.runtime wiring\n";
p_live += "G) CI has check:runtime-portability and consumer-smoke\n\n";
p_live += "Set ok=true only if typecheck, portability, and runtime tests all pass.\n";
p_live += "Return live_schema fully.\n";

let live = agent(p_live, #{
    label: "live:phase8-only",
    capability_mode: "execute",
    output_schema: live_schema,
});

let live_ok = false;
let live_summary = "live agent failed";
let live_json = "{}";
if live != () && live.success && live.output != () {
    live_ok = live.output.ok == true;
    live_summary = live.output.summary;
    live_json = json_encode(live.output);
    log("Live ok=" + live_ok.to_string() + " — " + live_summary);
    write_scratch_file("audit-p8-live.json", live_json);
} else {
    log("Live checks agent failed");
}

// ─── Deep audit ──────────────────────────────────────────────────
phase("Deep-Audit");
log("Deep auditing Phase 8 against roadmap");

let p_audit = "";
p_audit += "Repo root: " + root + "\n";
p_audit += "You are a FAIL-CLOSED independent Phase 8 auditor. Missing evidence = gap.\n";
p_audit += "Do NOT trust phase-8-gate-report alone — re-read source with read_file/grep.\n";
p_audit += "Do NOT edit. Do NOT commit. Live: " + live_summary + "\n\n";
p_audit += "Read roadmap.md '# Phase 8 — Runtime Portability' (tasks 8.1-8.5, acceptance).\n";
p_audit += "Optionally read packages/core/docs/baseline/phase-8-gate-report.md and docs/runtime.md (verify claims).\n\n";
p_audit += "Inspect deeply:\n";
p_audit += "- packages/core/src/runtime/payment-runtime.ts, crypto-portable.ts, crypto-provider.ts, clock.ts, abort.ts, index.ts + tests\n";
p_audit += "- create-payment-client.ts, client.ts runtime config, gateway-context.ts, factories.ts\n";
p_audit += "- base.gateway.ts signal strip/reattach; all 4 gateway HTTP + verifyWebhook crypto paths\n";
p_audit += "- gateway-runtime-injection.test.ts\n";
p_audit += "- scripts/check-runtime-portability.ts, scripts/consumer-smoke.mjs, docs/workspace-boundaries.md\n";
p_audit += "- .github/workflows/ci.yml engines and matrix\n";
p_audit += "- packages/core/docs/runtime.md, behavioral-contracts if §7 exists\n\n";
p_audit += "For each task 8.1-8.5 and acceptance A1-A3 set status PASS | PARTIAL | FAIL | N/A.\n";
p_audit += "blocking = correctness/security/contract breaks (node: in production, fetch ignored, webhook needs node:crypto,\n";
p_audit += "  AbortSignal stripped forever, timeout leaks, non-portable published entry).\n";
p_audit += "honest_gaps = intentional/documented limits (Deno SKIP, aspirational matrix).\n";
p_audit += "Cite file paths and symbols. phase=8. Return phase_audit_schema fully.\n";

let audit = agent(p_audit, #{
    label: "audit:phase8-deep",
    capability_mode: "execute",
    output_schema: phase_audit_schema,
});

let candidate_findings = [];
let audit_json = "{}";
let phase8_summary = "phase 8 audit missing";

if audit != () && audit.success && audit.output != () {
    audit_json = json_encode(audit.output);
    phase8_summary = audit.output.summary;
    log("Phase 8 audit: " + phase8_summary);
    write_scratch_file("audit-p8-deep.json", audit_json);
    if audit.output.blocking != () {
        let bi = 0;
        while bi < audit.output.blocking.len() {
            candidate_findings.push("P8-BLOCK: " + audit.output.blocking[bi]);
            bi += 1;
        }
    }
    if audit.output.logic_bugs != () {
        let li = 0;
        while li < audit.output.logic_bugs.len() {
            candidate_findings.push("P8-LOGIC: " + audit.output.logic_bugs[li]);
            li += 1;
        }
    }
    if audit.output.dead_code != () {
        let di = 0;
        while di < audit.output.dead_code.len() && di < 6 {
            candidate_findings.push("P8-DEAD: " + audit.output.dead_code[di]);
            di += 1;
        }
    }
    if audit.output.non_blocking != () {
        let ni = 0;
        while ni < audit.output.non_blocking.len() && ni < 8 {
            candidate_findings.push("P8-NONBLOCK: " + audit.output.non_blocking[ni]);
            ni += 1;
        }
    }
} else {
    log("Phase 8 deep audit agent failed");
    candidate_findings.push("META: Phase 8 deep audit agent failed — incomplete independent coverage");
}

// Cap verify panel
let MAX_VERIFY = 16;
if candidate_findings.len() > MAX_VERIFY {
    log("Truncating candidates " + candidate_findings.len().to_string() + " -> " + MAX_VERIFY.to_string());
    let trimmed = [];
    let ti = 0;
    while ti < MAX_VERIFY {
        trimmed.push(candidate_findings[ti]);
        ti += 1;
    }
    candidate_findings = trimmed;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify-Findings");
log("Verify panel size=" + candidate_findings.len().to_string());

let confirmed_blocking = [];
let confirmed_non_blocking = [];
let dismissed = [];

if candidate_findings.len() == 0 {
    if !live_ok {
        confirmed_blocking.push("Live checks failed: " + live_summary);
    }
} else {
    let vjobs = [];
    let fi = 0;
    while fi < candidate_findings.len() {
        let finding = candidate_findings[fi];
        let p_v = "";
        p_v += "Adversarially verify this Phase 8 finding for " + root + ".\n";
        p_v += "Finding: " + json_encode(finding) + "\n";
        p_v += "SKEPTIC default real=false. Prove with read_file/grep. Do NOT edit.\n";
        p_v += "blocking = node: in production portable entry, fetch ignored, webhook node:crypto required,\n";
        p_v += "  AbortSignal not honored, timeout leak, acceptance broken.\n";
        p_v += "non_blocking = Deno SKIP, CI matrix incomplete, docs, dead code, intentional limits.\n";
        p_v += "Return verdict_schema.\n";
        vjobs.push(#{
            prompt: p_v,
            label: "verify-p8-" + fi.to_string(),
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
        fi += 1;
    }
    let verdicts = parallel(vjobs);
    let vi = 0;
    while vi < verdicts.len() {
        let v = verdicts[vi];
        let orig = candidate_findings[vi];
        if v != () && v.success && v.output != () && v.output.real == true
            && v.output.evidence != () && v.output.evidence != "" {
            let line = orig + " || " + v.output.reason + " || " + v.output.evidence;
            if v.output.severity == "blocking" {
                confirmed_blocking.push(line);
            } else {
                confirmed_non_blocking.push(line);
            }
        } else {
            let why = "no evidence";
            if v != () && v.success && v.output != () && v.output.reason != () {
                why = v.output.reason;
            }
            dismissed.push(orig + " || dismissed: " + why);
        }
        vi += 1;
    }
    log("blocking=" + confirmed_blocking.len().to_string()
        + " non_blocking=" + confirmed_non_blocking.len().to_string()
        + " dismissed=" + dismissed.len().to_string());
}

if !live_ok {
    confirmed_blocking.push("LIVE-CHECKS-FAILED: " + live_summary);
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
log("Appending Phase 8 independent re-audit to report");

let findings = #{
    live_ok: live_ok,
    live_summary: live_summary,
    live: live_json,
    audit: audit_json,
    confirmed_blocking: confirmed_blocking,
    confirmed_non_blocking: confirmed_non_blocking,
    dismissed: dismissed,
};

let p_report = "";
p_report += "Update the Phase 5–8 audit report at " + root + "/packages/core/docs/baseline/phase-5-8-audit-report.md\n";
p_report += "You MAY edit ONLY that markdown file. Do NOT change production source. Do NOT commit.\n\n";
p_report += "INPUTS:\n" + json_encode(findings) + "\n\n";
p_report += "Phase 8 deep audit summary: " + phase8_summary + "\n\n";
p_report += "ACTIONS:\n";
p_report += "1) Read the existing phase-5-8-audit-report.md fully.\n";
p_report += "2) APPEND a new top-level section (before final '## Verdict' if present, or at end):\n";
p_report += "   ## Phase 8 independent re-audit (dedicated pass)\n";
p_report += "   Include: date, why this pass exists (prior multi-phase agent network failure),\n";
p_report += "   live commands re-run, tasks 8.1-8.5 table, acceptance A1-A3 table,\n";
p_report += "   confirmed blocking (empty if none), confirmed non-blocking, dismissed process notes,\n";
p_report += "   and a clear Phase 8 verdict PASS/FAIL.\n";
p_report += "3) Update the overall Phase 8 status note in the report if it said 'agent not present' —\n";
p_report += "   now state independent re-audit completed with pass/fail.\n";
p_report += "4) Keep overall monorepo pass rule: pass=true only if live_ok AND confirmed_blocking empty.\n";
p_report += "report_path = packages/core/docs/baseline/phase-5-8-audit-report.md\n";
p_report += "appended=true if file was updated. phase8 short status string.\n";
p_report += "Return report_schema.\n";

let report = agent(p_report, #{
    label: "report:phase8-reaudit",
    capability_mode: "all",
    output_schema: report_schema,
});

let pass = live_ok && confirmed_blocking.len() == 0;
let report_path = "packages/core/docs/baseline/phase-5-8-audit-report.md";
let final_summary = "report agent failed";
let final_blocking = confirmed_blocking;
let final_non_blocking = confirmed_non_blocking;
let final_dismissed = dismissed;
let appended = false;

if report != () && report.success && report.output != () {
    if report.output.pass == false {
        pass = false;
    }
    if confirmed_blocking.len() > 0 || !live_ok {
        pass = false;
    } else if report.output.pass == true {
        pass = true;
    }
    if report.output.report_path != () {
        report_path = report.output.report_path;
    }
    if report.output.phase8 != () {
        phase8_summary = report.output.phase8;
    }
    if report.output.appended == true {
        appended = true;
    }
    final_summary = report.output.summary;
    if report.output.blocking != () {
        final_blocking = report.output.blocking;
    }
    if report.output.non_blocking != () {
        final_non_blocking = report.output.non_blocking;
    }
    if report.output.dismissed != () {
        final_dismissed = report.output.dismissed;
    }
    log("Report pass=" + pass.to_string() + " appended=" + appended.to_string());
    write_scratch_file("audit-p8-report.json", json_encode(report.output));
} else {
    final_summary = "Report agent failed; pass derived from live_ok && empty blocking";
    pass = live_ok && confirmed_blocking.len() == 0;
}

complete(#{
    phase: 8,
    pass: pass,
    live_ok: live_ok,
    blocking_count: final_blocking.len(),
    non_blocking_count: final_non_blocking.len(),
    dismissed_count: final_dismissed.len(),
    blocking: final_blocking,
    non_blocking: final_non_blocking,
    dismissed: final_dismissed,
    phase8: phase8_summary,
    report_path: report_path,
    appended: appended,
    live_summary: live_summary,
    summary: final_summary,
});
