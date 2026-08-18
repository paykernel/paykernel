let meta = #{
    name: "hono-elysia-http-examples",
    description: "Add real Hono and Elysia checkout examples plus one shared HTTP scenario suite",
    phases: [
        #{ title: "Kernel", detail: "private checkout-kernel workspace and root workspaces" },
        #{ title: "Apps", detail: "Hono app, Elysia app, and docs in parallel" },
        #{ title: "Verify", detail: "bun test examples, typecheck, boundaries, lint" },
        #{ title: "Gate", detail: "adversarial check of raw-body, fulfill-after-claim, HTTP map" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "write scratch summary" },
    ],
    when_to_use: "When adding heavy Hono/Elysia HTTP examples that compose core + inbox + sqlite without Phase 24 integration packages",
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "tests_ok", "typecheck_ok", "boundaries_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "lint_ok": #{ "type": "boolean" },
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
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
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

fn is_true(r, field) {
    if r == () { return false; }
    if !r.success { return false; }
    if r.output == () { return false; }
    if field == "ok" { return r.output.ok == true; }
    if field == "pass" { return r.output.pass == true; }
    false
}

// ─── Kernel ──────────────────────────────────────────────────────
phase("Kernel");
log("Scaffold checkout-kernel and add examples/* workspaces in " + root);

let p_k = "";
p_k += "IMPLEMENT checkout-kernel and root workspace plumbing in " + root + ".\n";
p_k += "Use read_file/grep before editing. Do NOT commit or push. Do NOT create @paykernel/integration-hono or integration-elysia.\n";
p_k += "Do NOT edit packages/core, packages/webhooks, or other publishable production sources except eslint.config.js, root package.json, and docs listed below if you must for workspaces.\n";
p_k += "Leave Hono/Elysia app.ts to the next agents. You MAY create empty example package.json/tsconfig stubs so workspaces resolve.\n\n";
p_k += "OWN:\n";
p_k += "- examples/checkout-kernel/**\n";
p_k += "- examples/README.md\n";
p_k += "- examples/bun-hono-sqlite/package.json and tsconfig.json (stubs ok)\n";
p_k += "- examples/bun-elysia-sqlite/package.json and tsconfig.json (stubs ok)\n";
p_k += "- root package.json workspaces + test/typecheck/lint scripts\n";
p_k += "- eslint.config.js files glob if needed\n\n";
p_k += "REQUIREMENTS:\n";
p_k += "1) Add examples/* to root workspaces. All example packages private:true.\n";
p_k += "2) Packages: @paykernel/example-checkout-kernel, @paykernel/example-bun-hono-sqlite, @paykernel/example-bun-elysia-sqlite.\n";
p_k += "3) Kernel deps workspace:* : @paykernel/core, webhooks, reconciliation, testkit, store-sqlite. Type: module. tsconfig extends ../../tsconfig.base.json, noEmit, include src.\n";
p_k += "4) createCheckoutKernel(options?) after explicit migrateSqliteAdapter(createBunSqliteStoresInMemory()). Inject one clock into stripeGateway runtime + sqlite stores + inbox engine.\n";
p_k += "5) mockGateway is a PaymentGateway, NOT a GatewayAdapter. Wrap it: { name:'mock', manifest:{name:'mock'}, create:() => instance }. Register as gateways.mock plus stripeGateway({ secretKey:'sk_test_example_not_live', webhookSecret:'whsec_test_example_checkout' }). defaultGateway 'mock'.\n";
p_k += "6) scriptCreate option queues mock createPayment outcomes. Expose mock history via kernel.createPaymentCount() / mock.history.\n";
p_k += "7) orders: process-local book {orderId, status unpaid|paid, gatewayPaymentId?, fulfillCount}. create on POST payments path helpers; fulfill only from inbox handler.\n";
p_k += "8) http-policy.ts mapInboxOutcome: processed/duplicate_completed=200, invalid_webhook=400, payload_conflict=409, already_processing=503, handler_failed retryable 500 else 200, scheduled_for_retry not_available=503 else 200. Exhaustive switch. Not in @paykernel/webhooks.\n";
p_k += "9) stripe-webhook.ts: sanitized payment_intent.succeeded fixture with amount_received (so status maps to paid). NO string latest_charge (that demotes to processing). NO cs_test_ ids (assertFixtureSafe rejects them). Sign with hmacSha256Hex(secret, timestamp+'.'+rawBody) header t=,v1=. Call assertFixtureSafe on the object. Also a payment_intent.created fixture (non-paid).\n";
p_k += "10) scenarios.ts exports runCheckoutHttpScenarios(name, createApp) using bun:test describe/it. createApp(kernel) returns { fetch(req: Request): Promise<Response> }. Each it() creates its own kernel+app and kernel.close() in finally.\n";
p_k += "    Nine cases: (1) paid create does not fulfill (2) signed Stripe paid webhook fulfills once (3) redelivery 200 no second fulfill (4) bad sig 400 (5) JSON.parse+stringify body 400 (6) concurrent same body one fulfill (7) fulfillThrows before mark paid -> 500 unpaid (8) payment_intent.created 200 unpaid (9) indeterminate create, POST debug provider-paid, POST /internal/reconcile, createPaymentCount stays 1, order becomes paid.\n";
p_k += "11) Shared route helpers in kernel (createCheckoutHandlers or similar) so Hono/Elysia stay thin: POST /payments, POST /webhooks/stripe (caller passes RAW text), POST /internal/reconcile, GET /orders/:id, POST /internal/provider-paid {gatewayPaymentId}, GET /internal/create-count. handleWebhook('stripe', raw, sig) then processVerified; fulfill only if rematched type payment.succeeded|capture.completed AND payment.status==='paid'. Catch InvalidWebhookError -> 400. Never fulfill in onWebhookVerified.\n";
p_k += "12) Reconcile: createReconciliationScheduler + createPaymentReconciler + createGetPaymentLookupPort. Lookup prefers kernel provider override (set by /internal/provider-paid) else maps getPayment + trusted order money() — never 0.x number into money(). decideReconciliationPolicy; complete only on mark_consistent or applied safe paid/failed; never createPayment again.\n";
p_k += "13) exactOptionalPropertyTypes: omit undefined optional keys. bun install after workspace change.\n";
p_k += "14) Root test script append examples. Add test:examples. typecheck includes the three example packages. lint glob examples/*/src/**/*.ts.\n";
p_k += "Return {ok, files_changed, summary, notes}.\n";

