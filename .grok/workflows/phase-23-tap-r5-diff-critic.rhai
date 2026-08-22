let meta = #{
    name: "phase-23-tap-r5-diff-critic",
    description: "Read-only critic of the uncommitted gateway-tap r5 source for mistakes, logical problems, and dead code",
    phases: [
        #{ title: "Critic", detail: "mistakes, logic, dead code on packages/gateway-tap/src" },
        #{ title: "Gate", detail: "adversarial fail-closed" },
    ],
    when_to_use: "After Tap r5 fix-gate landed in the working tree; check leftover mistakes before commit",
};

let critic_schema = #{
    "type": "object",
    "required": ["blocking", "dead_code", "non_blocking", "summary"],
    "properties": #{
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "dead_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
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

phase("Critic");
log("Criticizing uncommitted gateway-tap r5 source at " + root);

let p = "";
p += "READ-ONLY. Repo: " + root + "\n";
p += "Use read_file and grep on packages/gateway-tap/src. Do not edit. Do not answer from memory.\n";
p += "Look for mistakes, logical problems, unused imports, unused functions, unused params, unreachable branches, duplicate checks, wrong Tap status models.\n";
p += "Known intended behavior (do not flag as bugs):\n";
p += "- GET CAPTURED authorize does not POST /charges; maps paid and keeps authorizationId.\n";
p += "- AUTHORIZED capture POSTs /charges with threeDSecure true and customer_initiated true.\n";
p += "- VOID capture throws. ACCEPTED refund is pending.\n";
p += "- Mutating 2xx missing status is NetworkError afterProviderSubmit / indeterminate.\n";
p += "- Inline firstName lastName email required non-empty.\n";
p += "- FAILED + response 501-516 is declined.\n";
p += "- 1126 and 1149 are InvalidRequestError.\n";
p += "- Capture/refund currency mismatch throws before POST.\n";
p += "Blocking = correctness/money bugs. dead_code = unused symbols or unreachable checks still in src. Empty arrays OK only after reading gateway.ts status.ts http.ts types.ts config.ts sources.ts webhooks.ts money.ts.\n";
p += "Pay extra attention to: duplicate tapStatusMissing after assertTapSuccessBody; GET missing status retried as NetworkError; copyTapConfig secretKey not trimmed vs CHANGELOG TAP-KEY-TRIM; refundReason length vs CHANGELOG TAP-REASON-LENGTH.\n";
p += "Return {blocking, dead_code, non_blocking, summary}.\n";

let critic = agent(p, #{
    label: "critic:tap-r5-diff",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

phase("Gate");
let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Re-read packages/gateway-tap/src. pass=true only if blocking[] from an independent read is empty: no money bugs, no unused unreachable status checks that lie, GET missing status must not look like a successful capture, CAPTURED must not POST /charges, VOID not capturable.\n";
p_g += "Critic summary: " + safe_summary(critic) + "\n";
p_g += "Do not trust the critic. Return {pass, blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:tap-r5-diff",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
log("Gate: " + safe_summary(gate));

let pass = false;
if gate != () && gate.success && gate.output != () && gate.output.pass == true {
    pass = true;
}

complete(#{
    summary: "Tap r5 diff critic. pass=" + pass.to_string() + " critic=" + safe_summary(critic) + " gate=" + safe_summary(gate),
    pass: pass,
});
