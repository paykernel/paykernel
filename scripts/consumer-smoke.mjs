#!/usr/bin/env node
/**
 * Consumer smoke: install the packed tarball and exercise the public entry
 * from both Bun and Node (ESM). No network calls to payment providers.
 *
 * Asserts (Phase 8.4 / 8.5):
 * - Package root import resolves (`PaymentClient`, `createPaymentClient`, …)
 * - `createPaymentRuntime` is present and returns a runtime bag
 * - Portable Stripe-style webhook HMAC verify works without `node:crypto`
 *   in the package import path (pure helpers + gateway `verifyWebhook`)
 * - Mock-adapter `createPaymentClient({ runtime })` constructs successfully
 *
 * Usage:
 *   bun run scripts/consumer-smoke.mjs [path/to/package.tgz]
 *
 * If no tarball path is given, runs `npm pack` in packages/core first.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CORE = join(ROOT, "packages", "core");
const PKG_NAME = "@paykernel/core";

/** @type {string[]} */
const temps = [];

async function cleanup() {
  for (const dir of temps.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (exit ${result.status})\n` +
        (result.stdout || "") +
        (result.stderr || ""),
    );
  }
  return result;
}

async function ensureTarball(argPath) {
  if (argPath) {
    return resolve(argPath);
  }
  const packDir = await mkdtemp(join(tmpdir(), "paykernel-smoke-pack-"));
  temps.push(packDir);
  const out = run("npm", ["pack", "--pack-destination", packDir], {
    cwd: CORE,
  });
  const lines = (out.stdout || "").trim().split("\n").filter(Boolean);
  const name = lines[lines.length - 1];
  if (!name) {
    throw new Error("npm pack produced no tarball name");
  }
  return join(packDir, name);
}

/**
 * Functional smoke payload shared by Bun and Node consumers.
 * Uses only the public package entry — no monorepo path imports.
 */
function buildCheckSource() {
  return `
import {
  PaymentClient,
  createPaymentClient,
  createPaymentRuntime,
  createDefaultGatewayContext,
  stripeGateway,
  hmacSha256Hex,
  timingSafeEqualHex,
  sha256Hex,
} from ${JSON.stringify(PKG_NAME)};

function assert(cond, msg) {
  if (!cond) {
    console.error("assertion failed:", msg);
    process.exit(1);
  }
}

// ── 1) Core exports ──────────────────────────────────────────────────────────
assert(typeof PaymentClient === "function", "PaymentClient");
assert(typeof createPaymentClient === "function", "createPaymentClient");
assert(typeof createPaymentRuntime === "function", "createPaymentRuntime");
assert(typeof createDefaultGatewayContext === "function", "createDefaultGatewayContext");
assert(typeof hmacSha256Hex === "function", "hmacSha256Hex");
assert(typeof timingSafeEqualHex === "function", "timingSafeEqualHex");
assert(typeof sha256Hex === "function", "sha256Hex");

// ── 2) createPaymentRuntime defaults (portable bag, no secrets) ──────────────
const runtime = createPaymentRuntime();
assert(typeof runtime.fetch === "function", "runtime.fetch");
assert(typeof runtime.randomUUID === "function", "runtime.randomUUID");
assert(typeof runtime.clock.nowMs === "function", "runtime.clock.nowMs");
assert(typeof runtime.crypto.getRandomValues === "function", "runtime.crypto.getRandomValues");
const id = runtime.randomUUID();
assert(typeof id === "string" && id.length >= 32, "randomUUID format");

// ── 3) Portable pure HMAC (Stripe-style) without package node:crypto ─────────
const secret = "whsec_smoke_test_secret";
const rawBody = JSON.stringify({
  id: "evt_smoke",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_smoke", status: "succeeded" } },
});
const timestamp = String(Math.floor(Date.now() / 1000));
const signedPayload = timestamp + "." + rawBody;
const expected = hmacSha256Hex(secret, signedPayload);
assert(/^[0-9a-f]{64}$/.test(expected), "hmacSha256Hex hex digest");
assert(timingSafeEqualHex(expected, expected), "timingSafeEqualHex self");
const digest = sha256Hex("portable");
assert(/^[0-9a-f]{64}$/.test(digest), "sha256Hex hex digest");

// ── 4) Stripe gateway verifyWebhook via createPaymentClient + runtime ────────
const fixedNowMs = Number(timestamp) * 1000;
const client = createPaymentClient({
  gateways: {
    stripe: stripeGateway({
      secretKey: "sk_test_smoke_not_a_real_key",
      webhookSecret: secret,
    }),
  },
  defaultGateway: "stripe",
  runtime: {
    clock: {
      now: () => new Date(fixedNowMs),
      nowMs: () => fixedNowMs,
    },
  },
});

const stripe = client.gateway("stripe");
const sigHeader = "t=" + timestamp + ",v1=" + expected;
assert(
  stripe.verifyWebhook(rawBody, sigHeader) === true,
  "stripe.verifyWebhook should accept valid portable HMAC",
);
assert(
  stripe.verifyWebhook(rawBody, "t=" + timestamp + ",v1=" + "0".repeat(64)) === false,
  "stripe.verifyWebhook should reject wrong signature",
);

// ── 5) Injected fetch is stored on context (no provider HTTP in smoke) ───────
let fetchCalls = 0;
const mockFetch = async () => {
  fetchCalls += 1;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const ctx = createDefaultGatewayContext({
  runtime: { fetch: mockFetch },
});
assert(ctx.fetch === mockFetch, "context.fetch is injected mock");
// Sanity: injected fetch works when invoked
const res = await ctx.fetch("https://example.invalid/smoke");
assert(res.ok && fetchCalls === 1, "injected fetch callable");

console.log("smoke ok: import + PaymentRuntime + portable Stripe webhook verify");
`;
}

/**
 * Install tarball into a fresh consumer dir and run functional checks.
 * @param {"bun" | "node"} runtime
 * @param {string} tarball
 */
async function smoke(runtime, tarball) {
  const consumerDir = await mkdtemp(
    join(tmpdir(), `paykernel-smoke-${runtime}-`),
  );
  temps.push(consumerDir);

  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: `paykernel-smoke-${runtime}`,
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );

  const checkPath = join(consumerDir, "check.mjs");
  await writeFile(checkPath, buildCheckSource());

  if (runtime === "bun") {
    run("bun", ["add", tarball], { cwd: consumerDir });
    run("bun", ["run", checkPath], { cwd: consumerDir });
  } else {
    run("npm", ["install", tarball, "--no-fund", "--no-audit"], {
      cwd: consumerDir,
    });
    run("node", [checkPath], { cwd: consumerDir });
  }
}

async function main() {
  const tarballArg = process.argv[2];
  let tarball;
  try {
    tarball = await ensureTarball(tarballArg);
    console.log(`consumer-smoke: tarball=${tarball}`);

    if (!tarballArg) {
      try {
        await access(join(CORE, "dist", "index.js"));
      } catch {
        console.warn(
          "consumer-smoke: warning: packages/core/dist/index.js missing; pack may be incomplete. Build first.",
        );
      }
    }

    console.log("consumer-smoke: Bun functional smoke...");
    await smoke("bun", tarball);

    console.log("consumer-smoke: Node functional smoke...");
    await smoke("node", tarball);

    console.log("consumer-smoke: OK");
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error("consumer-smoke FAILED:", err?.message || err);
  process.exitCode = 1;
  return cleanup();
});