let kernel = agent(p_k, #{
    label: "impl:checkout-kernel",
    capability_mode: "all",
    output_schema: implement_schema,
});
log("Kernel: " + safe_summary(kernel));

// ─── Apps ────────────────────────────────────────────────────────
phase("Apps");
log("Parallel Hono app, Elysia app, and docs");

let common = "";
common += "Repo: " + root + ".\n";
common += "Use read_file/grep. Do NOT commit or push. Do NOT add @paykernel/integration-* packages.\n";
common += "Do NOT edit packages/core or packages/webhooks production sources.\n";
common += "Kernel lives in examples/checkout-kernel. Import public helpers from it. Do not reimplement mapInboxOutcome or Stripe signing.\n";
common += "Webhook routes MUST use request.text() / raw body, never c.req.json() / app body parser, before handleWebhook('stripe', raw, sig).\n";
common += "exactOptionalPropertyTypes: omit undefined keys.\n";
common += "Return {ok, files_changed, summary, notes}.\n";

let p_h = common;
p_h += "STREAM HONO. OWN ONLY examples/bun-hono-sqlite/**.\n";
p_h += "Add hono dependency. createHonoCheckoutApp(kernel) returns Hono. Routes: POST /payments, POST /webhooks/stripe, POST /internal/reconcile, GET /orders/:orderId, POST /internal/provider-paid, GET /internal/create-count. Prefer kernel handlers if exported; otherwise call kernel APIs.\n";
p_h += "src/app.test.ts: import { runCheckoutHttpScenarios } from '@paykernel/example-checkout-kernel' (or relative if package export missing) and runCheckoutHttpScenarios('hono', (k) => { const app = createHonoCheckoutApp(k); return { fetch: (req) => app.fetch(req) }; }).\n";
p_h += "src/index.ts optional listen, not used by tests. README: how to bun test, :memory: is process-local not multi-host, HTTP mapping is app-owned.\n";
p_h += "If kernel helpers are missing, add the thinnest adapter and note it; do not rewrite the kernel.\n";

