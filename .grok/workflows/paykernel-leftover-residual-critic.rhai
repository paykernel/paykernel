let meta = #{
    name: "paykernel-leftover-residual-critic",
    description: "Read-only critic of leftover residual fixes: bugs, logic, dead code",
    phases: [
        #{ title: "Review", detail: "parallel scan of leftover residual files" },
        #{ title: "Verify", detail: "adversarial re-read of each finding" },
    ],
    when_to_use: "After leftover residual S19-SQLITE-ENGINES / S19-CKO-UNEXPANDED / S19-EPHEMERAL-KEY edits",
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

let allowed = [
    "packages/core/src/gateways/stripe/stripe.gateway.ts",
    "packages/core/src/gateways/paypal/paypal.gateway.ts",
    "packages/store-sqlite/src/drivers/node.ts",
    "packages/store-sqlite/package.json",
    "packages/core/docs/behavioral-contracts.md",
    "packages/core/docs/paypal.md",
    "packages/core/docs/stripe.md",
    "packages/store-sqlite/docs/drivers.md",
    "packages/store-sqlite/README.md",
];

fn path_allowed(path, allow) {
    if type_of(path) != "string" { return false; }
    for p in allow {
        if path == p { return true; }
    }
    false
}

fn review_prompt(dimension) {
    let p = "You are reviewing leftover residual PayKernel edits (not the whole r7 tree). ";
    p += "Dimension: " + dimension + ". ";
    p += "Repo root: /home/shahin/Documents/projects/personal/packages/paykernel. ";
    p += "READ these files with read_file/grep before answering. Do not answer from memory. ";
    p += "Files: packages/core/src/gateways/stripe/stripe.gateway.ts (stripeCheckoutPaidSessionStatus, resolveStripeIdempotencyKey); ";
    p += "packages/core/src/gateways/paypal/paypal.gateway.ts (getRequestId, capture/refund/void/authorize callers); ";
    p += "packages/store-sqlite/package.json (engines.node vs paymentsSdk.nodeSqliteMinimum); ";
    p += "packages/store-sqlite/src/drivers/node.ts NODE_SQLITE_SUPPORT; ";
    p += "packages/core/docs/behavioral-contracts.md PayPal and Stripe sections; ";
    p += "packages/core/docs/paypal.md and packages/core/docs/stripe.md idempotency. ";
    p += "Intended leftover behavior: classic Checkout string payment_intent fail-closes to processing (C1 PI amount_received paid is unchanged); ";
    p += "PayPal/Stripe capture refund void authorize and Stripe createCheckoutSession require caller idempotencyKey before POST; ";
    p += "createPayment may mint ephemeral key and warn; store-sqlite engines.node stays >=18; /node needs 22.5.0. ";
    p += "Report at most 8 concrete leftover-residual findings as {file, issue}. ";
    p += "file MUST be one of the paths listed above. Empty findings is valid only after you read the files. ";
    p += "Do not invent issues outside leftover residual. Do not edit files.";
    p
}

phase("Review");
let dimensions = [
    "correctness bugs and fail-open paid or duplicate-mutation logic",
    "dead code unused branches unused exports and stale docs that contradict source",
    "logical problems around ephemeral-vs-required idempotency keys",
];
let jobs = [];
for d in dimensions {
    jobs.push(#{
        prompt: review_prompt(d),
        label: "review-leftover",
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}
let results = parallel(jobs);

let findings = [];
let dropped = 0;
for r in results {
    if r != () && r.success && r.output.findings != () {
        for f in r.output.findings {
            if f != () && path_allowed(f.file, allowed) && type_of(f.issue) == "string" && f.issue != "" {
                findings.push(f);
            } else {
                dropped += 1;
            }
        }
    }
}
if dropped > 0 {
    log("dropped " + dropped.to_string() + " out-of-scope leftover findings");
}
if findings.len() == 0 {
    complete(#{ summary: "No leftover residual findings.", confirmed: [] });
}

phase("Verify");
let vjobs = [];
for f in findings {
    let vp = "Adversarially verify this leftover-residual finding by reading the shipped file. ";
    vp += "Repo: /home/shahin/Documents/projects/personal/packages/paykernel. ";
    vp += "File: " + f.file + ". Issue: " + f.issue + ". ";
    vp += "Use read_file/grep. Set real=true only with concrete evidence from current source. ";
    vp += "Default real=false if the issue is stale docs already fixed, intended fail-closed behavior, or not leftover residual. ";
    vp += "Do not edit files.";
    vjobs.push(#{
        prompt: vp,
        label: "verify-leftover",
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
}
let verdicts = parallel(vjobs);

let confirmed = [];
let i = 0;
for v in verdicts {
    if v != () && v.success && v.output.real == true
        && v.output.evidence != () && v.output.evidence != "" {
        confirmed.push(#{
            file: findings[i].file,
            issue: findings[i].issue,
            evidence: v.output.evidence,
        });
    }
    i += 1;
}
log(confirmed.len().to_string() + "/" + findings.len().to_string() + " leftover findings survived verification");
complete(#{
    summary: confirmed.len().to_string() + " confirmed leftover residual findings",
    confirmed: confirmed,
});
