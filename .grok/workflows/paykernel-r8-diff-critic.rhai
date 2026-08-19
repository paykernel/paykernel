let meta = #{
    name: "paykernel-r8-diff-critic",
    description: "Read-only critic of uncommitted r8 session-audit diffs: mistakes, logic, dead code",
    phases: [
        #{ title: "Review", detail: "parallel scan of r8 production src" },
        #{ title: "Verify", detail: "adversarial re-read of each finding" },
        #{ title: "Report", detail: "write critic result under docs/audits" },
    ],
    when_to_use: "After session-audit-r8-fix-gate lands uncommitted; check the diff before merge",
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["file", "issue"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["ok", "report_path", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "report_path": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "confirmed_count": #{ "type": "number" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

let allowed = [
    "packages/core/src/utils/idempotency.ts",
    "packages/core/src/utils/money.ts",
    "packages/core/src/utils/retry.ts",
    "packages/core/src/types/operation-result.ts",
    "packages/core/src/types/webhook-event-map.ts",
    "packages/core/src/gateways/paymob/paymob.gateway.ts",
    "packages/core/src/gateways/paypal/paypal.gateway.ts",
    "packages/webhooks/src/engine.ts",
    "packages/webhooks/src/memory-store.ts",
    "packages/reconciliation/src/scheduler.ts",
    "packages/reconciliation/src/memory-store.ts",
    "packages/testkit/src/memory/memory-stores.ts",
    "packages/store-redis/src/scripts/webhook-inbox.lua.ts",
    "packages/store-redis/src/stores/webhook-inbox-store.ts",
    "packages/store-sqlite/src/drivers/bun.ts",
    "packages/store-sqlite/src/pragmas.ts",
    "examples/checkout-kernel/src/handlers.ts",
];

fn path_allowed(path, allow) {
    if type_of(path) != "string" { return false; }
    for p in allow {
        if path == p { return true; }
    }
    false
}

fn review_prompt(dimension, repo) {
    let p = "Review the UNCOMMITTED r8 PayKernel session-audit diff. ";
    p += "Dimension: " + dimension + ". ";
    p += "Repo: " + repo + ". Use git diff HEAD -- <file> and read_file. Do not answer from memory. Do not edit.\n";
    p += "Only report NEW mistakes in the r8 edits (not pre-existing r7 code, not style).\n";
    p += "Intended r8 behavior (do NOT report these as bugs):\n";
    p += "- fingerprint hashes sensitive leaves ([REDACTED:sha256]) so billing/otp/13-digit ids differ; allow-listed ids not PAN-hashed; logs stay constant [REDACTED]\n";
    p += "- setup_completed infers succeeded (not paid); bare failed without decline infers failed\n";
    p += "- reclaim uses ifMatchPayloadHash; heartbeat closed flag; memory get() read-only\n";
    p += "- Redis empty ifMatch rejected; list wipe uses issuer clock; sqlite open requires explicit path\n";
    p += "- PayPal unknown refund 200 is pending; Paymob redirect terminals are processing\n";
    p += "- amount-only refund only when fromStatus undefined; trailing-zero money accepted; retry NaN sanitized\n";
    p += "C1 and r7 S19 closes stay closed.\n";
    p += "file MUST be a production src path under packages/ or examples/checkout-kernel/src (not tests, not docs).\n";
    p += "Report at most 8 concrete {file, issue}. Empty is valid only after you read the diff.\n";
    p
}

phase("Review");
log("Reviewing r8 uncommitted production src");

let dimensions = [
    "logic mistakes and off-by-one / wrong-null / inverted conditions",
    "dead code unused symbols unreachable branches leftover TODOs",
    "fence/idempotency/lease regressions introduced by r8",
];

let jobs = [];
for d in dimensions {
    jobs.push(#{
        prompt: review_prompt(d, root),
        label: "review:" + d.sub_string(0, 24),
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}
let results = parallel(jobs);

let findings = [];
if results != () {
    for r in results {
        if r != () && r.success && r.output != () && r.output.findings != () {
            for f in r.output.findings {
                if f != () && path_allowed(f.file, allowed) {
                    findings.push(f);
                }
            }
        }
    }
}
log(findings.len().to_string() + " in-scope findings after path filter");

phase("Verify");
let confirmed = [];
if findings.len() == 0 {
    log("No review findings to verify");
} else {
    let vjobs = [];
    for f in findings {
        let vp = "";
        vp += "Adversarially verify this r8-diff finding by reading CURRENT source at " + root + ".\n";
        vp += "file=" + f.file + "\nissue=" + f.issue + "\n";
        vp += "Set real=true ONLY with concrete evidence you independently inspected. Default real=false.\n";
        vp += "Intended r8 behavior listed in the audit is NOT a bug. Pre-existing r7 code is NOT a bug.\n";
        vjobs.push(#{
            prompt: vp,
            label: "verify:" + f.file,
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
    }
    let verdicts = parallel(vjobs);
    let i = 0;
    if verdicts != () {
        while i < verdicts.len() {
            let v = verdicts[i];
            if v != () && v.success && v.output != () && v.output.real == true
                && v.output.evidence != () && v.output.evidence != "" {
                confirmed.push(findings[i]);
            }
            i += 1;
        }
    }
    log(confirmed.len().to_string() + "/" + findings.len().to_string() + " survived verification");
}

phase("Report");
let p_rep = "";
p_rep += "Write " + root + "/docs/audits/session-audit-r8-diff-critic-2026-08-19.md\n";
p_rep += "Read-only critic of uncommitted r8 diff. confirmed_count=" + confirmed.len().to_string() + "\n";
p_rep += "Confirmed findings:\n";
if confirmed != () {
    let ci = 0;
    while ci < confirmed.len() {
        let cf = confirmed[ci];
        if cf != () {
            p_rep += "- " + cf.file + ": " + cf.issue + "\n";
        }
        ci += 1;
    }
}
p_rep += "If none, say so. Do not invent. Return {ok, report_path, summary, confirmed_count}.\n";

let report_agent = agent(p_rep, #{
    label: "report:write-critic",
    capability_mode: "read-write",
    output_schema: report_schema,
});
if report_agent != () && report_agent.success && report_agent.output != () && report_agent.output.summary != () {
    log("Report: " + report_agent.output.summary);
}

complete(#{
    confirmed_count: confirmed.len(),
    finding_count: findings.len(),
});
