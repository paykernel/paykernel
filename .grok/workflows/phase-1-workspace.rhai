let meta = #{
    name: "phase-1-workspace",
    description: "Phase 1 workspace (idempotent): monorepo boundaries + changesets; skip re-move if packages/core already exists; serialize package.json ownership",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 1 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "idempotent monorepo foundation, then sequential boundaries + changesets + shared tooling" },
        #{ title: "Integrate", detail: "wire root scripts, CI, paths, baselines; no public runtime behavior drift" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, publint, attw, smoke, boundary checks" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 1" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 1 (workspace and package boundaries) for @paykernel/core",
};

let critic_schema = #{
    "type": "object",
    "required": ["gaps", "already_present", "stream_plan", "risks", "summary"],
    "properties": #{
        "gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "already_present": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "stream_plan": #{ "type": "string" },
        "risks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "build_ok", "pack_ok", "publint_ok", "attw_ok", "consumer_ok", "coverage_ok", "boundaries_ok", "changesets_ok", "failures", "summary"],
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
        "boundaries_ok": #{ "type": "boolean" },
        "changesets_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "checklist", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "."
} else {
    args.root
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 1 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 1 critic for @paykernel/core at " + root + ".\n";
p_critic += "READ-ONLY audit (capability read-only). Use read_file, list_dir, grep only.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "IDEMPOTENT: if packages/core already holds @paykernel/core and root has workspaces, list GAPS only.\n";
p_critic += "Do NOT recommend re-moving src/ or deleting existing packages/testkit or packages/webhooks.\n\n";
p_critic += "Read roadmap.md section \"# Phase 1 — Workspace and Package Boundaries\" completely.\n";
p_critic += "Also read section 5 Proposed Repository Structure and 5.1 Package Boundary Rules.\n";
p_critic += "Also read Mandatory Engineering Rules (section 4) relevant to workspaces and adapters.\n";
p_critic += "Phase 0 is complete — preserve its baseline artifacts, package validation, and tests.\n\n";
p_critic += "Audit against EVERY Phase 1 task and acceptance criterion:\n\n";
p_critic += "1.1 Convert to Bun Workspaces\n";
p_critic += "  - Current SDK must live in packages/core\n";
p_critic += "  - Package name remains @paykernel/core\n";
p_critic += "  - Root development commands forward to workspace packages\n";
p_critic += "  - Shared TypeScript base config (tsconfig.base.json)\n";
p_critic += "  - Shared formatting and lint configuration\n";
p_critic += "  - Workspace dependency versioning configured\n\n";
p_critic += "1.2 Enforce Dependency Rules (automated checks)\n";
p_critic += "  - core must not import adapter packages\n";
p_critic += "  - portable packages must not accidentally import Node-only modules\n";
p_critic += "  - adapter root entries must not import optional peer drivers\n";
p_critic += "  - no circular package dependencies\n";
p_critic += "  - Document boundaries (align with 5.1)\n\n";
p_critic += "1.3 Add Changesets and Provenance\n";
p_critic += "  - Changesets for independent package versioning\n";
p_critic += "  - Generate release notes\n";
p_critic += "  - npm provenance\n";
p_critic += "  - prerelease channels\n\n";
p_critic += "Acceptance criteria:\n";
p_critic += "- Existing import paths continue to work (consumer: import from @paykernel/core)\n";
p_critic += "- The packed core package contains only intended files\n";
p_critic += "- Workspace dependency boundaries are documented and enforced\n\n";
p_critic += "Inspect: package.json, src/, packages/, tsconfig*.json, .github/workflows/,\n";
p_critic += "scripts/, docs/, bunfig.toml, .changeset/, lockfile. Note monorepo vs single-package state.\n";
p_critic += "List concrete GAPS. List ALREADY_PRESENT. stream_plan for implement order.\n";
p_critic += "risks: public API/behavior drift, broken pack paths, broken CI, lost Phase 0 gates.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase1-audit",
    capability_mode: "read-only",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase1-critic.json", critic_json);
} else {
    log("Critic agent failed — implement streams use full Phase 1 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 1\"}";
}

// ─── Implement 1.1 monorepo scaffold (sequential foundation) ─────
phase("Implement");
log("Implementing Phase 1.1 monorepo foundation in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Package: @paykernel/core v0.8.0 — Bun + TypeScript multi-gateway payment SDK.\n";
common += "PHASE 1 ONLY: workspace + package boundaries. Do NOT start Phase 2 plugin architecture.\n";
common += "Do NOT change payment business logic, gateway behavior, public API shapes, or runtime semantics.\n";
common += "Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0 baseline/docs/validation intent.\n";
common += "Mandatory engineering rules: no secret leakage; no Node-only assumptions in portable packages;\n";
common += "keep backward compatibility during 0.x; every phase ends with typecheck/tests/build/pack/docs.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

let p_a = "";
p_a += common;
p_a += "STREAM A — 1.1 Convert to Bun Workspaces (FOUNDATION). You own monorepo layout.\n\n";
p_a += "IDEMPOTENT PRECHECK: If packages/core/package.json exists with name @paykernel/core\n";
p_a += "and root package.json has private:true + workspaces packages/*, DO NOT move trees.\n";
p_a += "Only repair missing pieces (tsconfig.base.json, forwarding scripts, LICENSE copy).\n";
p_a += "Never delete packages/testkit or packages/webhooks. Never nest packages/core/packages/core.\n\n";
p_a += "TARGET LAYOUT (minimum for Phase 1; do not create empty adapter/gateway packages yet):\n";
p_a += root + "/\n";
p_a += "  package.json                 # private root workspace\n";
p_a += "  bun.lock\n";
p_a += "  tsconfig.base.json            # shared TS compiler options\n";
p_a += "  bunfig.toml                   # test/coverage at root (workspace-wide)\n";
p_a += "  scripts/                      # monorepo tooling (may stay root)\n";
p_a += "  .github/workflows/\n";
p_a += "  roadmap.md, LICENSE, README.md (root monorepo README OK)\n";
p_a += "  packages/core/                # @paykernel/core publishable package\n";
p_a += "    package.json                # name MUST remain @paykernel/core, version 0.8.0\n";
p_a += "    src/                        # moved from root src/\n";
p_a += "    dist/                       # built output (regenerate after move)\n";
p_a += "    docs/                       # package docs that ship (from root docs/)\n";
p_a += "    README.md                   # package README (content from current root README or split)\n";
p_a += "    LICENSE\n";
p_a += "    tsconfig.json               # extends ../../tsconfig.base.json\n";
p_a += "    tsconfig.type-tests.json\n";
p_a += "    # package-local bunfig if needed; prefer root bunfig for tests\n\n";
p_a += "STEPS (only if precheck failed — greenfield monorepo conversion):\n";
p_a += "1) Create packages/core directory if missing.\n";
p_a += "2) Move root src/ -> packages/core/src/ ONLY if root src/ still exists.\n";
p_a += "3) Move package-shipped docs only if they still live at monorepo root as package docs\n";
p_a += "   (do not move monorepo-only docs/monorepo.md / workspace-boundaries.md into core).\n";
p_a += "   (Phase 0 baseline and behavioral-contracts MUST remain available under packages/core/docs/)\n";
p_a += "4) Create packages/core/package.json from current root package.json:\n";
p_a += "   - Keep name @paykernel/core, version, description, exports, main, types, files,\n";
p_a += "     keywords, author, license, repository, publishConfig, homepage, engines, dependencies (zod),\n";
p_a += "     peerDependencies.\n";
p_a += "   - scripts: build, build:types, test, test:coverage, typecheck, typecheck:types, typecheck:all,\n";
p_a += "     pack:check, publint, attw, prepublishOnly — paths relative to packages/core.\n";
p_a += "   - files field: [\"dist\", \"docs\", \"README.md\", \"LICENSE\"] still correct under packages/core.\n";
p_a += "   - Move package-specific devDependencies that the package needs for build/typecheck:\n";
p_a += "     typescript, @types/bun. Root may also hold shared tools.\n";
p_a += "5) Create root package.json as PRIVATE workspace root:\n";
p_a += "   - \"private\": true\n";
p_a += "   - \"name\": \"PayKernel-monorepo\" (or \"paykernel\")\n";
p_a += "   - workspaces: [\"packages/*\"]  (Bun workspaces field — use \"workspaces\" array)\n";
p_a += "   - Forwarding scripts that preserve root DX:\n";
p_a += "     build -> filter core build\n";
p_a += "     test -> bun test (from root; tests live under packages/core/src)\n";
p_a += "     test:coverage -> bun test --coverage\n";
p_a += "     typecheck -> core typecheck\n";
p_a += "     typecheck:types -> core typecheck:types\n";
p_a += "     typecheck:all -> both\n";
p_a += "     baseline:api / baseline:package / baseline\n";
p_a += "     pack:check / publint / attw / validate:package\n";
p_a += "     Prefer: bun run --filter @paykernel/core <script> OR cd packages/core && bun run <script>\n";
p_a += "     Verify Bun 1.4 filter syntax works; if not, use explicit path scripts.\n";
p_a += "6) Create tsconfig.base.json with shared strict options from current tsconfig.json\n";
p_a += "   (target ESNext, module ESNext, moduleResolution bundler, strict, noUncheckedIndexedAccess,\n";
p_a += "   exactOptionalPropertyTypes, etc.). packages/core/tsconfig.json extends it and sets\n";
p_a += "   rootDir/outDir/include for packages/core only.\n";
p_a += "7) Move/adjust tsconfig.type-tests.json under packages/core.\n";
p_a += "8) Copy LICENSE to packages/core/LICENSE; keep root LICENSE.\n";
p_a += "9) Package README: packages/core/README.md should be the published package readme\n";
p_a += "   (adapt structure section for monorepo). Root README can be monorepo overview + links.\n";
p_a += "10) Remove empty root src/ and root dist/ after move (dist will be rebuilt under packages/core).\n";
p_a += "11) Update ALL root scripts under scripts/ that hardcode ROOT/src or ROOT/dist or ROOT/docs:\n";
p_a += "    - generate-api-baseline.ts\n";
p_a += "    - record-package-baseline.ts\n";
p_a += "    - validate-package.sh (must pack packages/core, verify packages/core/dist)\n";
p_a += "    - consumer-smoke.mjs (pack core package)\n";
p_a += "    Prefer a constant CORE = join(ROOT, 'packages/core') and resolve package.json/src/dist/docs there.\n";
p_a += "12) Keep bunfig.toml at root with same coverage thresholds (Phase 0).\n";
p_a += "13) Run bun install at root so workspaces link; regenerate bun.lock.\n";
p_a += "14) From root: bun run build && bun test — fix path issues until green.\n";
p_a += "15) Do NOT add empty packages/adapter-* or gateway-* packages in Phase 1.\n";
p_a += "16) Do NOT configure changesets or boundary checker here — other streams own those.\n";
p_a += "17) After move, relative imports inside packages/core/src must still work (they should).\n";
p_a += "18) Ensure .gitignore still ignores dist, node_modules, coverage, tgz — add packages/*/dist if needed.\n";

let a_result = agent(p_a, #{
    label: "impl:1.1-bun-workspaces",
    capability_mode: "all",
    output_schema: implement_schema,
});

let a_ok = false;
let a_summary = "stream A failed";
if a_result != () && a_result.success && a_result.output != () {
    a_ok = a_result.output.ok == true;
    a_summary = a_result.output.summary;
    log("Stream A ok=" + a_ok.to_string() + " — " + a_summary);
} else {
    log("Stream A agent failed");
}

// Parallel streams for 1.2, 1.3, shared tooling polish
log("Implementing Phase 1.2/1.3 parallel streams");

let p_b = "";
p_b += common;
p_b += "STREAM B — 1.2 Enforce Dependency Rules. OWN PATHS:\n";
p_b += "- " + root + "/scripts/check-workspace-boundaries.ts (or .mjs)\n";
p_b += "- " + root + "/scripts/check-workspace-boundaries.test.ts (optional unit tests for the checker)\n";
p_b += "- " + root + "/docs/workspace-boundaries.md  OR " + root + "/packages/core/docs/workspace-boundaries.md\n";
p_b += "  Prefer monorepo-level: " + root + "/docs/workspace-boundaries.md (create root docs/ if missing)\n";
p_b += "- Do NOT edit root package.json (integrate owns script wiring). Create checker + docs only.\n";
p_b += "- CI: only ADD a step to run check:boundaries (do not gut CI)\n\n";
p_b += "PRECONDITION: packages/core should already exist from Stream A. If not, create checker that still works\n";
p_b += "for packages/* and document expected layout; do not re-do the monorepo move.\n\n";
p_b += "TASKS:\n";
p_b += "1) Document workspace dependency boundaries aligned with roadmap 5.1:\n";
p_b += "   - core must not depend on adapters, ORMs, framework packages, or provider browser SDKs\n";
p_b += "   - testkit may depend on core, webhooks, reconciliation\n";
p_b += "   - webhooks/reconciliation may depend on stable core contracts\n";
p_b += "   - adapters may depend on contracts they implement\n";
p_b += "   - driver deps optional peers / isolated subpaths\n";
p_b += "   - adapter root entry must not auto-import bun:sqlite, node:sqlite, native modules\n";
p_b += "   - CF packages must not leak Workers-only imports into Node/Bun/Deno\n";
p_b += "   - internal/* must not be published\n\n";
p_b += "2) Implement automated checker scripts/check-workspace-boundaries.ts runnable via bun:\n";
p_b += "   Scan packages/* package.json dependency fields (dependencies, devDependencies, peerDependencies,\n";
p_b += "   optionalDependencies) and source imports.\n";
p_b += "   RULES to enforce NOW (must fail CI if violated):\n";
p_b += "   a) Package named @paykernel/core (core) MUST NOT depend on any package matching:\n";
p_b += "      @paykernel/payments-adapter-*, @paykernel/payments-gateway-* (future adapters/gateways),\n";
p_b += "      or path deps into packages/adapter-*, packages/gateway-*.\n";
p_b += "   b) Portable packages (core, and later webhooks/reconciliation/testkit unless marked node-only):\n";
p_b += "      production source under src/ must not import node:fs, node:child_process, node:net, node:http,\n";
p_b += "      node:https, node:cluster, node:worker_threads, 'fs', 'path' (node built-ins via bare names),\n";
p_b += "      bun:sqlite, cloudflare:workers, etc. ALLOW node:crypto if already used carefully — actually\n";
p_b += "      CHECK current core src for any node: imports first. If core currently uses only Web APIs,\n";
p_b += "      ban node: and bun: builtins in packages/core/src production files (not tests).\n";
p_b += "      Tests may use bun:test. Do not ban bun:test in *.test.ts.\n";
p_b += "   c) For any package whose name matches *-adapter-*: package root entry (main/exports[.]) must not\n";
p_b += "      statically import optional peer drivers (pg, ioredis, better-sqlite3, bun:sqlite, node:sqlite).\n";
p_b += "      (No adapters yet — implement rule for future packages so it is ready.)\n";
p_b += "   d) Detect circular package dependencies among workspace packages via package.json deps graph.\n";
p_b += "      Fail with a clear cycle path if found.\n";
p_b += "   e) Fail if any workspace package is not private but lives under packages/internal/* when that exists.\n\n";
p_b += "3) Checker must exit non-zero on violations with human-readable errors; exit 0 when only core exists and clean.\n";
p_b += "4) Do NOT edit package.json — document the script name check:boundaries for integrate to wire.\n";
p_b += "5) Add CI step after install or before/after typecheck: bun run check:boundaries\n";
p_b += "6) Run: bun run scripts/check-workspace-boundaries.ts and ensure it PASSES.\n";
p_b += "7) Optionally add a small self-test or documented negative examples in docs/workspace-boundaries.md.\n";
p_b += "8) Do NOT modify packages/core/src business logic. Do NOT add adapter packages.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — 1.3 Changesets, release notes, npm provenance, prerelease channels. OWN PATHS:\n";
p_c += "- " + root + "/.changeset/**\n";
p_c += "- " + root + "/.github/workflows/release.yml (NEW)\n";
p_c += "- Root package.json: you MAY add @changesets/cli via bun add -d; only add changeset* scripts (no other script keys).\n";
p_c += "- " + root + "/docs/releases.md OR " + root + "/.changeset/README.md explaining workflow\n";
p_c += "- Do NOT restructure packages/core beyond ensuring it is the versioned package for changesets.\n\n";
p_c += "TASKS:\n";
p_c += "1) Install @changesets/cli as root devDependency: bun add -d @changesets/cli\n";
p_c += "2) Configure .changeset/config.json for INDEPENDENT package versioning:\n";
p_c += "   - \"access\": \"public\"\n";
p_c += "   - \"baseBranch\": \"master\" (verify default branch; git branch - shows master)\n";
p_c += "   - \"changelog\": \"@changesets/cli/changelog\" (default is fine)\n";
p_c += "   - \"updateInternalDependencies\": \"patch\"\n";
p_c += "   - \"fixed\": []  (independent, not fixed)\n";
p_c += "   - \"linked\": []\n";
p_c += "   - ignore private root; only version publishable packages under packages/*\n";
p_c += "3) Add a committed .changeset/README.md explaining: bunx changeset, version, publish flow.\n";
p_c += "4) Root scripts:\n";
p_c += "   - \"changeset\": \"changeset\"\n";
p_c += "   - \"version-packages\": \"changeset version\"\n";
p_c += "   - \"release\": \"changeset publish\"  (or document that CI publishes)\n";
p_c += "5) npm provenance: create .github/workflows/release.yml that:\n";
p_c += "   - triggers on push to master (and optionally workflow_dispatch)\n";
p_c += "   - uses changesets/action or equivalent with Bun\n";
p_c += "   - permissions: contents: write, id-token: write, pull-requests: write\n";
p_c += "   - npm publish with provenance: NPM_CONFIG_PROVENANCE=true or publish -w with --provenance\n";
p_c += "   - setup Node + Bun; bun install --frozen-lockfile; build before publish\n";
p_c += "   - Do NOT hardcode secrets; use secrets.NPM_TOKEN / GITHUB_TOKEN\n";
p_c += "   - If changesets/action is used, configure so PRs open for version bumps and publish on merge\n";
p_c += "6) Prerelease channels:\n";
p_c += "   - Document pre mode: bunx changeset pre enter canary (or beta)\n";
p_c += "   - Optionally add script \"changeset:pre:enter\": \"changeset pre enter canary\"\n";
p_c += "     and \"changeset:pre:exit\": \"changeset pre exit\"\n";
p_c += "   - Document in docs/releases.md how to cut canary/beta vs stable\n";
p_c += "7) Generate release notes: changesets changelog generation is the mechanism;\n";
p_c += "   document that `changeset version` updates CHANGELOG.md per package.\n";
p_c += "   You may add an empty packages/core/CHANGELOG.md stub noting pre-changesets history is in git tags.\n";
p_c += "8) Do NOT publish to npm in this task. Do NOT run changeset publish.\n";
p_c += "9) Ensure packages/core/package.json is discoverable by changesets (not private).\n";
p_c += "10) Root package.json must remain private: true so it is not published.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — Shared formatting + lint configuration + monorepo DX polish. OWN PATHS:\n";
p_d += "- " + root + "/.prettierrc  OR " + root + "/prettier.config.js (prefer JSON .prettierrc)\n";
p_d += "- " + root + "/.prettierignore\n";
p_d += "- " + root + "/eslint.config.js  (flat config) OR document Biome — pick ONE stack\n";
p_d += "- Root package.json scripts: format, format:check, lint (add only; do not break existing)\n";
p_d += "- " + root + "/tsconfig.base.json only if Stream A left it missing or incomplete — fix shared options\n";
p_d += "- " + root + "/docs/monorepo.md short developer guide for workspace layout and commands\n";
p_d += "- Update root README.md Package Structure section for monorepo (if root README exists)\n\n";
p_d += "TASKS:\n";
p_d += "1) Prefer lightweight tooling: prettier for format + eslint with typescript-eslint for lint.\n";
p_d += "   Install as root devDependencies: prettier, eslint, typescript-eslint, @eslint/js\n";
p_d += "   (use bun add -d). Keep versions modern and compatible with ESLint 9 flat config.\n";
p_d += "2) Prettier: semi true, singleQuote true, trailingComma all, printWidth 100 — or match existing code style.\n";
p_d += "   Inspect packages/core/src style first and match it (likely single quotes or double — match majority).\n";
p_d += "3) ESLint: lint packages/*/src/**/*.ts, ignore dist, node_modules, coverage.\n";
p_d += "   Start with recommended + typescript recommended; do NOT enable rules that force mass rewrites.\n";
p_d += "   If lint is too noisy on existing code, set severity carefully so `bun run lint` exits 0 on current tree\n";
p_d += "   OR only lint for errors (no unused-vars error if codebase has intentional patterns).\n";
p_d += "   Goal: config exists and is runnable; do not churn all source files for style.\n";
p_d += "4) Scripts: \"format\": \"prettier --write .\", \"format:check\": \"prettier --check .\",\n";
p_d += "   \"lint\": \"eslint packages/*/src --max-warnings 0\" (adjust globs).\n";
p_d += "5) .prettierignore: dist, node_modules, coverage, bun.lock, *.md optional large roadmap if needed,\n";
p_d += "   .changeset folder changelogs if desired.\n";
p_d += "6) docs/monorepo.md: how to build/test from root, package layout, check:boundaries, changesets pointer.\n";
p_d += "7) Do NOT reformat entire codebase in this stream unless format:check already fails and a minimal fix is needed.\n";
p_d += "8) Do NOT touch gateway business logic. Do NOT configure changesets (stream C).\n";

// Sequential B → C → D to avoid root package.json / lockfile races (no parallel writers).
let impl_ok = if a_ok { 1 } else { 0 };
let impl_fail = if a_ok { 0 } else { 1 };

let b_result = agent(p_b, #{
    label: "impl:1.2-dependency-boundaries",
    capability_mode: "all",
    output_schema: implement_schema,
});
if b_result != () && b_result.success && b_result.output != () && b_result.output.ok == true {
    impl_ok += 1;
    log("OK implement B: " + b_result.output.summary);
} else {
    impl_fail += 1;
    log("FAIL implement B");
}

