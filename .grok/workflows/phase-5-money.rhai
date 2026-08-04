let meta = #{
    name: "phase-5-money",
    description: "Phase 5 Safe Money Model: critic, implement Money/DecimalString/MinorAmount + bigint conversion, migrate gateways, integrate, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 5 roadmap tasks and acceptance criteria" },
        #{ title: "Implement", detail: "money primitives, strict precision, gateway migration, tests, docs" },
        #{ title: "Integrate", detail: "unify streams, public API, baselines, keep green" },
        #{ title: "Verify", detail: "typecheck, tests+coverage, build, pack, boundaries, money evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 5" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 5 (Safe Money Model) for payments-sdk monorepo",
};

let critic_schema = #{
    "type": "object",
    "required": ["gaps", "already_present", "stream_plan", "risks", "summary"],
    "properties": #{
        "gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "already_present": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "stream_plan": #{ "type": "string" },
        "risks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 120 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": [
        "ok", "typecheck_ok", "tests_ok", "build_ok", "boundaries_ok",
        "money_primitives_ok", "strict_precision_ok", "gateway_shared_conversion_ok",
        "numeric_overload_compat_ok", "edge_cases_ok", "no_float_finance_ok",
        "json_serializable_ok", "failures", "summary"
    ],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "pack_ok": #{ "type": "boolean" },
        "coverage_ok": #{ "type": "boolean" },
        "money_primitives_ok": #{ "type": "boolean" },
        "strict_precision_ok": #{ "type": "boolean" },
        "gateway_shared_conversion_ok": #{ "type": "boolean" },
        "numeric_overload_compat_ok": #{ "type": "boolean" },
        "edge_cases_ok": #{ "type": "boolean" },
        "no_float_finance_ok": #{ "type": "boolean" },
        "json_serializable_ok": #{ "type": "boolean" },
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
        "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
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
    "/home/shahin/Documents/projects/personal/packages/payments-sdk"
} else {
    args.root
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 5 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 5 critic for the payments-sdk monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 5 — Safe Money Model\" completely\n";
p_critic += "(Objective, Target API, Tasks 5.1-5.4, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4) and Package Boundary Rules (5.1).\n";
p_critic += "Phases 0-4 are complete — preserve baselines, monorepo, plugin architecture, capabilities,\n";
p_critic += "testkit, pack validation. Do NOT start Phase 6 typed outcomes rewrite, Phase 7 webhooks,\n";
p_critic += "new real providers, or gateway extraction packages.\n\n";
p_critic += "Audit against EVERY Phase 5 task and acceptance criterion:\n\n";
p_critic += "5.1 Introduce Money Primitives — Money, DecimalString, MinorAmount, currency exponent lookup,\n";
p_critic += "    provider exponent overrides, parsing and formatting utilities.\n";
p_critic += "    Target: const amount = money(\"10.50\", \"SAR\");\n";
p_critic += "    type Money<TCurrency extends string = string> = { readonly amount: DecimalString; readonly currency: TCurrency };\n";
p_critic += "    Internally convert validated decimal strings to integer minor units using bigint.\n\n";
p_critic += "5.2 Validate Precision Strictly — Reject excess precision unless an explicit rounding policy\n";
p_critic += "    is supplied. Do not silently round by default.\n\n";
p_critic += "5.3 Migrate Amount Fields (0.x) — accept deprecated numeric overloads; validate conversion\n";
p_critic += "    strictly; document migration warnings. Do NOT break 0.x callers that pass number amounts.\n";
p_critic += "    (1.0.0 Money-only is documented destination, not this phase's hard break.)\n\n";
p_critic += "5.4 Test Currency Edge Cases — zero-, two-, and three-decimal currencies; large values;\n";
p_critic += "    invalid precision; exponent overrides; intentional negative marketplace adjustments.\n\n";
p_critic += "Acceptance criteria:\n";
p_critic += "- no financial calculation relies on binary floating point\n";
p_critic += "- JSON serialization remains straightforward\n";
p_critic += "- every gateway uses shared conversion primitives\n\n";
p_critic += "Inspect thoroughly:\n";
p_critic += "- packages/core/src/utils/currency.ts and currency.test.ts (only getCurrencyExponent today)\n";
p_critic += "- packages/core/src/gateways/{moyasar,stripe,paypal,paymob}/* amount conversion (toMinorUnits,\n";
p_critic += "  fromMinorUnits, toStripeAmount, formatAmount) — each uses Math.round * float today\n";
p_critic += "- packages/core/src/types/payment.types.ts CreatePaymentParams.amount: number warnings\n";
p_critic += "- packages/core/src/index.ts public exports (currency helpers NOT exported today)\n";
p_critic += "- packages/testkit mock gateway amount handling and conformance amount_conversion case\n";
p_critic += "- packages/core/docs/*, public-api baseline, CHANGELOG patterns\n";
p_critic += "- Stripe provider-specific exponents (ISK/UGX etc), PayPal zero-decimal, Paymob overrides\n\n";
p_critic += "CRITICAL GAPS to confirm with evidence:\n";
p_critic += "1) No Money / DecimalString / MinorAmount / money() factory\n";
p_critic += "2) No shared toMinorUnits/fromMinorUnits using bigint — gateways each roll their own float math\n";
p_critic += "3) Silent/near-silent float rounding risk (Math.round(amount * 10**n))\n";
p_critic += "4) Public API does not export money primitives\n";
p_critic += "5) Missing edge-case tests for large values, negative splits, overrides, invalid precision\n";
p_critic += "6) Migration docs for number -> Money path\n\n";
p_critic += "List concrete GAPS. List ALREADY_PRESENT (getCurrencyExponent ISO tables, per-gateway precision\n";
p_critic += "rejection attempts, Paymob currencyExponentOverrides, Stripe three-decimal div-by-10 rules).\n";
p_critic += "stream_plan for implement order. risks: breaking 0.x number callers; float remaining in gateways;\n";
p_critic += "bigint JSON issues; Number() coercion losing precision; Stripe/PayPal provider exponent divergence\n";
p_critic += "from ISO; over-wide public API; testkit/mock drift; baseline regeneration requirements.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase5-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase5-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 5 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 5\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 5 Safe Money Model in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core package is packages/core = @paykernel/core (0.8.0).\n";
common += "Testkit: packages/testkit = @paykernel/testkit (depends on core).\n";
common += "PHASE 5 ONLY: Safe Money Model. Do NOT start Phase 6 outcome unions, Phase 7 webhooks,\n";
common += "new PSPs, gateway extraction packages, or storage adapters.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-4: monorepo, baselines, plugin architecture,\n";
common += "capabilities, createPaymentClient, registry, factories, pack validation, coverage thresholds, testkit.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change.\n";
common += "2) No unsafe mutation retries without native idempotency or atomic dedup.\n";
common += "3) Never convert uncertain outcomes into failure.\n";
common += "4) Do not hide provider differences (Stripe/PayPal exponent overrides stay explicit).\n";
common += "5) No secret leakage.\n";
common += "6) No framework coupling.\n";
common += "7) No Node-only assumptions in portable packages.\n";
common += "8) Keep 0.x backward compat: number amounts still accepted (deprecated path).\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) Financial math: bigint minor units + decimal strings — NEVER amount * 100 float for conversion.\n";
common += "11) exactOptionalPropertyTypes is ON — respect optional props carefully.\n";
common += "12) Core must NOT depend on testkit.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: money primitives + public API + types migration
let p_a = "";
p_a += common;
p_a += "STREAM A — MONEY PRIMITIVES + PUBLIC SURFACE + TYPE MIGRATION (Tasks 5.1, 5.2, partial 5.3).\n";
p_a += "You own packages/core/src/utils/money.ts (new), expand packages/core/src/utils/currency.ts,\n";
p_a += "packages/core/src/types/payment.types.ts amount fields, packages/core/src/index.ts exports,\n";
p_a += "money/currency unit tests, migration docs. Coordinate types so Stream B can import helpers.\n\n";

p_a += "### 1) Expand currency.ts (keep getCurrencyExponent, add override support)\n";
p_a += "```ts\n";
p_a += "export type CurrencyCode = string; // ISO 4217 uppercased at normalize time\n";
p_a += "export type CurrencyExponentOverrides = Readonly<Record<string, number>>;\n";
p_a += "export function normalizeCurrencyCode(currency: string): string; // trim + uppercase\n";
p_a += "export function getCurrencyExponent(currency: string, overrides?: CurrencyExponentOverrides): number;\n";
p_a += "// Existing ZERO_DECIMAL / THREE_DECIMAL tables stay; override wins when valid integer >= 0\n";
p_a += "// Reject invalid override values (non-integer, negative) by ignoring or throwing — prefer throw\n";
p_a += "// if override is explicitly provided but invalid (document choice).\n";
p_a += "```\n";
p_a += "Provider-specific tables MUST remain gateway-local (Stripe ISK special cases, PayPal zero-decimal\n";
p_a += "list, Paymob merchant overrides) but ALL conversion math goes through shared money helpers that\n";
p_a += "accept an explicit exponent or overrides map. Do not hide provider differences inside ISO-only lookup.\n\n";

p_a += "### 2) Create packages/core/src/utils/money.ts — THE shared conversion primitive\n";
p_a += "Target API from roadmap:\n";
p_a += "```ts\n";
p_a += "export type DecimalString = string; // validated decimal representation, e.g. \"10.50\", \"100\", \"-1.250\"\n";
p_a += "export type MinorAmount = bigint;\n";
p_a += "export type Money<TCurrency extends string = string> = {\n";
p_a += "  readonly amount: DecimalString;\n";
p_a += "  readonly currency: TCurrency;\n";
p_a += "};\n";
p_a += "export type MoneyRoundingMode =\n";
p_a += "  | 'reject'      // default: throw on excess fractional digits\n";
p_a += "  | 'half_up'\n";
p_a += "  | 'half_even'   // banker's rounding\n";
p_a += "  | 'floor'\n";
p_a += "  | 'ceil'\n";
p_a += "  | 'trunc';\n";
p_a += "export type MoneyParseOptions = {\n";
p_a += "  rounding?: MoneyRoundingMode; // default 'reject'\n";
p_a += "  exponentOverrides?: CurrencyExponentOverrides;\n";
p_a += "  /** When set, use this exponent instead of ISO/override lookup */\n";
p_a += "  exponent?: number;\n";
p_a += "  allowNegative?: boolean; // default false for payments; true for marketplace splits\n";
p_a += "  allowZero?: boolean; // default false for charges; true where providers allow 0\n";
p_a += "};\n";
p_a += "```\n\n";
p_a += "REQUIRED FUNCTIONS:\n";
p_a += "1) money(amount: string | number | DecimalString, currency: string, options?: MoneyParseOptions): Money\n";
p_a += "   - Prefer string inputs. number is accepted for 0.x but MUST convert via safe path:\n";
p_a += "     reject non-finite; use decimal stringification that does not invent float junk for clean decimals.\n";
p_a += "     For number inputs, convert with a careful algorithm: if Number.isInteger use String; else use\n";
p_a += "     a fixed decimal expansion that rejects values that cannot be represented exactly as decimal\n";
p_a += "     within currency precision (or parse via toFixed only after validating max decimals — prefer\n";
p_a += "     string path documentation). Safest approach for number: format with enough precision then\n";
p_a += "     apply the same strict decimal parser; reject if back-conversion would differ beyond currency\n";
p_a += "     precision under rounding=reject.\n";
p_a += "   - Normalize currency to uppercase ISO code.\n";
p_a += "   - Return frozen or readonly Money { amount: normalized DecimalString, currency }.\n";
p_a += "   - amount field must be a clean decimal string (no scientific notation, no leading '+',\n";
p_a += "     no trailing junk). Normalize \"10.5\" / \"10.50\" to a canonical form OR keep input precision\n";
p_a += "     within currency exponent (document). Prefer canonical minor-aligned form when exact\n";
p_a += "     (e.g. pad/trim zeros carefully without changing value).\n";
p_a += "2) isMoney(value: unknown): value is Money\n";
p_a += "3) parseDecimalString(value: string): { sign, integerPart, fractionPart } internal helper\n";
p_a += "4) toMinorUnits(amount: string | number | Money, currencyOrOptions?, options?): MinorAmount\n";
p_a += "   - ALWAYS use bigint for the integer minor unit result.\n";
p_a += "   - Algorithm: parse decimal string; combine integer and fractional digits into bigint scaled by\n";
p_a += "     10**exponent; if excess fractional digits, apply rounding mode (default reject throws\n";
p_a += "     InvalidRequestError or MoneyError).\n";
p_a += "   - NEVER do `amount * 100` with JS number for the conversion result path.\n";
p_a += "5) fromMinorUnits(minor: MinorAmount | number | bigint, currency: string, options?): Money\n";
p_a += "   - Convert minor units to DecimalString via bigint division/modulo; no float.\n";
p_a += "6) formatMoney(m: Money, options?: { locale?: never }): string — simple \"{amount} {currency}\"\n";
p_a += "7) minorAmountToNumber(minor: MinorAmount): number — only when safe (within Number.MAX_SAFE_INTEGER);\n";
p_a += "   throw if unsafe. Used only at provider API boundaries that require number (Stripe integer cents).\n";
p_a += "8) moneyToMajorNumber(m: Money, options?): number — 0.x interop for results that still use number;\n";
p_a += "   only for safe magnitudes; document float risk for display-only legacy fields.\n";
p_a += "9) assertValidDecimalString / validateMoney\n";
p_a += "10) compareMoney / addMoney / subtractMoney — OPTIONAL only if needed by tests; prefer keep minimal.\n";
p_a += "    If you add arithmetic, must be bigint-based and same-currency only.\n\n";

p_a += "STRICT PRECISION (5.2):\n";
p_a += "- Default rounding is 'reject'. Example: money(\"10.999\", \"SAR\") throws; money(\"10.999\", \"SAR\",\n";
p_a += "  { rounding: 'half_up' }) becomes amount with 2 decimals (11.00).\n";
p_a += "- Zero-decimal: money(\"10.5\", \"JPY\") rejects; money(\"10\", \"JPY\") ok.\n";
p_a += "- Three-decimal: money(\"1.234\", \"KWD\") ok; money(\"1.2345\", \"KWD\") rejects without policy.\n";
p_a += "- Throw InvalidRequestError from ../errors (or a dedicated MoneyError extending PaymentError) with clear messages.\n\n";

p_a += "JSON serialization: Money is a plain object { amount: string, currency: string } — JSON.stringify works.\n";
p_a += "Do NOT use bigint on the public Money type. MinorAmount is bigint for internal conversion only;\n";
p_a += "when serializing minors for storage, use string of the bigint if needed.\n\n";

p_a += "### 3) Migrate amount field types (5.3 0.x)\n";
p_a += "In payment.types.ts:\n";
p_a += "```ts\n";
p_a += "import type { Money } from \"../utils/money\"; // or types/money.types.ts re-export\n";
p_a += "/** Amount input accepted during 0.x. Prefer Money / money(\"10.50\", \"SAR\"). number is deprecated. */\n";
p_a += "export type AmountInput = number | Money;\n";
p_a += "// CreatePaymentParams.amount: AmountInput  (was number)\n";
p_a += "// CaptureParams.amount?: AmountInput\n";
p_a += "// RefundParams.amount?: AmountInput\n";
p_a += "// MoyasarPaymentSplit.amount: AmountInput (allowNegative via conversion options)\n";
p_a += "```\n";
p_a += "Keep PaymentResult / GatewayPaymentResult.amount as number for 0.x response shape stability\n";
p_a += "(Phase 6/1.0 may switch to Money). Document deprecation on input number and that results still\n";
p_a += "use major-unit number derived via shared fromMinorUnits + safe conversion.\n";
p_a += "Update JSDoc on CreatePaymentParams.amount to point at money() and warn about float.\n\n";

p_a += "### 4) Public exports from packages/core/src/index.ts\n";
p_a += "Export value: money, isMoney, toMinorUnits, fromMinorUnits, formatMoney, minorAmountToNumber,\n";
p_a += "getCurrencyExponent, normalizeCurrencyCode (and any other essential helpers).\n";
p_a += "Export types: Money, DecimalString, MinorAmount, MoneyParseOptions, MoneyRoundingMode,\n";
p_a += "CurrencyExponentOverrides, AmountInput.\n";
p_a += "Update public-api.test.ts and public-api.types.test.ts for new exports and AmountInput acceptance.\n\n";

p_a += "### 5) Tests (packages/core/src/utils/money.test.ts + expand currency.test.ts)\n";
p_a += "Cover:\n";
p_a += "- money(\"10.50\", \"SAR\") shape and JSON.stringify roundtrip\n";
p_a += "- toMinorUnits string path: SAR 10.50 -> 1050n; JPY 10 -> 10n; KWD 1.234 -> 1234n\n";
p_a += "- reject excess precision by default\n";
p_a += "- each rounding mode at least one case\n";
p_a += "- large values: near/above MAX_SAFE_INTEGER minors (bigint still works; minorAmountToNumber throws)\n";
p_a += "- negative amounts with allowNegative true (marketplace); reject when false\n";
p_a += "- zero with allowZero\n";
p_a += "- exponent overrides\n";
p_a += "- invalid strings: \"\", \"10.\", \".5\", \"1e2\", \"NaN\", \"abc\", \"++1\"\n";
p_a += "- number overload deprecated path still works for clean values like 10.5, 99.99\n";
p_a += "- fromMinorUnits 1050n SAR -> amount \"10.50\" (or canonical equal value)\n";
p_a += "No float-based conversion in implementation — greppable guarantee.\n\n";

p_a += "### 6) Docs\n";
p_a += "- packages/core/docs/ (new money.md or section) documenting money(), migration from number,\n";
p_a += "  rounding policies, provider exponent overrides, bigint internal model.\n";
p_a += "- Update packages/core/README.md brief mention if amount section exists.\n";
p_a += "- packages/core/CHANGELOG.md entry under Unreleased/0.x for Phase 5 money primitives.\n";
p_a += "- Do NOT write phase-5-gate-report.md (Gate agent owns it).\n\n";

p_a += "### 7) Errors\n";
p_a += "Use InvalidRequestError for bad amounts (consistent with gateways) OR add MoneyError extending\n";
p_a += "PaymentError. Prefer InvalidRequestError for less surface area unless MoneyError is cleaner.\n";
p_a += "Messages must not include secrets.\n\n";

p_a += "After implement: bun test packages/core/src/utils/money.test.ts packages/core/src/utils/currency.test.ts\n";
p_a += "and typecheck core. Stream B will migrate gateways onto these helpers.\n";

let a_result = agent(p_a, #{
    label: "impl:5-money-primitives",
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

// Parallel streams B, C, D
log("Implementing Phase 5 gateway migration, edge tests, testkit/docs in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — MIGRATE ALL GATEWAYS TO SHARED CONVERSION PRIMITIVES (Tasks 5.1/5.3 + acceptance).\n";
p_b += "PRECONDITION: Stream A may have created packages/core/src/utils/money.ts. If missing, create\n";
p_b += "the full money module yourself (copy requirements from Stream A) then migrate gateways.\n";
p_b += "OWN: packages/core/src/gateways/{moyasar,stripe,paypal,paymob}/*.ts conversion paths.\n\n";
p_b += "GOAL: Every gateway uses shared toMinorUnits/fromMinorUnits (or money()+toMinorUnits) for\n";
p_b += "financial conversion. Remove local Math.round(amount * factor) conversion implementations.\n\n";

p_b += "### Shared pattern\n";
p_b += "```ts\n";
p_b += "import { toMinorUnits, fromMinorUnits, minorAmountToNumber, money, isMoney } from \"../../utils/money\";\n";
p_b += "import { getCurrencyExponent, normalizeCurrencyCode } from \"../../utils/currency\";\n";
p_b += "// When calling provider APIs that need JS number minor units:\n";
p_b += "const minor = toMinorUnits(params.amount, currency, { exponent, allowNegative, allowZero, rounding: 'reject' });\n";
p_b += "const minorNumber = minorAmountToNumber(minor); // throws if > MAX_SAFE_INTEGER\n";
p_b += "// When mapping provider responses back to major units (0.x number results):\n";
p_b += "const majorMoney = fromMinorUnits(BigInt(providerMinor), currency, { exponent });\n";
p_b += "const majorNumber = moneyToMajorNumber(majorMoney); // or export a helper majorNumberFromMinor\n";
p_b += "```\n\n";

p_b += "### Moyasar (moyasar.gateway.ts)\n";
p_b += "- Replace private toMinorUnits/fromMinorUnits with shared helpers + getCurrencyExponent.\n";
p_b += "- Splits: allowNegative true, reject zero (existing semantics).\n";
p_b += "- Top-level amounts: positive, at least 1 minor unit.\n";
p_b += "- Accept AmountInput (number | Money) on create/capture/refund/splits.\n";
p_b += "- Keep all existing tests green; add cases for Money input and precision reject.\n\n";

p_b += "### Stripe (stripe.gateway.ts)\n";
p_b += "- Replace toStripeAmount/fromStripeAmount float math with shared conversion.\n";
p_b += "- KEEP Stripe-specific exponent table (stripeCurrencyExponent) — pass as `exponent` option\n";
p_b += "  to shared toMinorUnits so provider differences stay explicit.\n";
p_b += "- KEEP three-decimal divisible-by-10 rule and max charge limits AFTER conversion to minor bigint/number.\n";
p_b += "- KEEP whole-unit-only currency checks for Stripe special currencies.\n";
p_b += "- Accept AmountInput on create/capture/refund paths.\n";
p_b += "- fromStripeAmount: shared fromMinorUnits then major number for result.amount.\n\n";

p_b += "### PayPal (paypal.gateway.ts)\n";
p_b += "- formatAmount currently uses Math.round float — replace with shared toMinorUnits + format from minor\n";
p_b += "  or decimal string formatting via fromMinorUnits (PayPal wants string major units with scale 0 or 2).\n";
p_b += "- KEEP PAYPAL_ZERO_DECIMAL_CURRENCIES as exponent source (0 vs 2) passed into shared helpers.\n";
p_b += "- parseAmount response path: parse provider string via money()/toMinorUnits path, not parseFloat alone.\n";
p_b += "- Accept AmountInput.\n\n";

p_b += "### Paymob (paymob.gateway.ts)\n";
p_b += "- Replace private toMinorUnits/fromMinorUnits with shared helpers.\n";
p_b += "- KEEP currencyExponentOverrides from config — pass as exponentOverrides or resolved exponent\n";
p_b += "  via currencyFractionDigits.\n";
p_b += "- Accept AmountInput.\n\n";

p_b += "### Validation / client\n";
p_b += "- If zod schemas coerce amount as number only, widen to accept Money object or preprocess:\n";
p_b += "  number | { amount: string, currency: string }. Read packages/core/src/types/validation.ts.\n";
p_b += "- PaymentClient / BaseGateway must not reintroduce float conversion.\n";
p_b += "- Hooks still see params.amount as AmountInput.\n\n";

p_b += "### Grep guarantee after migration\n";
p_b += "Search gateways for `Math.round(.*amount` and `amount * 10` / `amount * factor` conversion paths.\n";
p_b += "Financial conversion MUST go through utils/money. Non-money uses of Math.round (timestamps etc) OK.\n\n";

p_b += "### Tests\n";
p_b += "Update gateway tests: still pass with number; add Money input cases for at least one path per gateway.\n";
p_b += "Precision rejection still works (existing Stripe/Moyasar tests).\n";
p_b += "Run: bun test packages/core\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — EDGE-CASE TESTS + NO-FLOAT AUDIT (Task 5.4 + acceptance criteria).\n";
p_c += "OWN: comprehensive money edge tests, cross-gateway conversion consistency tests,\n";
p_c += "packages/core/src/utils/money.edge.test.ts (or expand money.test.ts), and a focused\n";
p_c += "packages/core/src/utils/money-gateway-integration.test.ts if needed.\n";
p_c += "If money.ts missing, implement minimal shared API first so tests can lock behavior.\n\n";

p_c += "REQUIRED EDGE CASES (5.4):\n";
p_c += "1) Zero-decimal: JPY, KRW, VND, XOF, ISK (ISO 0) — money(\"100\", \"JPY\"); reject \"100.1\"\n";
p_c += "2) Two-decimal: SAR, USD, EUR — \"10.50\" -> 1050n; reject \"10.501\"\n";
p_c += "3) Three-decimal: KWD, BHD, OMR, JOD — \"1.234\" -> 1234n; reject \"1.2345\"\n";
p_c += "4) Large values: amount strings that produce minor > Number.MAX_SAFE_INTEGER — toMinorUnits works\n";
p_c += "   as bigint; minorAmountToNumber throws; gateways should throw InvalidRequestError for unsafe provider send\n";
p_c += "5) Invalid precision: excess digits rejected by default for each exponent class\n";
p_c += "6) Exponent overrides: getCurrencyExponent('OMR', { OMR: 2 }) or toMinorUnits with overrides\n";
p_c += "7) Intentional negative marketplace adjustments: toMinorUnits(-5, 'SAR', { allowNegative: true }) -> -500n;\n";
p_c += "   without allowNegative throws. Moyasar split path documented/tested if accessible.\n";
p_c += "8) Rounding policies: half_up, half_even, floor, ceil, trunc at least one each with excess digits\n";
p_c += "9) JSON: JSON.stringify(money(\"10.50\",\"SAR\")) parses back to equal amount+currency\n";
p_c += "10) fromMinorUnits / toMinorUnits roundtrip for 0/2/3 decimal currencies\n";
p_c += "11) Case-insensitive currency codes\n";
p_c += "12) Whitespace-trimmed currency; invalid currency still gets default exponent 2 unless empty throws\n\n";

p_c += "NO FLOAT FINANCE AUDIT:\n";
p_c += "- After streams, grep packages/core/src for financial conversion anti-patterns in money path.\n";
p_c += "- Write a test or comment in money.test that documents the invariant: conversion uses bigint.\n";
p_c += "- Optionally: unit test that money(\"0.1\", \"USD\") + conceptual check 0.1+0.2 float issue is avoided\n";
p_c += "  when using string path money(\"0.1\",\"USD\") / money(\"0.2\",\"USD\") minors 10n+20n=30n.\n\n";

p_c += "Do not weaken gateway business rules. Focus tests. Fix money module bugs found during tests.\n";
p_c += "Run bun test packages/core/src/utils\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — TESTKIT ALIGNMENT + DOCS + CHANGELOG + BASELINE HOOKS.\n";
p_d += "OWN: packages/testkit mock gateway amount handling if it duplicates float conversion;\n";
p_d += "conformance amount_conversion case; monorepo docs; core docs money migration; CHANGELOG;\n";
p_d += "public API freeze tests if Stream A missed them.\n\n";

p_d += "### Testkit\n";
p_d += "packages/testkit depends on @paykernel/core. Prefer importing money/toMinorUnits from core\n";
p_d += "for any amount math in mock gateway. If mock tracks remaining capture/refund with floats, migrate\n";
p_d += "to integer minor units (number safe integers OR bigint) via shared helpers.\n";
p_d += "amount_conversion conformance case should still pass; enhance if fixtures need Money inputs.\n";
p_d += "Keep testkit tests green: bun test packages/testkit\n\n";

p_d += "### Docs (must exist before gate)\n";
p_d += "1) packages/core/docs/money.md — full Phase 5 money guide:\n";
p_d += "   - money(\"10.50\", \"SAR\")\n";
p_d += "   - why not float\n";
p_d += "   - DecimalString / Money / MinorAmount (bigint internal)\n";
p_d += "   - strict precision + rounding modes\n";
p_d += "   - 0.x number overload deprecation and migration\n";
p_d += "   - provider exponent overrides (Stripe/PayPal/Paymob)\n";
p_d += "   - negative marketplace splits\n";
p_d += "   - JSON serialization\n";
p_d += "2) Cross-link from packages/core/README.md and docs/custom-gateways.md (custom adapters must use shared conversion)\n";
p_d += "3) packages/core/CHANGELOG.md Unreleased: Money primitives, shared conversion, deprecated number inputs\n";
p_d += "4) packages/testkit/README.md note if mock uses shared money\n";
p_d += "5) Update CreatePaymentParams docs already in types\n\n";

p_d += "### Baselines\n";
p_d += "Public API baseline will gain new exports — after build, regenerate if scripts exist:\n";
p_d += "  bun run baseline:api  (or generate-api-baseline)\n";
p_d += "Only if that is the established Phase 0 process and won't destroy intentional freezes.\n";
p_d += "Read packages/core/docs/baseline/README.md. If baseline is strict freeze, document additive exports\n";
p_d += "in CHANGELOG and update public-api.md via generator. Additive 0.x exports are expected for Phase 5.\n\n";

p_d += "### public-api tests\n";
p_d += "Ensure money, toMinorUnits, fromMinorUnits, getCurrencyExponent appear in public-api.test.ts freeze list.\n";
p_d += "Type tests: AmountInput accepts Money and number; money() return type.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:5-gateway-migration", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:5-edge-tests", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "impl:5-testkit-docs", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok = if a_ok { 1 } else { 0 };
let impl_fail = if a_ok { 0 } else { 1 };
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
p_int += "You are integrating Phase 5 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 6+.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/core/src/utils/money.ts exists with money(), Money, DecimalString, MinorAmount (bigint),\n";
p_int += "   toMinorUnits, fromMinorUnits, formatMoney, strict precision default reject, rounding modes.\n";
p_int += "2) currency.ts has getCurrencyExponent with optional overrides + normalizeCurrencyCode.\n";
p_int += "3) NO gateway implements financial conversion with Math.round(amount * 10**n) float paths.\n";
p_int += "   All four gateways use shared money helpers; provider exponent tables remain gateway-local inputs.\n";
p_int += "4) CreatePaymentParams/Capture/Refund/splits accept AmountInput = number | Money; number deprecated in docs.\n";
p_int += "5) Public exports complete; public-api tests updated.\n";
p_int += "6) Edge-case tests cover 0/2/3 decimal, large values, invalid precision, overrides, negatives.\n";
p_int += "7) JSON serialization of Money is plain {amount, currency} strings.\n";
p_int += "8) Existing number-based callers and tests still pass (0.x compat).\n";
p_int += "9) Testkit still green; mock uses shared conversion if it does money math.\n";
p_int += "10) docs/money.md + CHANGELOG + cross-links written.\n";
p_int += "11) Phase 0-4 safety: typecheck, tests core+testkit, build, boundaries, validate:package path green.\n";
p_int += "12) Coverage thresholds for core still met.\n";
p_int += "13) No secret leakage; no Phase 6 outcome union rewrite; no new packages.\n";
p_int += "14) Fix logical bugs: silent float rounding remaining; bigint leaked into JSON Money; Money without\n";
p_int += "    currency validation; accepting excess precision by default; Number(bigint) precision loss at\n";
p_int += "    provider boundary without check; breaking stripe three-decimal div-by-10; paymob overrides ignored.\n";
p_int += "15) exactOptionalPropertyTypes: careful with optional amount fields.\n";
p_int += "16) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run validate:package  (if time; at least pack:check + typecheck)\n";
p_int += "17) If Stream A failed, implement money.ts fully yourself. Phase 5 cannot ship without it.\n";
p_int += "18) Regenerate API baseline if that is standard after additive exports.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase5",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || int_result.output.ok != true {
    log("Integrate reported issues — verify will surface details");
} else {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify Phase 5 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/core/dist/index.js && test -f packages/core/dist/utils/money.d.ts || find dist for money types\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run validate:package (or pack:check + publint + attw)\n";
p_ver += "10) Evidence money() exported from package entry (grep index.ts / public-api test)\n";
p_ver += "11) Evidence toMinorUnits uses bigint (read money.ts)\n";
p_ver += "12) Evidence default precision reject (tests)\n";
p_ver += "13) Evidence all 4 gateways import from utils/money (grep)\n";
p_ver += "14) Evidence no Math.round amount*float conversion remains in gateway money paths (grep)\n";
p_ver += "15) Evidence AmountInput number|Money and number still works in tests\n";
p_ver += "16) Evidence edge cases 0/2/3 decimal, large, negative, overrides\n";
p_ver += "17) Evidence docs/money.md exists\n";
p_ver += "18) Evidence JSON Money serializable (test or ad-hoc)\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- money_primitives_ok: Money, DecimalString, MinorAmount, money(), currency lookup/overrides\n";
p_ver += "- strict_precision_ok: default reject + rounding policy option\n";
p_ver += "- gateway_shared_conversion_ok: all gateways use shared primitives; no float conversion paths\n";
p_ver += "- numeric_overload_compat_ok: number still accepted and tested\n";
p_ver += "- edge_cases_ok: 5.4 coverage\n";
p_ver += "- no_float_finance_ok: financial calc not relying on binary float\n";
p_ver += "- json_serializable_ok: Money JSON plain object\n";
p_ver += "Set ok=true only if typecheck, tests (core+testkit), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase5",
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
    write_scratch_file("phase5-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 5 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 5 — each PASS or BLOCKING:\n";
p_gate += "A1) No financial calculation relies on binary floating point.\n";
p_gate += "    Evidence: money.ts uses bigint minor units + decimal strings; gateways call shared helpers;\n";
p_gate += "    grep shows no amount*100 float conversion for money in gateways.\n";
p_gate += "A2) JSON serialization remains straightforward.\n";
p_gate += "    Evidence: Money is {amount: string, currency: string}; tests JSON.stringify roundtrip.\n";
p_gate += "A3) Every gateway uses shared conversion primitives.\n";
p_gate += "    Evidence: moyasar, stripe, paypal, paymob all import/use utils/money conversion.\n\n";
p_gate += "Also require Phase 5 tasks 5.1-5.4 deliverables:\n";
p_gate += "- 5.1 Money, DecimalString, MinorAmount, currency exponent lookup, provider exponent overrides,\n";
p_gate += "  parsing/formatting, money() factory matching roadmap Target API\n";
p_gate += "- 5.2 Reject excess precision unless explicit rounding policy supplied\n";
p_gate += "- 5.3 0.x deprecated numeric overloads accepted + migration docs; strict validation\n";
p_gate += "- 5.4 Edge tests: 0/2/3 decimal, large values, invalid precision, overrides, negative marketplace\n";
p_gate += "- Phase 0-4 safety net still green; boundaries; no core→testkit dep\n";
p_gate += "- No logical bugs: silent rounding by default; float conversion leftover; unsafe Number(bigint);\n";
p_gate += "  Money with bigint fields; broken Stripe three-decimal rules; ignored Paymob overrides.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit; bun run typecheck; check:boundaries.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-5-gate-report.md\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase5-adversarial",
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
    write_scratch_file("phase5-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 5 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 5 only — no Phase 6 outcomes, no new providers.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete money primitives if incomplete; migrate all gateways; strict precision; edge tests;\n";
    p_fix += "0.x number compat; docs; public exports; eliminate float financial conversion.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase5-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 5 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit, coverage, build, boundaries.\n";
    p_re += "Confirm all 5.1-5.4 deliverables and acceptance criteria with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase5-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase5-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 5 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A3 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/core/docs/baseline/phase-5-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 5.1-5.4 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase5-final",
        capability_mode: "all",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        gate_summary = gate2.output.summary;
        if gate2.output.blocking != () {
            blocking_json = json_encode(gate2.output.blocking);
        }
        log("Final gate pass=" + gate_pass.to_string() + " — " + gate_summary);
        write_scratch_file("phase5-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 5 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 5,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
