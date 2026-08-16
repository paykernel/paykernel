let meta = #{
    name: "paykernel-deep-audit",
    description: "Deep production audit of PayKernel monorepo for logic bugs, money correctness, webhooks, stores, routing",
    phases: [
        #{ title: "Map", detail: "inventory packages and critical surfaces" },
        #{ title: "Audit", detail: "parallel domain deep-audits (read-only)" },
        #{ title: "Recheck", detail: "historical audit findings still present?" },
        #{ title: "Verify", detail: "typecheck + tests baseline" },
        #{ title: "Synthesize", detail: "dedupe, severity, evidence" },
        #{ title: "Gate", detail: "adversarial independent review of top findings" },
        #{ title: "Report", detail: "write audit report under docs/audits" },
    ],
    when_to_use: "Fresh deep audit of PayKernel for mistakes, logical problems, and performance issues (no auto-fix)",
};

let map_schema = #{
    "type": "object",
    "required": ["packages", "critical_paths", "summary"],
    "properties": #{
        "packages": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "critical_paths": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let audit_schema = #{
    "type": "object",
    "required": ["stream", "findings", "summary"],
    "properties": #{
        "stream": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 25,
            "items": #{
                "type": "object",
                "required": ["id", "severity", "title", "evidence", "impact"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "impact": #{ "type": "string" },
                    "suggested_fix": #{ "type": "string" },
                },
            },
        },
        "clean_areas": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let recheck_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "summary": #{ "type": "string" },
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

let synth_schema = #{
    "type": "object",
    "required": ["p0", "p1", "p2", "p3", "summary", "verdict"],
    "properties": #{
        "p0": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "p1": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "p2": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "p3": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "false_positives_dropped": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "verdict": #{ "type": "string" },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "disputed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
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

// ─── Map ──────────────────────────────────────────────────────────
phase("Map");
log("Mapping PayKernel monorepo at " + root);

let p_map = "";
p_map += "Repo root: " + root + "\n";
p_map += "Read-only. Map the PayKernel monorepo for a deep production audit.\n";
p_map += "List workspace packages (packages/* + internal/*), note package names from package.json.\n";
p_map += "List critical_paths: gateway impls, client, hooks, money, webhooks engine, store contracts,\n";
p_map += "sql-foundation claims, reconciliation, routing, idempotency, validation.\n";
p_map += "Summarize architecture in 3-5 sentences. Do not invent paths.\n";
p_map += "Return packages[], critical_paths[], summary.\n";

let map_r = agent(p_map, #{
    label: "map:paykernel",
    capability_mode: "read-only",
    output_schema: map_schema,
});
if map_r != () && map_r.success && map_r.output != () {
    log("Map: " + map_r.output.summary);
}

// ─── Parallel domain audits ───────────────────────────────────────
phase("Audit");
log("Parallel deep audits across PayKernel domains");

let common = "";
common += "Repo: " + root + " (PayKernel monorepo, Bun + TypeScript).\n";
common += "READ-ONLY deep production audit. Use read_file, grep, list_dir, shell for rg/find only.\n";
common += "Do NOT edit files. Do NOT commit.\n";
common += "Focus on REAL bugs: money correctness, status mapping lies, webhook forgery/replay, race conditions,\n";
common += "idempotency holes, dual-write inconsistency, false paid/success, partial capture/refund math,\n";
common += "authz/signature verification, unsafe defaults, dead code that lies to callers, docs vs code mismatches that cause money bugs.\n";
common += "Severity: P0=money/security production incident risk; P1=correctness bug users hit; P2=edge/docs/API footgun; P3=nit.\n";
common += "Every finding MUST have file:line or function evidence from actual code. No speculation.\n";
common += "Prefer fewer high-confidence findings over many weak ones.\n";
common += "Return stream, findings[{id,severity,title,evidence,impact,suggested_fix}], clean_areas[], summary.\n";
common += "id format: STREAM-N e.g. STRIPE-1, CORE-2.\n";

let dims = [];

