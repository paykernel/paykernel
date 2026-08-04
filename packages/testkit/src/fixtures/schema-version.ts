/**
 * Versioned fixture schema marker for committed offline fixtures.
 * Bump when fixture shape changes incompatibly.
 */
export const FIXTURE_SCHEMA_VERSION = 1 as const;

/**
 * Versioned envelope around fixture body data.
 * Produced by {@link sanitizeFixture} and accepted by schema helpers.
 */
export type FixtureEnvelope<T = unknown> = {
  /** Schema version for this fixture document. */
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION | number;
  /** Optional stable fixture id (non-secret). */
  id?: string;
  /** Gateway or suite name this fixture targets. */
  gateway?: string;
  /** Fixture body (must pass fixture safety after sanitization). */
  data: T;
  /** True when body was run through secret redaction. */
  redacted?: boolean;
};

export function isFixtureEnvelope(value: unknown): value is FixtureEnvelope {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.schemaVersion === "number" && "data" in v;
}

export function assertFixtureSchemaVersion(
  envelope: FixtureEnvelope,
  expected: number = FIXTURE_SCHEMA_VERSION,
): void {
  if (envelope.schemaVersion !== expected) {
    throw new Error(
      `Fixture schemaVersion ${envelope.schemaVersion} !== expected ${expected}`,
    );
  }
}
