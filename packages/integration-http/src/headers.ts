/**
 * Header bag accepted by HTTP helpers — either a `Headers` instance or a
 * plain record. Lookup is case-insensitive; see `getHeader` and
 * `headerBagToLowerRecord` (process.ts) which both lower-case keys and pick
 * the first array value. Documented invariant: `getHeader(bag, k)` equals
 * `headerBagToLowerRecord(bag)[k.toLowerCase()]` when present.
 */
export type HeaderBag = Headers | Record<string, string | string[] | undefined>;

/**
 * Retrieve a header value case-insensitively.
 *
 * - For `Headers` instances: checks `headers.get(lower)` then fallback
 *   case-insensitive scan via `forEach`, so both `"Stripe-Signature"` and
 *   `"stripe-signature"` match.
 * - For record bags: iterates entries and compares `k.toLowerCase() === lower`,
 *   returning the first array entry or string value. Empty strings/arrays
 *   return `undefined` (treated as missing for signature guards).
 *
 * This is intentionally consistent with `headerBagToLowerRecord` which
 * lower-cases all keys and picks the first value — both normalize case the
 * same way.
 */
export function getHeader(
  headers: HeaderBag,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  if (headers instanceof Headers) {
    const value = headers.get(lower) ?? headers.get(name);
    if (value !== null) return value.length > 0 ? value : undefined;
    let found: string | undefined;
    headers.forEach((v, k) => {
      if (found === undefined && k.toLowerCase() === lower && v.length > 0) found = v;
    });
    return found?.length ? found : undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) {
        return v.length > 0 && typeof v[0] === "string" && v[0].length > 0 ? v[0] : undefined;
      }
      if (typeof v === "string") return v.length > 0 ? v : undefined;
      return undefined;
    }
  }
  return undefined;
}

export function resolveCorrelationId(
  headers: HeaderBag,
  generate: () => string = defaultGenerateId,
): string {
  const candidates = ["x-request-id", "x-correlation-id", "cf-ray"];
  for (const key of candidates) {
    const value = getHeader(headers, key);
    if (value !== undefined && value.length > 0) return value;
  }
  return generate();
}

function defaultGenerateId(): string {
  const g = globalThis as unknown as {
    crypto?: { randomUUID?: () => string };
  };
  if (g.crypto?.randomUUID) {
    try {
      return g.crypto.randomUUID();
    } catch {
      // fall through
    }
  }
  // Deterministic fallback; not crypto-strong but preserves header contract.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function requireStringBindings<K extends string>(
  source: Record<string, string | undefined>,
  keys: readonly K[],
): { [P in K]: string } {
  const missing: string[] = [];
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value !== "string" || value.length === 0) {
      missing.push(key);
    } else {
      result[key] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(`missing env: ${missing.join(", ")}`);
  }
  return result as { [P in K]: string };
}
