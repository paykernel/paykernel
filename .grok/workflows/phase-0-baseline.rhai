let meta = #{
    name: "phase-0-baseline",
    description: "Phase 0 baseline (monorepo-safe, idempotent): audit packages/core, repair gaps only, verify, adversarial gate — never re-own root as publishable package",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 0 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "idempotent gap-repair streams for 0.1-0.4 under packages/core" },
        #{ title: "Integrate", detail: "wire scripts, package.json, CI, README; no behavior drift" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, publint, attw, consumer smoke" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 0" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 0 (baseline, audit, safety net) for @paykernel/core",
};

let critic_schema = #{
    "type": "object",
    "required": ["gaps", "already_present", "stream_plan", "risks", "summary"],
    "properties": #{
        "gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "already_present": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "stream_plan": #{ "type": "string" },
        "risks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "build_ok", "pack_ok", "publint_ok", "attw_ok", "consumer_ok", "coverage_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "pack_ok": #{ "type": "boolean" },
        "publint_ok": #{ "type": "boolean" },
        "attw_ok": #{ "type": "boolean" },
        "consumer_ok": #{ "type": "boolean" },
        "coverage_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "checklist", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "."
} else {
    args.root
};

// Monorepo layout (post Phase 1): publishable package lives under packages/core.
// This workflow is IDEMPOTENT: fill gaps only; do not invent a second package at repo root.
let core = root + "/packages/core";
let core_src = core + "/src";
let core_docs = core + "/docs";
let core_baseline = core_docs + "/baseline";

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 0 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 0 critic for @paykernel/core at " + root + ".\n";
p_critic += "READ-ONLY audit (capability read-only). Use read_file, list_dir, grep only.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT run installs or mutate the tree.\n\n";
p_critic += "MONOREPO: SDK lives at packages/core (name @paykernel/core). Root is private workspace.\n";
p_critic += "If packages/core already has baseline docs, scripts, tests — list GAPS only (idempotent repair mode).\n";
p_critic += "NEVER recommend creating root src/ or treating root package.json as publishable.\n\n";
p_critic += "Read roadmap.md section \"# Phase 0 — Baseline, Audit, and Safety Net\" completely.\n";
p_critic += "Also read Mandatory Engineering Rules (section 4) that apply to Phase 0.\n\n";
p_critic += "Audit the repo against EVERY Phase 0 task and acceptance criterion:\n";
p_critic += "0.1 Capture Current Public API\n";
p_critic += "  - API report for exported types and runtime symbols (committed artifact)\n";
p_critic += "  - package entry points and declaration output recorded\n";
p_critic += "  - type-level tests for important public usage patterns\n";
p_critic += "  - regression tests for all current gateway operations\n";
p_critic += "  - bundle size and package contents recorded\n";
p_critic += "0.2 Coverage Boundaries\n";
p_critic += "  - thresholds for: client orchestration, hooks, retry/idempotency, currency,\n";
p_critic += "    error mapping, webhooks, every built-in gateway, security-sensitive branches\n";
p_critic += "  - meaningful branch coverage not blind 100%\n";
p_critic += "0.3 Package Validation\n";
p_critic += "  - typecheck, bun test, build, npm pack, publint, @arethetypeswrong/cli,\n";
p_critic += "    install packed tarball into temp consumer projects, import in Node and Bun\n";
p_critic += "  - CI must run these\n";
p_critic += "0.4 Behavioral Contracts documentation\n";
p_critic += "  - retry-safe ops, capture/void/refund IDs per provider, raw webhook bodies,\n";
p_critic += "    terminal/non-terminal statuses, after-hooks cannot roll back, indeterminate\n";
p_critic += "    outcomes, current runtime assumptions\n\n";
p_critic += "Acceptance criteria:\n";
p_critic += "- Existing tests pass without behavior changes\n";
p_critic += "- Public API baseline exists\n";
p_critic += "- CI validates the packed package\n";
p_critic += "- Current provider behavior documented sufficiently to detect regressions\n\n";
p_critic += "Inspect: packages/core/package.json, packages/core/src/index.ts, packages/core/dist/,\n";
p_critic += "packages/core/docs/baseline/, packages/core/docs/behavioral-contracts.md,\n";
p_critic += "root package.json (private workspace only), .github/workflows/ci.yml, scripts/, bunfig.toml.\n";
p_critic += "List concrete GAPS (missing artifacts/scripts/CI steps/docs/tests).\n";
p_critic += "List ALREADY_PRESENT items.\n";
p_critic += "stream_plan: brief non-overlapping file ownership plan for streams A-E.\n";
p_critic += "risks: behavior-change risks to avoid (Phase 0 is baseline, not refactor).\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase0-audit",
    capability_mode: "read-only",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase0-critic.json", critic_json);
} else {
    log("Critic agent failed — implement streams use full Phase 0 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 0\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 0 streams in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Package: @paykernel/core v0.8.0 — Bun + TypeScript multi-gateway payment SDK.\n";
common += "PHASE 0 ONLY: baseline, audit, safety net under packages/core. Do NOT change payment business logic.\n";
common += "Do NOT refactor gateways. Do NOT change public API shapes or runtime behavior.\n";
common += "Do NOT commit. Do NOT push. Do NOT restructure monorepo or re-own root package.json as publishable.\n";
common += "IDEMPOTENT: if an artifact already exists and is correct, leave it; only fill concrete GAPS from critic.\n";
common += "Paths: core package = " + core + " ; baseline = " + core_baseline + "\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Prefer adding tests/docs/scripts over editing prod logic.\n";
common += "If you must touch production code, only for testability/hooks coverage without behavior change.\n";
common += "Mandatory: no secret leakage in fixtures/logs/docs; no Node-only assumptions in portable scripts without noting them.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A — Public API baseline artifacts + generation script
let p_a = "";
p_a += common;
p_a += "STREAM A — 0.1 Public API baseline artifacts. OWN PATHS ONLY:\n";
p_a += "- " + core_baseline + "/ (create/repair files under here except coverage-policy.md and behavioral-contracts.md)\n";
p_a += "- " + root + "/scripts/generate-api-baseline.ts (must resolve packages/core paths)\n";
p_a += "- " + root + "/scripts/record-package-baseline.ts (must pack/fingerprint packages/core)\n";
p_a += "Do NOT edit package.json, ci.yml, bunfig.toml, src/ production files, or other streams' files.\n\n";
p_a += "TASKS:\n";
p_a += "1) Create/repair " + core_baseline + "/README.md explaining Phase 0 baseline purpose and how to regenerate.\n";
p_a += "2) scripts/generate-api-baseline.ts (Bun-runnable at monorepo root):\n";
p_a += "   - Parse packages/core/src/index.ts export statements (types vs values).\n";
p_a += "   - Import built package from packages/core/dist after ensuring dist exists.\n";
p_a += "   - Emit packages/core/docs/baseline/public-api.md listing:\n";
p_a += "     * package name/version from package.json\n";
p_a += "     * entry points (main, types, exports)\n";
p_a += "     * every runtime export (classes, functions, const values) with kind\n";
p_a += "     * every type-only export name\n";
p_a += "     * declaration output tree under dist/ (list .d.ts files relative paths)\n";
p_a += "   - Deterministic sorted output. Include generation timestamp note and command used.\n";
p_a += "3) scripts/record-package-baseline.ts:\n";
p_a += "   - Run build if needed (or require dist/index.js).\n";
p_a += "   - Record dist/index.js byte size and sha256.\n";
p_a += "   - Simulate package files list from package.json files field (walk those dirs).\n";
p_a += "   - Prefer: `npm pack --dry-run` or `npm pack` then list tarball (use npm if available).\n";
p_a += "   - Emit packages/core/docs/baseline/package-contents.md (must match LIVE dist layout: usually single index.js bundle + .d.ts).\n";
p_a += "4) Run both scripts successfully so the markdown artifacts exist and are accurate.\n";
p_a += "5) Create/repair packages/core/docs/baseline/entry-points.md; prefer createPaymentClient as recommended; legacy ctor deprecated.\n";
p_a += "6) Do not invent exports not in index.ts. Cross-check against packages/core/src/index.ts.\n";
p_a += "7) Do NOT write baseline under monorepo root docs/ (root docs/ is monorepo-only).\n";

// Stream B — Coverage boundaries
let p_b = "";
p_b += common;
p_b += "STREAM B — 0.2 Coverage boundaries. OWN PATHS ONLY:\n";
p_b += "- " + root + "/bunfig.toml\n";
p_b += "- " + core_baseline + "/coverage-policy.md\n";
p_b += "- " + core_src + "/hooks/hooks.manager.test.ts (NEW only if coverage gaps)\n";
p_b += "- " + core_src + "/client.coverage.test.ts (NEW only if client uncovered branches need tests)\n";
p_b += "Do NOT edit package.json, CI, other docs/baseline files owned by A/D, or gateway sources.\n\n";
p_b += "TASKS:\n";
p_b += "1) Create bunfig.toml with [test] coverage thresholds that match CURRENT reality with headroom:\n";
p_b += "   Current approx: lines ~95%, funcs ~94%. Set thresholds that FAIL on real regressions but pass today:\n";
p_b += "   coverageThreshold = { lines = 0.90, functions = 0.85 }\n";
p_b += "   coverageSkipTestFiles = true\n";
p_b += "   Optionally coverageReporter = [\"text\"] only in bunfig (CI can pass --coverage-reporter=lcov).\n";
p_b += "   Do NOT enable coverage=true always (slows local dev); thresholds apply when --coverage is used.\n";
p_b += "2) packages/core/docs/baseline/coverage-policy.md must document REQUIRED coverage focus areas:\n";
p_b += "   - client orchestration (create/capture/refund/void/get/webhook routing)\n";
p_b += "   - hook execution and isolation (before abort, after proceed:false, onError isolation)\n";
p_b += "   - retry and idempotency utilities\n";
p_b += "   - currency conversion (exponents, 0-decimal, 3-decimal)\n";
p_b += "   - error mapping per gateway\n";
p_b += "   - webhook verification and normalization\n";
p_b += "   - every built-in gateway (moyasar, paypal, paymob, stripe)\n";
p_b += "   - security-sensitive branches (signature verify fail-closed, empty secrets, redaction)\n";
p_b += "   State that we require meaningful branch coverage for payment state transitions and failure paths,\n";
p_b += "   not blind 100% line coverage. Document global threshold and how to run `bun test --coverage`.\n";
p_b += "3) If hooks.manager uncovered lines (isolation/error paths) lack tests, add hooks.manager.test.ts\n";
p_b += "   with meaningful assertions — do not change hooks.manager.ts behavior.\n";
p_b += "4) Verify: cd root && bun test --coverage  (must pass threshold).\n";
p_b += "5) If threshold fails due to pre-existing low coverage, lower only as much as needed while keeping\n";
p_b += "   lines >= 0.88 and functions >= 0.80, and document the exception in coverage-policy.md.\n";

// Stream C — Package validation CI + scripts
let p_c = "";
p_c += common;
p_c += "STREAM C — 0.3 Package validation. OWN PATHS ONLY:\n";
p_c += "- " + root + "/package.json (FORWARDING scripts only; root must stay private monorepo — never make root publishable)\n";
p_c += "- " + core + "/package.json (publishable package scripts: pack/publint/attw as needed)\n";
p_c += "- " + root + "/.github/workflows/ci.yml\n";
p_c += "- " + root + "/scripts/validate-package.sh (must pack packages/core, not monorepo root)\n";
p_c += "- " + root + "/scripts/consumer-smoke.mjs\n";
p_c += "- " + root + "/.gitignore (only if adding coverage/ or tmp pack artifacts)\n";
p_c += "Do NOT edit packages/core/src business logic or baseline content from A/B/D.\n\n";
p_c += "TASKS:\n";
p_c += "1) Add devDependencies (use bun add -d):\n";
p_c += "   - publint\n";
p_c += "   - @arethetypeswrong/cli\n";
p_c += "2) package.json scripts (keep existing scripts; add):\n";
p_c += "   - \"test:coverage\": \"bun test --coverage\"\n";
p_c += "   - \"baseline:api\": \"bun run scripts/generate-api-baseline.ts\"\n";
p_c += "   - \"baseline:package\": \"bun run scripts/record-package-baseline.ts\"\n";
p_c += "   - \"baseline\": \"bun run baseline:api && bun run baseline:package\"\n";
p_c += "   - \"pack:check\": \"npm pack --dry-run\"\n";
p_c += "   - \"publint\": \"publint\"\n";
p_c += "   - \"attw\": \"attw --pack .\"  (or correct @arethetypeswrong/cli CLI: typically `attw --pack .`)\n";
p_c += "   - \"validate:package\": \"bash scripts/validate-package.sh\"\n";
p_c += "   Verify exact CLI names via package bin after install.\n";
p_c += "3) scripts/validate-package.sh (set -euo pipefail):\n";
p_c += "   - bun run typecheck\n";
p_c += "   - bun test\n";
p_c += "   - bun run build\n";
p_c += "   - test -f packages/core/dist/index.js && test -f packages/core/dist/index.d.ts\n";
p_c += "   - npm pack (create tarball in /tmp or cwd; clean up)\n";
p_c += "   - publint\n";
p_c += "   - attw on packed package (or attw --pack .)\n";
p_c += "   - run consumer-smoke.mjs against the tarball\n";
p_c += "4) scripts/consumer-smoke.mjs:\n";
p_c += "   - Create temp dirs, npm/bun pack install of the tarball\n";
p_c += "   - In a Bun consumer: dynamic import('@paykernel/core') and assert PaymentClient is a function/class\n";
p_c += "   - In a Node consumer (node --input-type=module): same import check\n";
p_c += "   - Fail with non-zero exit on any error\n";
p_c += "   - Clean temp dirs in finally\n";
p_c += "5) Update .github/workflows/ci.yml to run after build:\n";
p_c += "   - bun test --coverage (or bun run test:coverage)\n";
p_c += "   - bunx publint (or bun run publint)\n";
p_c += "   - bunx attw --pack . (or bun run attw)\n";
p_c += "   - npm pack + consumer smoke (or bun run validate:package if not too slow)\n";
p_c += "   Prefer discrete CI steps with clear names. Keep typecheck, test, build.\n";
p_c += "   Use bun-version already set. Install frozen-lockfile remains.\n";
p_c += "6) .gitignore: add coverage/ if missing; ignore *.tgz pack artifacts at root.\n";
p_c += "7) After edits: bun install so lockfile updates; run validate path as far as possible.\n";
p_c += "8) Do NOT change \"files\" field in a way that drops docs or dist. Do NOT change main/exports.\n";

// Stream D — Behavioral contracts documentation
let p_d = "";
p_d += common;
p_d += "STREAM D — 0.4 Behavioral contracts. OWN PATHS ONLY:\n";
p_d += "- " + core_docs + "/behavioral-contracts.md\n";
p_d += "Read-only access to packages/core/src and docs for accuracy. Do NOT edit other files.\n\n";
p_d += "TASKS:\n";
p_d += "Write/repair packages/core/docs/behavioral-contracts.md for CURRENT behavior.\n";
p_d += "Intro must acknowledge shipped monorepo + createPaymentClient plugins (not frame them as future).\n";
p_d += "Must include sections:\n";
p_d += "1) Operations safe to retry\n";
p_d += "   - Per gateway: when mutations retry (idempotency key presence), GETs always retryable, etc.\n";
p_d += "   - Cite that uncertain timeouts must not be converted to failure (document current actual behavior if different).\n";
p_d += "2) IDs required for capture, void, and refund per provider\n";
p_d += "   - Moyasar: payment id\n";
p_d += "   - PayPal: capture uses order id; refund needs capture id not order id (verify from code/docs)\n";
p_d += "   - Paymob: transaction id (not intention pi_ id)\n";
p_d += "   - Stripe: PaymentIntent id for capture/void/refund; etc. Verify from gateway code and existing docs.\n";
p_d += "3) Webhooks requiring raw request bodies\n";
p_d += "   - Stripe raw body + stripe-signature\n";
p_d += "   - PayPal raw body + transmission headers\n";
p_d += "   - Moyasar/Paymob specifics from docs/webhooks.md and code\n";
p_d += "4) Terminal and non-terminal PaymentStatus values\n";
p_d += "   - List statuses from payment.types.ts\n";
p_d += "   - Classify terminal vs non-terminal for fulfillment guidance (current product meaning)\n";
p_d += "5) After-hooks cannot roll back provider-side effects\n";
p_d += "   - Document that afterCreatePayment/etc run after provider success; proceed:false is isolation only\n";
p_d += "6) Outcomes that may be indeterminate\n";
p_d += "   - Network timeouts after request may have left provider state unknown; document current error types (NetworkError etc.)\n";
p_d += "7) Current runtime assumptions\n";
p_d += "   - ESM-only, Node >=18, Bun >=1.0, fetch available, engines field\n";
p_d += "   - No required DB/Redis; in-memory idempotency is process-local\n";
p_d += "Use accurate information from code and existing docs. Link to gateway docs where helpful.\n";
p_d += "Do not claim Phase 1+ features. Mark unknowns explicitly if code is ambiguous.\n";

// Stream E — Type-level tests + public usage regression tests
let p_e = "";
p_e += common;
p_e += "STREAM E — Type-level + public API regression tests. OWN PATHS ONLY:\n";
p_e += "- " + core_src + "/public-api.test.ts\n";
p_e += "- " + core_src + "/public-api.types.test.ts\n";
p_e += "- " + core + "/tsconfig.type-tests.json (optional)\n";
p_e += "Do NOT edit production sources, package.json, CI, or docs.\n\n";
p_e += "TASKS:\n";
p_e += "1) src/public-api.test.ts — runtime regression for public surface:\n";
p_e += "   - import * as sdk from './index' (or named imports from package root path ./index)\n";
p_e += "   - Assert PaymentClient is constructible with minimal moyasar config\n";
p_e += "   - Assert error classes are constructible / instanceof PaymentError where applicable\n";
p_e += "   - Assert runtime helpers exist: redact, noopLogger, withRetry, fingerprintParams, InMemoryIdempotencyStore,\n";
p_e += "     isCreditCardSource, gateway classes, HooksManager\n";
p_e += "   - Assert GatewayName union usage via creating client with each gateway config shape (mock secrets)\n";
p_e += "   - Do NOT call real networks. Mock nothing heavy — just constructability and export presence.\n";
p_e += "2) src/public-api.types.test.ts — type-level usage patterns:\n";
p_e += "   Use type assertions that fail typecheck if broken. Patterns:\n";
p_e += "   - PaymentClient methods accept CreatePaymentParams etc.\n";
p_e += "   - GatewayPaymentResult has id, status, success fields (check actual interface fields)\n";
p_e += "   - WebhookEvent required fields\n";
p_e += "   - PaymentHooks optional handlers type-check\n";
p_e += "   - Invalid gateway name should be a type error via // @ts-expect-error\n";
p_e += "   Bun runs .test.ts files; ensure type-level file either:\n";
p_e += "     a) contains at least one trivial runtime test so bun test is happy, OR\n";
p_e += "     b) is only checked via tsc project reference\n";
p_e += "   Prefer: public-api.types.test.ts with import { describe, it, expect } from 'bun:test'\n";
p_e += "   and expect(true).toBe(true) after type-level checks so the file is executed.\n";
p_e += "   For type tests without expect-type package: use assignability helpers:\n";
p_e += "   function expectType<T>(_value: T): void {}\n";
p_e += "   and // @ts-expect-error lines for negative tests.\n";
p_e += "3) Run bun test packages/core/src/public-api.test.ts packages/core/src/public-api.types.test.ts and fix until green.\n";
p_e += "4) Do not weaken production types. Do not export new public API.\n";

let jobs = [
    #{ prompt: p_a, label: "impl:0.1-api-baseline", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "impl:0.2-coverage", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:0.3-package-validation", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "impl:0.4-behavioral-docs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "impl:0.1-type-tests", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok = 0;
let impl_fail = 0;
let impl_i = 0;
while impl_i < impl_results.len() {
    let r = impl_results[impl_i];
    if r != () && r.success && r.output != () && r.output.ok == true {
        impl_ok += 1;
        log("OK implement: " + r.output.summary);
    } else {
        impl_fail += 1;
        log("FAIL implement slot " + impl_i.to_string());
    }
    impl_i += 1;
}
log("Implement done ok=" + impl_ok.to_string() + " fail=" + impl_fail.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "You are integrating Phase 0 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT change payment business logic. Fix cross-stream wiring only.\n\n";
p_int += "CHECK AND FIX:\n";
p_int += "1) package.json scripts baseline:api / baseline:package point to scripts that exist.\n";
p_int += "2) scripts resolve packages/core; run: cd " + root + " && bun run build && bun run baseline\n";
p_int += "   Fix until packages/core/docs/baseline/public-api.md and package-contents.md match LIVE dist.\n";
p_int += "3) bunfig.toml coverage thresholds exist; bun test --coverage packages/core passes.\n";
p_int += "4) packages/core/docs/behavioral-contracts.md exists and intro acknowledges plugins/monorepo.\n";
p_int += "5) packages/core/docs/baseline/README.md links to public-api, package-contents, entry-points, coverage-policy.\n";
p_int += "6) packages/core/README.md docs section links behavioral-contracts + baseline; root README may link monorepo docs.\n";
p_int += "6b) entry-points.md recommends createPaymentClient; package-contents inventory matches single-bundle dist.\n";
p_int += "7) CI workflow includes typecheck, test (with coverage), build, publint, attw, pack/consumer smoke.\n";
p_int += "8) validate-package.sh is executable (chmod +x) and runs end-to-end; fix failures.\n";
p_int += "9) public-api tests exist and pass with bun test.\n";
p_int += "10) Ensure lockfile consistent after any deps (bun install).\n";
p_int += "11) .gitignore has coverage/ and *.tgz if pack leaves artifacts.\n";
p_int += "12) No accidental behavior changes in gateway/client sources — if streams edited them, revert behavior.\n";
p_int += "13) Phase 0 must keep packages/core tests green (no count hardcode; 0 fail).\n";
p_int += "14) If attw fails on known ESM-only package shape, configure attw appropriately or document skip with justification ONLY if attw is wrong; prefer fix package metadata if valid.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase0",
    capability_mode: "all",
    output_schema: implement_schema,
});
let integrate_ok = false;
if int_result != () && int_result.success && int_result.output != () && int_result.output.ok == true {
    integrate_ok = true;
    log("Integrate OK: " + int_result.output.summary);
} else {
    log("Integrate reported issues — verify will surface details");
}


// Fail-closed: if majority of implement streams failed AND integrate failed, gate cannot pass on trust alone.
let force_fail = false;
if impl_fail >= 3 {
    force_fail = true;
    log("FORCE_FAIL: impl_fail=" + impl_fail.to_string() + " — gate must not pass without independent green proof");
}
if !integrate_ok && impl_fail > 0 {
    force_fail = true;
    log("FORCE_FAIL: integrate failed with implement failures");
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify Phase 0 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "Do NOT edit unless a command needs a one-line path fix to run; prefer report failures.\n";
p_ver += "Actually: you MAY fix trivial breakages found during verification so the suite can complete.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test\n";
p_ver += "3) cd " + root + " && bun test --coverage\n";
p_ver += "4) cd " + root + " && bun run build\n";
p_ver += "5) test -f packages/core/dist/index.js && test -f packages/core/dist/index.d.ts\n";
p_ver += "6) Package validation: bun run validate:package OR stepwise publint/attw/pack/smoke\n";
p_ver += "7) Confirm files exist:\n";
p_ver += "   - packages/core/docs/baseline/public-api.md\n";
p_ver += "   - packages/core/docs/baseline/package-contents.md (matches live dist layout)\n";
p_ver += "   - packages/core/docs/baseline/entry-points.md (plugin-first)\n";
p_ver += "   - packages/core/docs/baseline/coverage-policy.md\n";
p_ver += "   - packages/core/docs/baseline/README.md\n";
p_ver += "   - packages/core/docs/behavioral-contracts.md\n";
p_ver += "   - bunfig.toml\n";
p_ver += "   - scripts/validate-package.sh\n";
p_ver += "   - scripts/consumer-smoke.mjs\n";
p_ver += "   - packages/core/src/public-api.test.ts\n";
p_ver += "8) Grep CI workflow for publint, attw or validate:package, coverage\n";
p_ver += "9) Confirm no payment logic regressions: tests still pass\n\n";
p_ver += "Set ok=true only if typecheck, tests, build, pack validation, coverage thresholds all pass\n";
p_ver += "AND all required baseline docs exist with non-trivial content.\n";
p_ver += "Return full verify_schema fields with failures[] listing any missing items.\n";

let ver = agent(p_ver, #{
    label: "verify:phase0",
    capability_mode: "all",
    output_schema: verify_schema,
});

let verify_ok = false;
let verify_summary = "verify agent failed";
let verify_failures = "";
if ver != () && ver.success && ver.output != () {
    verify_ok = ver.output.ok == true;
    verify_summary = ver.output.summary;
    log("Verify: ok=" + verify_ok.to_string() + " — " + verify_summary);
    if ver.output.failures != () {
        verify_failures = json_encode(ver.output.failures);
    }
    write_scratch_file("phase0-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 0 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary from previous phase: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 0 — each must be PASS or BLOCKING:\n";
p_gate += "A1) Existing tests pass without behavior changes (run bun test; expect 0 fail).\n";
p_gate += "A2) A public API baseline exists (packages/core/docs/baseline/public-api.md matches packages/core/src/index.ts).\n";
p_gate += "A3) CI validates the packed package (ci.yml has pack/publint/attw/consumer steps).\n";
p_gate += "A4) Current provider behavior documented (packages/core/docs/behavioral-contracts.md covers retry, IDs,\n";
p_gate += "    raw webhooks, statuses, after-hooks, indeterminate, runtimes).\n\n";
p_gate += "Also require Phase 0 tasks 0.1-0.4 deliverables present:\n";
p_gate += "- type-level/public API tests\n";
p_gate += "- package contents / bundle size record\n";
p_gate += "- coverage policy + bunfig thresholds\n";
p_gate += "- validate-package path works\n\n";
p_gate += "Cross-check public-api.md against packages/core/src/index.ts — material missing/extra symbols are blocking.\n";
p_gate += "package-contents.md must not list multi-file dist/*.js modules that do not exist when dist is a single bundle.\n";
p_gate += "Cross-check behavioral-contracts.md claims against gateway code for at least one ID-per-provider claim.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report ONLY to packages/core/docs/baseline/phase-0-gate-report.md (never monorepo root docs/baseline).\n";
p_gate += "Do NOT edit production source to force a pass; fix evidence collection instead.\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[] (strings like 'A1: PASS ...'), summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase0-adversarial",
    capability_mode: "all",
    output_schema: gate_schema,
});

let gate_pass = false;
let blocking_json = "[]";
let gate_summary = "gate agent failed";
if gate != () && gate.success && gate.output != () {
    gate_pass = gate.output.pass == true;
    gate_summary = gate.output.summary;
    if gate.output.blocking != () {
        blocking_json = json_encode(gate.output.blocking);
    }
    log("Gate pass=" + gate_pass.to_string() + " — " + gate_summary);
    write_scratch_file("phase0-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 0 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 0 only — no business logic changes, no Phase 1 monorepo.\n";
    p_fix += "Do NOT commit.\n";
    p_fix += "After fixes, re-run: bun run typecheck && bun test && bun test --coverage && bun run build && bun run validate:package\n";
    p_fix += "Ensure all baseline docs and CI requirements from Phase 0 are satisfied.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase0-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    // Re-verify after remediate
    let p_re = "";
    p_re += "Re-verify Phase 0 after remediation in " + root + ".\n";
    p_re += "Run typecheck, bun test, bun test --coverage, build, validate:package.\n";
    p_re += "Confirm baseline docs + behavioral-contracts + CI pack validation present.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase0-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 0 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A4 acceptance criteria with evidence.\n";
    p_gate2 += "Update packages/core/docs/baseline/phase-0-gate-report.md only.\n";
    p_gate2 += "pass=true only if all acceptance criteria and deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase0-final",
        capability_mode: "all",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        gate_summary = gate2.output.summary;
        log("Final gate pass=" + gate_pass.to_string() + " — " + gate_summary);
        write_scratch_file("phase0-gate-final.json", json_encode(gate2.output));
    } else {
        gate_pass = false;
        gate_summary = "final gate agent failed";
    }
}

// ─── Complete ────────────────────────────────────────────────────
if force_fail && gate_pass {
    log("WARNING: force_fail was set but gate_pass=true; trusting gate only if verify_ok");
    if !verify_ok {
        gate_pass = false;
        gate_summary = "FAIL: implement/integrate failed and verify not green (" + gate_summary + ")";
    }
}
let final_status = if gate_pass { "PASS" } else { "FAIL" };
let report = "";
report += "# Phase 0 Workflow Result\n\n";
report += "Status: **" + final_status + "**\n\n";
report += "Gate: " + gate_summary + "\n\n";
report += "Verify: " + verify_summary + "\n\n";
report += "Implement streams ok/fail: " + impl_ok.to_string() + "/" + impl_fail.to_string() + "\n";
let report_path = write_scratch_file("phase0-result.md", report);

complete(#{
    status: final_status,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    implement_ok: impl_ok,
    implement_fail: impl_fail,
    summary: gate_summary,
    report_path: report_path,
});