let c_result = agent(p_c, #{
    label: "impl:1.3-changesets-provenance",
    capability_mode: "all",
    output_schema: implement_schema,
});
if c_result != () && c_result.success && c_result.output != () && c_result.output.ok == true {
    impl_ok += 1;
    log("OK implement C: " + c_result.output.summary);
} else {
    impl_fail += 1;
    log("FAIL implement C");
}

let d_result = agent(p_d, #{
    label: "impl:1.1-shared-tooling",
    capability_mode: "all",
    output_schema: implement_schema,
});
if d_result != () && d_result.success && d_result.output != () && d_result.output.ok == true {
    impl_ok += 1;
    log("OK implement D: " + d_result.output.summary);
} else {
    impl_fail += 1;
    log("FAIL implement D");
}
log("Implement done ok=" + impl_ok.to_string() + " fail=" + impl_fail.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "You are integrating Phase 1 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT change payment business logic. Fix cross-stream wiring only.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/core exists with @paykernel/core package.json, src/, docs/, LICENSE, README.\n";
p_int += "2) Root package.json is private workspace with workspaces: [\"packages/*\"].\n";
p_int += "3) YOU OWN root package.json script wiring (streams must not race): forward build/test/typecheck,\n";
p_int += "   baseline*, pack:check, publint, attw, validate:package, check:boundaries, format, lint, changesets.\n";
p_int += "4) tsconfig.base.json exists; packages/core/tsconfig.json extends it.\n";
p_int += "5) scripts/* resolve packages/core paths correctly; validate-package packs CORE package.\n";
p_int += "6) CI (.github/workflows/ci.yml) updated for monorepo:\n";
p_int += "   - bun install --frozen-lockfile\n";
p_int += "   - check:boundaries if present\n";
p_int += "   - typecheck, typecheck:types, test, test:coverage, build\n";
p_int += "   - verify packages/core/dist/index.js and .d.ts\n";
p_int += "   - pack:check / publint / attw / consumer smoke against core package\n";
p_int += "7) Release workflow + .changeset config present (independent versioning, provenance).\n";
p_int += "8) Shared format/lint configs present and scripts work or are documented.\n";
p_int += "9) docs/workspace-boundaries.md (or under packages/core/docs) documents and points to checker.\n";
p_int += "10) Phase 0 artifacts still present under packages/core/docs/baseline/ and behavioral-contracts.md.\n";
p_int += "11) No root-level src/ left behind accidentally (or if temporary, remove).\n";
p_int += "12) bun install; lockfile consistent.\n";
p_int += "13) From root run and FIX until green:\n";
p_int += "    bun run typecheck && bun run typecheck:types && bun test && bun run build\n";
p_int += "    bun run check:boundaries (if script exists)\n";
p_int += "    bun run validate:package\n";
p_int += "14) Consumer import path remains @paykernel/core — smoke must prove it.\n";
p_int += "15) Packed tarball only includes intended files (dist, docs, README, LICENSE, package.json).\n";
p_int += "16) Update any broken relative links in README/docs after moves.\n";
p_int += "17) If Stream A failed partially, complete the monorepo conversion yourself — Phase 1 cannot ship without it.\n";
p_int += "18) Do not invent empty adapter packages. Do not start Phase 2.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase1",
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


let force_fail = false;
if !a_ok {
    force_fail = true;
    log("FORCE_FAIL: Stream A (monorepo foundation) failed");
}
if impl_fail >= 2 {
    force_fail = true;
    log("FORCE_FAIL: multiple implement streams failed");
}
if !integrate_ok && !a_ok {
    force_fail = true;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify Phase 1 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun run typecheck:types\n";
p_ver += "3) cd " + root + " && bun test\n";
p_ver += "4) cd " + root + " && bun test --coverage  (or bun run test:coverage)\n";
p_ver += "5) cd " + root + " && bun run build\n";
p_ver += "6) test -f packages/core/dist/index.js && test -f packages/core/dist/index.d.ts\n";
p_ver += "7) bun run check:boundaries  (must pass)\n";
p_ver += "8) bun run validate:package OR stepwise pack/publint/attw/consumer smoke for core\n";
p_ver += "9) Confirm structure:\n";
p_ver += "   - packages/core/package.json name is @paykernel/core\n";
p_ver += "   - root package.json private true + workspaces\n";
p_ver += "   - tsconfig.base.json exists\n";
p_ver += "   - .changeset/config.json exists with independent versioning\n";
p_ver += "   - release workflow has id-token write / provenance\n";
p_ver += "   - format/lint config files exist\n";
p_ver += "   - workspace boundaries doc exists\n";
p_ver += "   - Phase 0 baseline docs still under packages/core/docs/\n";
p_ver += "10) Confirm root src/ is gone or not the active package source.\n";
p_ver += "11) npm pack dry-run / package contents only intended files.\n\n";
p_ver += "Set ok=true only if typecheck, types tests, tests, coverage, build, pack validation,\n";
p_ver += "boundaries, and changesets config all pass/exist with evidence.\n";
p_ver += "Return full verify_schema including boundaries_ok and changesets_ok.\n";

let ver = agent(p_ver, #{
    label: "verify:phase1",
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
    write_scratch_file("phase1-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 1 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 1 — each PASS or BLOCKING:\n";
p_gate += "A1) Existing import paths continue to work\n";
p_gate += "    Evidence: packages/core package name @paykernel/core; consumer-smoke passes;\n";
p_gate += "    public exports still from package root entry.\n";
p_gate += "A2) The packed core package contains only intended files\n";
p_gate += "    Evidence: npm pack dry-run / package-contents; files field; no src/ in tarball; no monorepo junk.\n";
p_gate += "A3) Workspace dependency boundaries are documented and enforced\n";
p_gate += "    Evidence: docs + check:boundaries script + CI step; checker exits 0; rules cover 1.2 list.\n\n";
p_gate += "Also require Phase 1 tasks 1.1-1.3 deliverables:\n";
p_gate += "- Bun workspaces: packages/core, root private, forwarding scripts, tsconfig.base.json\n";
p_gate += "- Shared formatting and lint configuration present\n";
p_gate += "- Changesets independent versioning configured\n";
p_gate += "- Release notes mechanism (changesets changelog)\n";
p_gate += "- npm provenance in release workflow (id-token: write + provenance publish)\n";
p_gate += "- Prerelease channel docs/scripts\n";
p_gate += "- Phase 0 safety net still green: tests, typecheck, validate:package, coverage thresholds\n";
p_gate += "- No public runtime behavior change (test suite still passes at similar count)\n\n";
p_gate += "Independently re-run: bun test; bun run typecheck; bun run check:boundaries; sample pack check.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-1-gate-report.md (create path if needed)\n";
p_gate += "OR " + root + "/docs/baseline/phase-1-gate-report.md if monorepo docs root exists.\n";
p_gate += "Prefer packages/core/docs/baseline/phase-1-gate-report.md next to phase-0 report if that tree moved.\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase1-adversarial",
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
    write_scratch_file("phase1-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 1 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 1 only — no payment logic changes, no Phase 2 plugins.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete monorepo conversion if incomplete. Wire CI, boundaries, changesets, provenance.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun run typecheck && bun run typecheck:types && bun test && bun test --coverage\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase1-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 1 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test, coverage, build, check:boundaries, validate:package.\n";
    p_re += "Confirm monorepo structure, changesets, provenance workflow, format/lint, boundaries docs.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase1-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase1-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 1 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update phase-1-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 1.1-1.3 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase1-final",
        capability_mode: "all",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        gate_summary = gate2.output.summary;
        log("Final gate pass=" + gate_pass.to_string() + " — " + gate_summary);
        write_scratch_file("phase1-gate-final.json", json_encode(gate2.output));
    } else {
        gate_pass = false;
        gate_summary = "final gate agent failed";
    }
}

// ─── Complete ────────────────────────────────────────────────────
if force_fail && gate_pass && !verify_ok {
    gate_pass = false;
    gate_summary = "FAIL: foundation/implement failed and verify not green (" + gate_summary + ")";
}
let final_status = if gate_pass { "PASS" } else { "FAIL" };
let report = "";
report += "# Phase 1 Workflow Result\n\n";
report += "Status: **" + final_status + "**\n\n";
report += "Gate: " + gate_summary + "\n\n";
report += "Verify: " + verify_summary + "\n\n";
report += "Implement streams ok/fail: " + impl_ok.to_string() + "/" + impl_fail.to_string() + "\n";
let report_path = write_scratch_file("phase1-result.md", report);

complete(#{
    status: final_status,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    implement_ok: impl_ok,
    implement_fail: impl_fail,
    summary: gate_summary,
    report_path: report_path,
});
