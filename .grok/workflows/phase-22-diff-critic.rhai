let meta = #{
    name: "phase-22-diff-critic",
    description: "Read-only critic of uncommitted Phase 22 review-fix diffs: mistakes, logic, dead code",
    phases: [
        #{ title: "Review", detail: "parallel scan of uncommitted production src" },
        #{ title: "Verify", detail: "adversarial re-read of each finding" },
        #{ title: "Report", detail: "write critic result under docs/audits" },
    ],
    when_to_use: "After phase-22-review-fix-gate lands uncommitted; check the diff before merge",
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

fn safe_summary(r) {
    if r == () { return "no-result"; }
    if !r.success { return "failed"; }
    if r.output == () { return "empty-output"; }
    if r.output.summary == () { return "ok"; }
    r.output.summary
}

let allowed = [
    "packages/core/src/gateways/stripe/stripe.gateway.ts",
    "packages/core/src/hooks/money-identity.ts",
    "packages/core/src/types/payment-event.ts",
];

fn path_allowed(path, allow) {
    if type_of(path) != "string" { return false; }
    for p in allow {
        if path == p { return true; }
    }
    false
}

fn review_prompt(dimension, repo) {
    let p = "Review the UNCOMMITTED Phase 22 review-fix diff in " + repo + ". ";
    p += "Dimension: " + dimension + ". ";
    p += "Use git diff HEAD -- <file> and read_file. Do not answer from memory. Do not edit.\n";
    p += "Only report NEW mistakes in this uncommitted diff (not pre-existing Phase 22 code, not style-only).\n";
    p += "Intended behavior (do NOT report as bugs):\n";
    p += "- getCheckoutSession HTTP 404 is outcome failed via stripeNotFoundFailed (getCustomer parity)\n";
    p += "- CheckoutSession.currency is uppercase ISO when published\n";
    p += "- createCheckoutSession publishes amount_total when currency present; omits rather than invent 0\n";
    p += "- GET payment links expand line_items; money only for exactly one quantity-1 observable item; has_more omits\n";
    p += "- GET missing id/url throws NetworkError WITHOUT afterProviderSubmit; create/deactivate use mapStripePaymentLinkAfterSubmit\n";
    p += "- providerNativeStatus is true/false; domain status is active/inactive (active===true fail-closed)\n";
    p += "- NESTED_IDENTITY_KEYS includes disputes and paymentMethods\n";
    p += "- webhook dashboard charge ids use /^ch_[A-Za-z0-9_]+$/ duplicated in payment-event.ts to avoid importing stripe.gateway\n";
    p += "file MUST be one of: packages/core/src/gateways/stripe/stripe.gateway.ts, packages/core/src/hooks/money-identity.ts, packages/core/src/types/payment-event.ts\n";
    p += "Report at most 8 concrete {file, issue}. Empty findings is valid only after you read the diff.\n";
    p
}

phase("Review");
log("Reviewing uncommitted Phase 22 review-fix production src");

let dimensions = [
    "logic mistakes and wrong-null / inverted conditions / money mapping",
    "dead code unused symbols unreachable branches leftover flags",
    "fail-open paid or invented major 0 or afterProviderSubmit on GET",
];

let jobs = [];
for d in dimensions {
    jobs.push(#{
        prompt: review_prompt(d, root),
        label: "review-p22",
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
        vp += "Adversarially verify this Phase 22 diff finding by reading CURRENT source at " + root + ".\n";
        vp += "file=" + f.file + "\nissue=" + f.issue + "\n";
        vp += "Set real=true ONLY with concrete evidence you independently inspected. Default real=false.\n";
        vp += "Intended review-fix behavior is NOT a bug. Pre-existing Phase 22 code is NOT a bug.\n";
        vjobs.push(#{
            prompt: vp,
            label: "verify-p22",
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
p_rep += "Write " + root + "/docs/audits/phase-22-diff-critic.md\n";
p_rep += "Read-only critic of uncommitted Phase 22 review-fix production src. confirmed_count=" + confirmed.len().to_string() + "\n";
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
p_rep += "If confirmed_count is 0, say no production defects in this diff. Do not invent issues. Read current source. Do not commit.\n";
p_rep += "Return {ok, report_path, summary, confirmed_count}.\n";

let report = agent(p_rep, #{
    label: "report:p22-critic",
    capability_mode: "all",
    output_schema: report_schema,
});

let report_path = "";
let confirmed_count = confirmed.len();
if report != () && report.success && report.output != () {
    if report.output.report_path != () { report_path = report.output.report_path; }
}

complete(#{
    summary: "Phase 22 diff critic finished. confirmed=" + confirmed_count.to_string() + ". " + safe_summary(report),
    confirmed_count: confirmed_count,
    report_path: report_path,
});