let p_e = common;
p_e += "STREAM ELYSIA. OWN ONLY examples/bun-elysia-sqlite/**.\n";
p_e += "Add elysia dependency. createElysiaCheckoutApp(kernel) returns Elysia. Same routes as Hono. Webhook: await request.text() then kernel/stripe path. Tests: app.handle(req).\n";
p_e += "src/app.test.ts calls the SAME runCheckoutHttpScenarios('elysia', ...).\n";
p_e += "src/index.ts optional listen. README same honesty as Hono.\n";
p_e += "If kernel helpers are missing, add the thinnest adapter and note it; do not rewrite the kernel.\n";

let p_d = common;
p_d += "STREAM DOCS + ROOT WIRING. OWN:\n";
p_d += "- examples/README.md\n";
p_d += "- docs/workspace-boundaries.md (examples are private consumer apps; checker does not scan them; may depend on hono/elysia/store-sqlite/testkit; packages/* must never import examples)\n";
p_d += "- docs/monorepo.md layout tree + bun test examples\n";
p_d += "- docs/README.md and docs/getting-started.md Next links only — do not duplicate the composition\n";
p_d += "- root README.md one line under Development/Docs\n";
p_d += "- Confirm root package.json workspaces includes examples/* and test/typecheck/lint include examples. Fix if the kernel agent missed it.\n";
p_d += "Do not invent Phase 24 packages. Do not claim multi-host for :memory: sqlite.\n";

let apps = parallel([
    #{ prompt: p_h, label: "impl:hono", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "impl:elysia", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "impl:docs", capability_mode: "all", output_schema: implement_schema },
]);

