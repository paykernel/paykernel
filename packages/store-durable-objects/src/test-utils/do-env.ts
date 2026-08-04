/**
 * Env detection + skip helpers for live/miniflare Durable Object tests.
 *
 * Default CI path uses mock DO SQL (bun:sqlite) — no Cloudflare credentials required.
 * Live / miniflare suites skip cleanly when flags below are unset.
 *
 * ## Flags (all optional; default off)
 *
 * | Variable | Purpose |
 * |---|---|
 * | `PAYMENTS_DO_LIVE=1` | Enable optional live DO integration path |
 * | `CLOUDFLARE_DO_LIVE=1` | Alias for `PAYMENTS_DO_LIVE` |
 * | `PAYMENTS_SDK_DO_BINDING_AVAILABLE=1` | Custom miniflare / vitest-pool-workers harness injects a real DO binding |
 * | `MINIFLARE=1` | Miniflare-style runtime present |
 * | `VITEST_POOL_WORKERS=1` | `@cloudflare/vitest-pool-workers` runtime present |
 *
 * Normal Worker operation uses the DO binding only — REST `CLOUDFLARE_API_TOKEN` /
 * account IDs are **not** required by this adapter (unlike optional remote D1 REST).
 *
 * Mock paths (`createMockDoSql`, `createMockDoNamespace`) never consult these flags.
 */

/** True when a live DO binding env var is set for optional integration tests. */
export function hasLiveDo(): boolean {
  return (
    process.env.PAYMENTS_DO_LIVE === "1" ||
    process.env.CLOUDFLARE_DO_LIVE === "1"
  );
}

/**
 * True when a Workers/miniflare/vitest-pool-workers DO binding runtime is available.
 * Plain `bun test` always returns false unless explicitly opted in.
 */
export function hasDoBindingRuntime(): boolean {
  return (
    process.env.PAYMENTS_SDK_DO_BINDING_AVAILABLE === "1" ||
    process.env.MINIFLARE === "1" ||
    process.env.VITEST_POOL_WORKERS === "1"
  );
}

/** Unique table prefix for isolation within a shared mock DB / partition. */
export function uniqueTablePrefix(tag = "t"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const safe = tag.replace(/[^A-Za-z0-9_]/g, "").slice(0, 8) || "t";
  return `${safe}_${Date.now().toString(36)}${rand}_`;
}
