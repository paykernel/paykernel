/**
 * Fixture safety: scrub secrets/PII, reject committed fixtures that look like real secrets.
 *
 * Policy (aligned with core logger intent, fixture-oriented):
 * - **Hard fail**: `sk_live_`, `pk_live_`, `rk_live_`, live `whsec_` (not `whsec_test_…`),
 *   PAN-like 13–19 digit runs, long Bearer tokens that are not test-shaped.
 * - **Allow**: `sk_test_`, `pk_test_`, `whsec_test_…`, placeholders like `test_secret`.
 * - Sensitive keys (`Authorization`, `password`, `token`, …) must not hold cleartext
 *   unless the value is an explicit test placeholder.
 *
 * Design notes:
 * - Prefer synthetic tokens (`test_secret`, `sk_test_…`) in committed fixtures.
 * - Never put live keys, PANs, or live webhook secrets in fixtures or snapshots.
 * - Emails are not hard-failed (optional noise); prefer hard fail for live keys and PANs.
 */

import {
  FIXTURE_SCHEMA_VERSION,
  type FixtureEnvelope,
} from "./schema-version";

/** Redaction replacement for scrubbed fields. */
export const REDACTED = "[REDACTED]" as const;

/**
 * Patterns that must not appear in committed fixtures (string values).
 * Test doubles should use `sk_test_` / `pk_test_` / `whsec_test_…` / `test_secret`.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  // Live API / restricted keys — any non-empty body after the prefix is rejected.
  // (Previously required 8+ chars, which allowed short values like `sk_live_short`.)
  /\bsk_live_[A-Za-z0-9_]+\b/,
  /\bpk_live_[A-Za-z0-9_]+\b/,
  /\brk_live_[A-Za-z0-9_]+\b/,
  // Bare prefix without body (still a secret shape in fixtures)
  /\bsk_live_(?![A-Za-z0-9_])/,
  /\bpk_live_(?![A-Za-z0-9_])/,
  /\brk_live_(?![A-Za-z0-9_])/,
  // Live webhook secrets: `whsec_` that is NOT `whsec_test…`
  /\bwhsec_(?!test(?:[A-Za-z0-9_+\-/]|$))[A-Za-z0-9_+\-/]+\b/,
  // Common cloud key shapes
  /\bAIza[0-9A-Za-z\-_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  // PAN-like 13–19 digit runs (Luhn not required; conservative on strings only)
  /\b(?:\d[ -]*?){13,19}\b/,
  // Bearer tokens that do not look like test placeholders
  /\bBearer\s+(?!test(?:[_\s-]|$)|sk_test_|pk_test_|whsec_test)[A-Za-z0-9\-._~+/]{16,}=*\b/i,
];

/**
 * Explicit allow-list for values under sensitive keys and for pattern exceptions.
 * `sk_test_` / `pk_test_` never match SECRET_PATTERNS above.
 */
const ALLOWED_PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^\[REDACTED\]$/i,
  /^test[_-]?secret(?:[_-][A-Za-z0-9]+)*$/i,
  /^placeholder(?:[_-][A-Za-z0-9]+)*$/i,
  /^sk_test_[A-Za-z0-9]*$/i,
  /^pk_test_[A-Za-z0-9]*$/i,
  /^whsec_test[A-Za-z0-9_+\-/]*$/i,
  /^Bearer\s+(?:test(?:[_-][A-Za-z0-9]+)*|sk_test_[A-Za-z0-9]*|pk_test_[A-Za-z0-9]*|whsec_test[A-Za-z0-9_+\-/]*)$/i,
  /^<.*>$/,
  /^your[_-][a-z0-9_-]+$/i,
  /^\*+$/,
  /^x{4,}$/i,
];

/** Keys (case-insensitive substring) whose values are always redacted unless placeholders. */
const SENSITIVE_KEY_SUBSTR = [
  "secret",
  "password",
  "token",
  "authorization",
  "apikey",
  "api_key",
  "client_secret",
  "clientsecret",
  "card",
  "cvc",
  "cvv",
  "pan",
  "hmac",
  "signature",
  "private",
  "credential",
];