let ai = 0;
for a in apps {
    log("App stream " + ai.to_string() + ": " + safe_summary(a));
    ai += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Run example tests, typecheck, boundaries, lint");

let p_v = "";
p_v += "Repo: " + root + ". EXECUTE commands and paste failing lines. Do not edit unless a missing bun install is required (then bun install once).\n";
p_v += "1) bun test examples\n";
p_v += "2) bun run --filter @paykernel/example-checkout-kernel typecheck && bun run --filter @paykernel/example-bun-hono-sqlite typecheck && bun run --filter @paykernel/example-bun-elysia-sqlite typecheck  (or whatever scripts exist; if missing, tsc -p each example tsconfig)\n";
p_v += "3) bun run check:boundaries\n";
p_v += "4) bun run lint\n";
p_v += "ok=true only if tests, typecheck, and boundaries pass. Lint failure is a failure too if examples are in the lint glob.\n";
p_v += "Return {ok, tests_ok, typecheck_ok, boundaries_ok, lint_ok, failures, commands_run, summary}.\n";

let verify = agent(p_v, #{
    label: "verify:examples",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial check of example composition invariants");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + ".\n";
p_g += "Use read_file and grep. Do NOT trust implement summaries. Fail closed.\n";
p_g += "pass=true only if ALL blockers are gone with file:line evidence.\n";
p_g += "BLOCKERS:\n";
p_g += "EX-KERNEL: examples/checkout-kernel exists, private, no hono/elysia import in kernel src.\n";
p_g += "EX-SQLITE: createBunSqliteStoresInMemory + explicit migrateSqliteAdapter; no auto-migrate on import.\n";
p_g += "EX-RAW: Hono and Elysia webhook handlers call text()/raw body, never json(), before handleWebhook('stripe',...).\n";
p_g += "EX-FULFILL: fulfill only after processVerified claim, and only payment.succeeded|capture.completed with payment.status==='paid'. No onWebhookVerified money work.\n";
p_g += "EX-MAP: HTTP map matches getting-started (200 processed/dup, 400 invalid, 409 conflict, 503 already_processing, 500 retryable handler_failed).\n";
p_g += "EX-SUITE: one runCheckoutHttpScenarios covers both apps; both app.test.ts call it.\n";
p_g += "EX-NINE: all nine named scenarios exist (create no fulfill, paid webhook, redelivery, bad sig, re-serialized body, concurrent, handler throw, non-paid, indeterminate+reconcile no second create).\n";
p_g += "EX-FIXTURE: Stripe paid fixture has amount_received; no live secrets; whsec_test_/sk_test_ only; no cs_test_.\n";
p_g += "EX-SCOPE: no @paykernel/integration-hono or integration-elysia package.\n";
p_g += "EX-BOUNDARIES: packages/* do not import examples; examples not treated as portable publishable.\n";
p_g += "Non-blocking: missing listen() index polish, extra debug routes, prettier-only nits.\n";
p_g += "Return {pass, blocking, non_blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:examples",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
log("Gate: " + safe_summary(gate));

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");

let verify_ok = is_true(verify, "ok");
let gate_ok = is_true(gate, "pass");
let rem_summary = "skipped";
let rem_ok = true;
let rem_remaining = [];

if !verify_ok || !gate_ok {
    log("Remediating failed verify/gate");
    let p_r = "";
    p_r += "FIX remaining blockers in " + root + ". Do NOT commit. Stay inside examples/**, root package.json, eslint.config.js, and docs listed in the plan.\n";
    p_r += "Do not add Phase 24 integration packages. Do not change core/webhooks payment logic.\n";
    p_r += "Verify summary: " + safe_summary(verify) + "\n";
    p_r += "Gate summary: " + safe_summary(gate) + "\n";
    if verify != () && verify.success && verify.output != () && verify.output.failures != () {
        p_r += "Verify failures JSON: " + json_encode(verify.output.failures) + "\n";
    }
    if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
        p_r += "Gate blocking JSON: " + json_encode(gate.output.blocking) + "\n";
    }
    p_r += "Re-run bun test examples after fixes. Return {ok, fixed, remaining, summary}. ok only if tests pass and blockers are gone.\n";
    let rem = agent(p_r, #{
        label: "remediate:examples",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    rem_summary = safe_summary(rem);
    rem_ok = is_true(rem, "ok");
    if rem != () && rem.success && rem.output != () && rem.output.remaining != () {
        rem_remaining = rem.output.remaining;
    }
    log("Remediate: " + rem_summary);
} else {
    log("Verify and gate passed; skip remediate");
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");

let final_ok = verify_ok && gate_ok && rem_ok;
let report = "";
report += "# Hono + Elysia HTTP examples\n\n";
if final_ok {
    report += "Status: passed\n\n";
} else {
    report += "Status: failed\n\n";
}
report += "Kernel: " + safe_summary(kernel) + "\n";
report += "Verify: " + safe_summary(verify) + "\n";
report += "Gate: " + safe_summary(gate) + "\n";
report += "Remediate: " + rem_summary + "\n";
if rem_remaining.len() > 0 {
    report += "Remaining: " + json_encode(rem_remaining) + "\n";
}

let p_rep = "";
p_rep += "Write a short markdown report of this run to scratch using write_scratch_file only if you must; otherwise return summary only.\n";
p_rep += "Repo: " + root + ".\n";
p_rep += "Draft:\n" + report + "\n";
p_rep += "Confirm examples exist (list_dir examples). Return {ok, summary, report_path?}. ok if kernel+apps+tests look present and verify/gate passed.\n";

let reporter = agent(p_rep, #{
    label: "report:examples",
    capability_mode: "read-only",
    output_schema: report_schema,
});
log("Report: " + safe_summary(reporter));

let path = write_scratch_file("hono-elysia-examples.md", report);
complete(#{
    ok: final_ok,
    path: path,
    kernel: safe_summary(kernel),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
    remediate: rem_summary,
    summary: if reporter != () && reporter.success && reporter.output != () && reporter.output.summary != () {
        reporter.output.summary
    } else {
        report
    },
});
