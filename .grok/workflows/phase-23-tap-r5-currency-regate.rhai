let meta = #{
    name: "phase-23-tap-r5-currency-regate",
    description: "Verify and adversarially re-gate TAP-CURRENCY-MATCH after the r5 leftover (refund mismatch test)",
    phases: [
        #{ title: "Verify", detail: "gateway-tap tests plus currency-match invariants" },
        #{ title: "Gate", detail: "fail-closed TAP-CURRENCY-MATCH on capture AND refund" },
    ],
    when_to_use: "After phase-23-tap-r5-fix-gate failed closed on TAP-CURRENCY-MATCH missing refund test",
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
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

phase("Verify");
log("Re-verify TAP-CURRENCY-MATCH in " + root);

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root:\n";
p_v += "1) bun test packages/gateway-tap/src/gateway.test.ts\n";
p_v += "2) bun test packages/gateway-tap\n";
p_v += "Paste fail lines in failures[]. Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}.\n";
p_v += "typecheck_ok may be true without a separate tsc run if tests include type-bearing execution; still run bun test packages/gateway-tap.\n";
p_v += "ok only if tests pass AND gateway.test.ts has BOTH capture and refund currency mismatch tests that expect InvalidRequestError and no POST.\n";

let verify = agent(p_v, #{
    label: "verify:tap-r5-currency",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

phase("Gate");
log("Adversarial TAP-CURRENCY-MATCH re-gate");

let p_g = "";
p_g += "READ-ONLY fail-closed gate. Repo: " + root + "\n";
p_g += "Use read_file and grep. Do not edit. pass=true only if ALL of these have file:line evidence:\n";
p_g += "1) capturePayment calls assertCurrencyMatch before POST /charges (gateway.ts).\n";
p_g += "2) refundPayment calls assertCurrencyMatch before POST /refunds (gateway.ts).\n";
p_g += "3) gateway.test.ts has 'rejects capture when caller currency does not match authorize currency' and it asserts InvalidRequestError and no POST /charges.\n";
p_g += "4) gateway.test.ts has 'rejects refund when caller currency does not match charge currency' and it asserts InvalidRequestError and no POST /refunds.\n";
p_g += "If any is missing, pass=false and put the gap in blocking[]. Return {pass, blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:tap-r5-currency",
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
let final_pass = gate_pass == true && verify_ok == true;

let blocking_txt = "";
if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
    for b in gate.output.blocking {
        blocking_txt += b + "\n";
    }
}

let report_md = "# TAP-CURRENCY-MATCH re-gate\n\n";
report_md += "final_pass=" + final_pass.to_string() + "\n";
report_md += "verify=" + safe_summary(verify) + "\n";
report_md += "gate=" + safe_summary(gate) + "\n";
report_md += "blocking:\n" + blocking_txt + "\n";
let report_path = write_scratch_file("phase-23-tap-r5-currency-regate.md", report_md);

complete(#{
    summary: "TAP-CURRENCY-MATCH re-gate. final_pass=" + final_pass.to_string() + " verify=" + safe_summary(verify) + " gate=" + safe_summary(gate),
    final_pass: final_pass,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    path: report_path,
});