const SAFE_KEY_ALLOWLIST = new Set([
  "gateway",
  "gatewayname",
  "status",
  "eventtype",
  "eventname",
  "currency",
  "amount",
  "schemaversion",
  "idempotencykey",
  "gatewaypaymentid",
  "gatewayid",
  "redacted",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const lower = normalizeKey(key);
  if (SAFE_KEY_ALLOWLIST.has(lower)) return false;
  return SENSITIVE_KEY_SUBSTR.some((p) => lower.includes(p.replace(/_/g, "")));
}

function isAllowedPlaceholder(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  return ALLOWED_PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

function matchSecretPatterns(text: string): string | undefined {
  // Never flag explicit test-shaped values
  if (isAllowedPlaceholder(text)) return undefined;
  for (const re of SECRET_PATTERNS) {
    const m = new RegExp(re.source, re.flags).exec(text);
    if (m) return m[0]!;
  }
  return undefined;
}

export type FixtureSafetyIssue = {
  path: string;
  reason: string;
  /** Truncated evidence without echoing full secret when possible. */
  evidence?: string;
};

function truncate(s: string, n = 24): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

/**
 * Walk a value and collect safety issues (does not mutate).
 */
export function findFixtureSafetyIssues(
  value: unknown,
  path: string = "$",
): FixtureSafetyIssue[] {
  const issues: FixtureSafetyIssue[] = [];

  if (value === null || value === undefined) return issues;

  if (typeof value === "string") {
    const hit = matchSecretPatterns(value);
    if (hit) {
      issues.push({
        path,
        reason: "value matches secret pattern",
        evidence: truncate(hit),
      });
    }
    return issues;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return issues;
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      issues.push(...findFixtureSafetyIssues(item, `${path}[${i}]`));
    });
    return issues;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const child = `${path}.${k}`;
      if (isSensitiveKey(k) && v !== undefined && v !== null && v !== REDACTED) {
        if (typeof v === "string" && v.length > 0 && !isAllowedPlaceholder(v)) {
          issues.push({
            path: child,
            reason: `sensitive key "${k}" must not hold cleartext in fixtures`,
            evidence: truncate(String(v)),
          });
        } else if (typeof v === "object") {
          // Nested objects under sensitive keys still walked below
        }
      }
      issues.push(...findFixtureSafetyIssues(v, child));
    }
  }

  return issues;
}

/**
 * Paths of secret / safety leaks in a fixture value (JSONPath-ish).
 */
export function findSecretLeaks(value: unknown): string[] {
  return findFixtureSafetyIssues(value).map((i) => i.path);
}

/**
 * Assert fixture is safe to commit. Throws with issue list on failure.
 */
export function assertFixtureSafe(value: unknown, label = "fixture"): void {
  const issues = findFixtureSafetyIssues(value);
  if (issues.length === 0) return;
  const detail = issues
    .map((i) => `  - ${i.path}: ${i.reason}${i.evidence ? ` (${i.evidence})` : ""}`)
    .join("\n");
  throw new Error(`${label} failed fixture safety checks:\n${detail}`);
}

/**
 * Deep-clone and redact sensitive keys + secret-pattern string values.
 * Does not mutate the input.
 */
export function redactSecretsFromFixture<T>(value: T): T {
  return redactWalk(value) as T;
}

function redactWalk(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return matchSecretPatterns(value) ? REDACTED : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(redactWalk);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactWalk(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Sanitize a fixture for storage/snapshots: redact secrets, attach schema version.
 */
export function sanitizeFixture<T>(
  data: T,
  meta?: { id?: string; gateway?: string },
): FixtureEnvelope<T> {
  const redacted = redactSecretsFromFixture(data);
  // After redaction, remaining pattern hits should be none; still verify.
  assertFixtureSafe(redacted, "sanitizeFixture");
  const envelope: FixtureEnvelope<T> = {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    data: redacted,
    redacted: true,
  };
  if (meta?.id !== undefined) envelope.id = meta.id;
  if (meta?.gateway !== undefined) envelope.gateway = meta.gateway;
  return envelope;
}