let d_core = common;
d_core += "STREAM: CORE — packages/core orchestration.\n";
d_core += "Audit thoroughly:\n";
d_core += "- packages/core/src/client.ts, create-payment-client.ts\n";
d_core += "- packages/core/src/gateways/base.gateway.ts\n";
d_core += "- packages/core/src/hooks/hooks.manager.ts, hooks.types.ts\n";
d_core += "- packages/core/src/errors.ts\n";
d_core += "- packages/core/src/types/** validation schemas\n";
d_core += "- packages/core/src/runtime/** (abort, operation-context, payment-runtime, crypto)\n";
d_core += "Look for: after-hook money mutation, proceed:false after capture, hook composition double-run,\n";
d_core += "error swallowing, validation gaps (non-finite amounts, javascript: URLs, empty idempotency keys),\n";
d_core += "success:true with failed status, identity field freeze gaps, abort/race handling.\n";
dims.push(#{ prompt: d_core, label: "audit:core", capability_mode: "read-only", output_schema: audit_schema });

let d_money = common;
d_money += "STREAM: MONEY — money, currency, idempotency, retry, logger.\n";
d_money += "Audit:\n";
d_money += "- packages/core/src/utils/money.ts (+ tests)\n";
d_money += "- packages/core/src/utils/currency.ts\n";
d_money += "- packages/core/src/utils/idempotency.ts\n";
d_money += "- packages/core/src/utils/retry.ts\n";
d_money += "- packages/core/src/utils/logger.ts\n";
d_money += "Look for: wrong decimal tables (ISK/MGA etc), charge limit bugs, fingerprint collisions,\n";
d_money += "retry on non-idempotent ops, redaction holes, zero-decimal mishandling, three-decimal rules.\n";
dims.push(#{ prompt: d_money, label: "audit:money", capability_mode: "read-only", output_schema: audit_schema });

let d_stripe = common;
d_stripe += "STREAM: STRIPE — packages/core/src/gateways/stripe/**\n";
d_stripe += "Deep-read stripe.gateway.ts status maps, capture/refund/void, webhooks, verifyWebhook,\n";
d_stripe += "checkout/subscription mapping, amount comparisons (amount vs amount_received vs amount_captured),\n";
d_stripe += "partial capture, refunded status, timestamp tolerance, enforceChargeLimits coverage.\n";
d_stripe += "Cross-check against tests for false confidence.\n";
dims.push(#{ prompt: d_stripe, label: "audit:stripe", capability_mode: "read-only", output_schema: audit_schema });

let d_paypal = common;
d_paypal += "STREAM: PAYPAL — packages/core/src/gateways/paypal/**\n";
d_paypal += "Deep-read verifyWebhook/verifyWebhookAsync raw body handling, capture/refund/authorize,\n";
d_paypal += "final_capture defaults, success flags vs status, webhook id extraction, returnUrl/cancelUrl,\n";
d_paypal += "transmission-time replay window, soft-fail verify paths.\n";
dims.push(#{ prompt: d_paypal, label: "audit:paypal", capability_mode: "read-only", output_schema: audit_schema });

let d_paymob = common;
d_paymob += "STREAM: PAYMOB — packages/core/src/gateways/paymob/**\n";
d_paymob += "Deep-read mapTransactionStatus (auth vs capture vs refund order), dual-write paths,\n";
d_paymob += "HMAC verification, amount field choice (amount_cents vs captured_amount),\n";
d_paymob += "card token webhooks, payment_type AUTH, refunded_amount without flags.\n";
dims.push(#{ prompt: d_paymob, label: "audit:paymob", capability_mode: "read-only", output_schema: audit_schema });

let d_moyasar = common;
d_moyasar += "STREAM: MOYASAR — packages/core/src/gateways/moyasar/**\n";
d_moyasar += "Deep-read status maps (verified, failed, 3ds), capture/refund/void idempotency requirements,\n";
d_moyasar += "webhook secret_token retention, source validation (creditcard), success vs status coupling.\n";
dims.push(#{ prompt: d_moyasar, label: "audit:moyasar", capability_mode: "read-only", output_schema: audit_schema });

let d_wh = common;
d_wh += "STREAM: WEBHOOKS — packages/webhooks/** + core webhook event types if any.\n";
d_wh += "Audit engine.ts modes, concurrency, crash recovery, event-key, sanitize, store contracts.\n";
d_wh += "Look for: double delivery, lost events, payload conflict handling, backoff issues,\n";
d_wh += "claim/lease races, secret leakage in sanitize, at-least-once vs exactly-once lies.\n";
dims.push(#{ prompt: d_wh, label: "audit:webhooks", capability_mode: "read-only", output_schema: audit_schema });

let d_store = common;
d_store += "STREAM: STORES — store-contracts, sql-foundation, internal/sql-store, store-postgres,\n";
d_store += "store-redis, store-sqlite, store-turso, store-d1, store-durable-objects.\n";
d_store += "Focus on: atomic claims, fencing tokens, dual-write / partial failure, migration safety,\n";
d_store += "idempotency store races, Redis/D1/DO correctness gaps, contract vs adapter divergence,\n";
d_store += "false success on failed writes, discovery bugs. Sample each adapter's claim/write path.\n";
d_store += "Prioritize bugs that cause lost money state or double charge.\n";
dims.push(#{ prompt: d_store, label: "audit:stores", capability_mode: "read-only", output_schema: audit_schema });

let d_recon = common;
d_recon += "STREAM: RECON_ROUTING — packages/reconciliation/** and packages/routing/**\n";
d_recon += "Audit compare/policy/scheduler/backoff, no-duplicate-charge, recovery paths,\n";
d_recon += "routing amount ranges, fallback eligibility (must not retry after money moved),\n";
d_recon += "selection honesty, false paid recovery. Look for logical holes in safe-fallback rules.\n";
dims.push(#{ prompt: d_recon, label: "audit:recon-routing", capability_mode: "read-only", output_schema: audit_schema });

let d_obs = common;
d_obs += "STREAM: OBS_PKG — packages/observability, packages/testkit, packaging/exports, docs honesty.\n";
d_obs += "Audit redaction, OTEL span money fields, public export surface (accidental internal leaks),\n";
d_obs += "testkit fakes that train false invariants, README/docs claims that contradict code for money/security.\n";
d_obs += "Skip pure style nits.\n";
dims.push(#{ prompt: d_obs, label: "audit:obs-pkg", capability_mode: "read-only", output_schema: audit_schema });

let d_perf = common;
d_perf += "STREAM: PERF — performance, hot paths, allocation, I/O amplification.\n";
d_perf += "Audit packages/core, webhooks, reconciliation, routing, and store adapters.\n";
d_perf += "Look for: N+1 store/provider calls, unbounded in-memory maps, JSON parse of huge webhook bodies twice,\n";
d_perf += "O(n) scans on every claim, missing indexes in SQL templates, sync crypto on hot path, clone/stringify loops,\n";
d_perf += "retry storms, webhook engine polling too aggressive, fingerprint hashing of large objects,\n";
d_perf += "logger serializing secrets/payloads, reconciliation listDue scanning whole tables.\n";
d_perf += "Only report REAL measured-from-code issues with file:line. Skip micro-opts.\n";
dims.push(#{ prompt: d_perf, label: "audit:perf", capability_mode: "read-only", output_schema: audit_schema });

let audit_results = parallel(dims);

// ─── Historical recheck ───────────────────────────────────────────
phase("Recheck");
log("Rechecking historical deep-audit findings against current PayKernel tree");

let p_re = "";
p_re += "Repo: " + root + "\n";
p_re += "READ-ONLY. Paths are under packages/core/src/ (not old payments-sdk /src).\n";
p_re += "For each historical item: STILL PRESENT or ALREADY FIXED with file:line evidence.\n\n";
p_re += "HISTORICAL CHECKLIST:\n";
p_re += "PP0: PayPal verifyWebhookAsync re-serializes webhook_event (must embed raw JSON body)\n";
p_re += "PP1: PayPal isValidWebhookHeaders no transmission-time max age\n";
p_re += "PP2: PayPal final_capture defaults true without explicit partial capture\n";
p_re += "PP3: PayPal extractWebhookCaptureId first captures[0] only\n";
p_re += "PP4: PayPal verifyWebhook sync always false soft-fail\n";
p_re += "PP5: PayPal authorize/refund success:true on HTTP OK even if status failed\n";
p_re += "PP6: PayPal verifyWebhookAsync trims raw body before embed\n";
p_re += "S1: Stripe refund compare uses amount_refunded vs wrong base amount\n";
p_re += "S2: Stripe payment_intent.succeeded always paid (ignore partial capture)\n";
p_re += "S3: Stripe verifyWebhook rejects future timestamps incorrectly or unbounded future\n";
p_re += "S4: Stripe capturePayment never partially_captured\n";
p_re += "S5: Stripe checkout.session.completed no_payment_required always setup_completed\n";
p_re += "S6: Stripe subscription trialing maps to paid\n";
p_re += "S7: Stripe authentication_required -> AuthenticationError (401-class)\n";
p_re += "PM1: Paymob mapTransactionStatus is_auth wins incorrectly over capture amounts\n";
p_re += "PM2: Paymob refund compare uses amount_cents not captured_amount\n";
p_re += "PM3: Paymob dual-write / partial capture gaps\n";
p_re += "M1: Moyasar verified maps to authorized not setup_completed\n";
p_re += "M2: Moyasar 3ds_auth_error wrong error class\n";
p_re += "M3: Moyasar capture/refund/void unguarded without idempotency\n";
p_re += "M4: Moyasar parseWebhookEvent retains secret_token in rawPayload\n";
p_re += "C1: after-hook proceed:false after money moved / throw aborts retries wrongly\n";
p_re += "C2: hooks onWebhookVerified double fulfill on throw\n";
p_re += "C3: money freeze defeated by mutation / incomplete MONEY_IDENTITY_KEYS\n";
p_re += "C4: validation non-finite amounts / javascript: callbackUrl / empty idempotencyKey\n";
p_re += "C5: currency ISK/MGA wrong decimals\n";
p_re += "C6: fingerprintParams null vs undefined collide\n";
p_re += "C7: withRetry maxAttempts<=0 throws undefined\n";
p_re += "R1: routing fallback after money moved\n";
p_re += "W1: webhook inbox double-process / payload conflict\n";
p_re += "ST1: store claim fencing / dual-write false success\n";
p_re += "Return confirmed[], already_fixed[], summary.\n";

let recheck = agent(p_re, #{
    label: "recheck:historical",
    capability_mode: "read-only",
    output_schema: recheck_schema,
});
if recheck != () && recheck.success && recheck.output != () {
    log("Recheck: " + recheck.output.summary);
}

// ─── Verify baseline ──────────────────────────────────────────────
phase("Verify");
log("Running typecheck/tests baseline");

let p_ver = "";
p_ver += "Repo: " + root + "\n";
p_ver += "You MAY run shell commands. Do not edit source.\n";
p_ver += "From repo root:\n";
p_ver += "1) bun run typecheck (or package-level if monorepo script fails)\n";
p_ver += "2) bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/store-contracts packages/sql-foundation — with reasonable timeout\n";
p_ver += "If full test suite is too long, run core + webhooks + reconciliation + routing + a store adapter smoke.\n";
p_ver += "Record failures with short excerpts. Return ok, typecheck_ok, tests_ok, failures[], commands_run[], summary.\n";

let verify = agent(p_ver, #{
    label: "verify:baseline",
    capability_mode: "execute",
    output_schema: verify_schema,
});
if verify != () && verify.success && verify.output != () {
    log("Verify: " + verify.output.summary);
}

// ─── Synthesize ───────────────────────────────────────────────────
phase("Synthesize");
log("Synthesizing audit findings");

let findings_blob = "";
if audit_results != () {
    let ai = 0;
    while ai < audit_results.len() {
        let ar = audit_results[ai];
        if ar != () && ar.success && ar.output != () {
            findings_blob += "=== STREAM " + ar.output.stream + " ===\n";
            findings_blob += "summary: " + ar.output.summary + "\n";
            let fs = ar.output.findings;
            if fs != () {
                let fi = 0;
                while fi < fs.len() {
                    let f = fs[fi];
                    if f != () {
                        findings_blob += "- [" + f.severity + "] " + f.id + ": " + f.title + " | " + f.evidence + " | impact: " + f.impact + "\n";
                    }
                    fi += 1;
                }
            }
            findings_blob += "\n";
        } else {
            findings_blob += "=== STREAM index " + ai.to_string() + " FAILED OR EMPTY ===\n";
        }
        ai += 1;
    }
} else {
    findings_blob = "(no audit results)\n";
}

let recheck_blob = "";
if recheck != () && recheck.success && recheck.output != () {
    recheck_blob += "CONFIRMED still present:\n";
    let conf = recheck.output.confirmed;
    if conf != () {
        let ci = 0;
        while ci < conf.len() {
            recheck_blob += "- " + conf[ci] + "\n";
            ci += 1;
        }
    }
    recheck_blob += "ALREADY FIXED:\n";
    let fixed = recheck.output.already_fixed;
    if fixed != () {
        let fi2 = 0;
        while fi2 < fixed.len() {
            recheck_blob += "- " + fixed[fi2] + "\n";
            fi2 += 1;
        }
    }
    recheck_blob += "recheck summary: " + recheck.output.summary + "\n";
}

let verify_blob = "verify unavailable";
if verify != () && verify.success && verify.output != () {
    verify_blob = "typecheck_ok=" + verify.output.typecheck_ok.to_string() + " tests_ok=" + verify.output.tests_ok.to_string() + " ok=" + verify.output.ok.to_string() + " :: " + verify.output.summary;
}

let p_syn = "";
p_syn += "You are synthesizing a PayKernel deep-audit. READ-ONLY; you may re-verify evidence with grep/read_file.\n";
p_syn += "Repo: " + root + "\n\n";
p_syn += "DOMAIN AUDIT FINDINGS:\n" + findings_blob + "\n";
p_syn += "HISTORICAL RECHECK:\n" + recheck_blob + "\n";
p_syn += "BASELINE VERIFY: " + verify_blob + "\n\n";
p_syn += "Dedupe, drop false positives (verify weak claims), rank by production money/security risk.\n";
p_syn += "p0/p1/p2/p3 arrays: each entry one line: ID — title — evidence path — impact.\n";
p_syn += "verdict: SHIP_BLOCKED | NEEDS_FIXES | MOSTLY_CLEAN | CLEAN\n";
p_syn += "Return p0, p1, p2, p3, false_positives_dropped, verdict, summary.\n";

let synth = agent(p_syn, #{
    label: "synthesize:findings",
    capability_mode: "read-only",
    output_schema: synth_schema,
});
if synth != () && synth.success && synth.output != () {
    log("Synth verdict: " + synth.output.verdict + " — " + synth.output.summary);
}

// ─── Adversarial gate ─────────────────────────────────────────────
phase("Gate");
log("Adversarial independent review of top findings");

let synth_blob = "";
if synth != () && synth.success && synth.output != () {
    synth_blob += "verdict=" + synth.output.verdict + "\n";
    synth_blob += "summary=" + synth.output.summary + "\n";
    let p0 = synth.output.p0;
    synth_blob += "P0:\n";
    if p0 != () {
        let i = 0;
        while i < p0.len() {
            synth_blob += "- " + p0[i] + "\n";
            i += 1;
        }
    }
    let p1 = synth.output.p1;
    synth_blob += "P1:\n";
    if p1 != () {
        let i = 0;
        while i < p1.len() {
            synth_blob += "- " + p1[i] + "\n";
            i += 1;
        }
    }
    let p2 = synth.output.p2;
    synth_blob += "P2:\n";
    if p2 != () {
        let i = 0;
        while i < p2.len() {
            synth_blob += "- " + p2[i] + "\n";
            i += 1;
        }
    }
}

let p_gate = "";
p_gate += "ADVERSARIAL GATE for PayKernel deep audit. You do NOT trust the synthesizer.\n";
p_gate += "Repo: " + root + "\n";
p_gate += "Independently re-open the cited files for every claimed P0 and P1. Confirm or dispute.\n";
p_gate += "pass=true only if there are ZERO confirmed P0 findings and no test/typecheck red that indicates broken money path.\n";
p_gate += "blocking = confirmed P0 + any P1 that is a clear money/status lie in production path.\n";
p_gate += "non_blocking = confirmed P2/P3 and lower-confidence P1s.\n";
p_gate += "disputed = findings you reject as wrong/outdated.\n";
p_gate += "SYNTH CLAIMS:\n" + synth_blob + "\n";
p_gate += "Also skim HISTORICAL confirmed if relevant:\n" + recheck_blob + "\n";
p_gate += "Write nothing yet. Return pass, blocking[], non_blocking[], disputed[], summary, report_path empty string.\n";

let gate = agent(p_gate, #{
    label: "gate:adversarial",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
if gate != () && gate.success && gate.output != () {
    log("Gate pass=" + gate.output.pass.to_string() + " — " + gate.output.summary);
}

// ─── Report ───────────────────────────────────────────────────────
phase("Report");
log("Writing deep-audit report");

let p_rep = "";
p_rep += "Write the PayKernel deep-audit report to:\n";
p_rep += root + "/docs/audits/deep-audit-2026-08-16.md\n\n";
p_rep += "Use write/create file tools. Include:\n";
p_rep += "# PayKernel Deep Audit (2026-08-16)\n";
p_rep += "## Verdict\n";
p_rep += "## Baseline (typecheck/tests)\n";
p_rep += "## Blocking findings (P0 / confirmed money-security)\n";
p_rep += "## High findings (P1)\n";
p_rep += "## Medium / Low (P2/P3)\n";
p_rep += "## Historical recheck (still present vs fixed)\n";
p_rep += "## Disputed / false positives\n";
p_rep += "## Clean areas\n";
p_rep += "## Recommended fix order\n";
p_rep += "Be factual. Use evidence paths. Do not invent issues.\n\n";
p_rep += "GATE OUTPUT:\n";
if gate != () && gate.success && gate.output != () {
    p_rep += "pass=" + gate.output.pass.to_string() + "\n";
    p_rep += "summary=" + gate.output.summary + "\n";
    let bl = gate.output.blocking;
    p_rep += "blocking:\n";
    if bl != () {
        let bi = 0;
        while bi < bl.len() {
            p_rep += "- " + bl[bi] + "\n";
            bi += 1;
        }
    }
    let nb = gate.output.non_blocking;
    p_rep += "non_blocking:\n";
    if nb != () {
        let ni = 0;
        while ni < nb.len() {
            p_rep += "- " + nb[ni] + "\n";
            ni += 1;
        }
    }
    if gate.output.disputed != () {
        let dp = gate.output.disputed;
        p_rep += "disputed:\n";
        let di = 0;
        while di < dp.len() {
            p_rep += "- " + dp[di] + "\n";
            di += 1;
        }
    }
} else {
    p_rep += "gate agent failed — use synth + recheck\n";
}
p_rep += "\nSYNTH:\n" + synth_blob + "\n";
p_rep += "\nVERIFY: " + verify_blob + "\n";
p_rep += "\nRECHECK:\n" + recheck_blob + "\n";
p_rep += "\nDOMAIN FINDINGS (raw):\n" + findings_blob + "\n";
p_rep += "Return ok, report_path, summary.\n";

let report = agent(p_rep, #{
    label: "report:write",
    capability_mode: "read-write",
    output_schema: report_schema,
});
if report != () && report.success && report.output != () {
    log("Report: " + report.output.report_path + " — " + report.output.summary);
} else {
    log("Report agent failed");
}

log("paykernel-deep-audit complete");
