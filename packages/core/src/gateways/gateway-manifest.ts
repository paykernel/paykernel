// file: packages/core/src/gateways/gateway-manifest.ts

import type { GatewayCapabilities } from "./gateway-capabilities";

/**
 * Descriptive metadata for a registered gateway adapter.
 *
 * Manifests must never include secrets or credential config. They are safe to
 * log and to freeze into an immutable registry.
 *
 * {@link capabilities} is the source of truth for
 * {@link import('./gateway.interface').PaymentGateway.supports} when an
 * instance is built from this adapter. Free-form {@link metadata} is for
 * non-capability hints only — do not put capability flags only in metadata.
 */
export interface GatewayManifest {
    /** Stable gateway identifier (matches {@link import('./gateway.interface').PaymentGateway}.name) */
    readonly name: string;
    /** Human-readable label for UIs / logs */
    readonly displayName?: string;
    /** Adapter / package version (semver string recommended) */
    readonly version?: string;
    /** Provider API version the adapter targets, when relevant */
    readonly apiVersion?: string;
    /**
     * Typed capability snapshot advertised by this adapter.
     * Prefer explicit {@link import('./gateway-capabilities').defineGatewayCapabilities}
     * claims. Omitted means “no claims in the manifest”; gateway instances still
     * expose a complete all-false (or explicitly configured) snapshot via
     * {@link import('./gateway.interface').PaymentGateway.capabilities}.
     */
    readonly capabilities?: GatewayCapabilities;
    /**
     * Free-form, non-secret metadata (UI labels, docs links, etc.).
     * Do not put API keys, tokens, full config bags, or capability flags here.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
}
