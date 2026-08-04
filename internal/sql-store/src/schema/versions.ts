/**
 * Storage schema version constants for the private SQL foundation.
 *
 * Bump {@link CURRENT_SCHEMA_VERSION} when adding a migration in
 * `migrations/definitions.ts`. Adapters and verifySchema() use these values.
 */

/** Schema version applied by the initial four-table foundation migration. */
export const SCHEMA_VERSION_V1 = 1 as const;

/**
 * Highest migration version currently defined by this package.
 * Must equal the max `version` in {@link import("../migrations/metadata.ts").MIGRATIONS}.
 */
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_V1;

/** Human-readable schema family id (not a package version). */
export const SCHEMA_FAMILY = "payments-storage" as const;
