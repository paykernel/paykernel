let meta = #{
    name: "phase-23-diff-critic",
    description: "Read-only critic of uncommitted Phase 23 Tap gateway: mistakes, logic, dead code",
    phases: [
        #{ title: "Review", detail: "parallel scan of uncommitted production src" },
        #{ title: "Verify", detail: "adversarial re-read of each finding" },
        #{ title: "Report", detail: "scratch critic result" },
    ],
    when_to_use: "After Phase 23 @paykernel/gateway-tap lands uncommitted; check the diff before merge",
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
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "confirmed_count": #{ "type": "number" },
        "scratch_path": #{ "type": "string" },
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
    "packages/gateway-tap/src/capabilities.ts",
    "packages/gateway-tap/src/config.ts",
    "packages/gateway-tap/src/factory.ts",
    "packages/gateway-tap/src/gateway.ts",
    "packages/gateway-tap/src/http.ts",
    "packages/gateway-tap/src/index.ts",
    "packages/gateway-tap/src/money.ts",
    "packages/gateway-tap/src/sources.ts",
    "packages/gateway-tap/src/status.ts",
    "packages/gateway-tap/src/types.ts",
    "packages/gateway-tap/src/webhooks.ts",
    "scripts/check-workspace-boundaries.ts",
    "scripts/check-runtime-portability.ts",
];

fn path_allowed(path, allow) {
    if type_of(path) != "string" { return false; }
    for p in allow {
        if path == p { return true; }
    }
    false
}

fn review_prompt(dimension, repo) {
    let p = "Review the UNCOMMITTED Phase 23 Tap gateway production src in " + repo + ". ";
    p += "Dimension: " + dimension + ". ";
    p += "Use git diff HEAD and read_file on packages/gateway-tap/src (not tests, not docs, not dist) plus scripts/check-workspace-boundaries.ts and scripts/check-runtime-portability.ts. ";
    p += "Do not answer from memory. Do not edit.\n";
    p += "Only report NEW mistakes in this uncommitted production code (not style-only, not missing comments).\n";
    p += "Intended behavior (do NOT report as bugs):\n";
    p += "- Extra package @paykernel/gateway-tap; not a BuiltInGatewayName; PaymentClient internals unchanged\n";
    p += "- TAP_CAPABILITIES claims payments/immediateCapture/authorization/partialCapture/refunds/partialRefunds/voids; hostedCheckout/customers/paymentLinks/tokenization/disputes/providerRecurring stay false\n";
    p += "- TapCreatePaymentParams live in the package (tapCustomer, tapSource default src_all, tapPostUrl, tapThreeDSecure, tapMerchantId)\n";
    p += "- createPayment mints ephemeral reference.idempotent + logger.warn when caller omits idempotencyKey\n";
    p += "- capture/void/refund require idempotencyKey before POST\n";
    p += "- HTTP 200 DECLINED (including response code 505) is outcome declined, not a thrown InsufficientFundsError\n";
    p += "- HTTP error code 505 is InsufficientFundsError; DECLINE_CODES 501-516 are CardDeclinedError\n";
    p += "- hashstring HMAC-SHA256 over canonical x_id/x_amount/x_currency/x_gateway_reference/x_payment_reference/x_status/x_created keyed by secret API key; timingSafeEqualHex\n";
    p += "- withRetry on GET and keyed mutations; after exhausted post-submit NetworkError, BaseGateway maps to indeterminate\n";
    p += "- PCI source.card / PAN-shaped source ids rejected; src_all is a redirect source not hostedCheckout\n";
    p += "- paymentsSdk.portable:true wins before gateway-* name exclusion in isPortablePackage\n";
    p += "- Fixtures use 10-digit created strings to avoid testkit 13-digit PAN rules; that fixture choice is not itself a production bug\n";
    p += "Pay extra attention to: unix-seconds vs Date ms for webhook timestamps; isTapRetryableError retrying afterProviderSubmit then empty-queue tests; unused exports; fail-open parse timestamp; money ISO padding vs JSON number.\n";
    p += "file MUST be one of the production paths listed. Report at most 8 concrete {file, issue}. Empty findings is valid only after you read the code.\n";
    p
}

phase("Review");
log("Reviewing uncommitted Phase 23 Tap production src");

let dimensions = [
    "logic mistakes and wrong-null / inverted conditions / timestamp / money mapping",
    "dead code unused symbols unreachable branches leftover flags",
    "fail-open paid or retry-after-submit or webhook hashstring / PCI holes",
];

let jobs = [];
for d in dimensions {
    jobs.push(#{
        prompt: review_prompt(d, root),
        label: "review-p23",
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
        vp += "Adversarially verify this Phase 23 production finding by reading CURRENT source at " + root + ".\n";
        vp += "file=" + f.file + "\nissue=" + f.issue + "\n";
        vp += "Set real=true ONLY with concrete evidence you independently inspected. Default real=false.\n";
        vp += "Intended Phase 23 behavior is NOT a bug. Style-only is NOT a bug. Unused-but-tested helpers are NOT dead.\n";
        vjobs.push(#{
            prompt: vp,
            label: "verify-p23",
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
p_rep += "Write a concise Phase 23 critic report via write_scratch_file name phase-23-diff-critic.md (do NOT create docs/audits).\n";
p_rep += "Read-only critic of uncommitted Phase 23 Tap production src. confirmed_count=" + confirmed.len().to_string() + "\n";
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
p_rep += "Return {ok, summary, confirmed_count, scratch_path}.\n";

let report = agent(p_rep, #{
    label: "report:p23-critic",
    capability_mode: "all",
    output_schema: report_schema,
});

let scratch_path = "";
let confirmed_count = confirmed.len();
if report != () && report.success && report.output != () {
    if report.output.scratch_path != () { scratch_path = report.output.scratch_path; }
}

complete(#{
    summary: "Phase 23 diff critic finished. confirmed=" + confirmed_count.to_string() + ". " + safe_summary(report),
    confirmed_count: confirmed_count,
    scratch_path: scratch_path,
});
