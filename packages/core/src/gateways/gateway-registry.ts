// file: packages/core/src/gateways/gateway-registry.ts

import { InvalidRequestError } from "../errors";
import type { GatewayAdapter } from "./gateway-adapter";
import {
    createRedactingTelemetrySink,
    type GatewayContext,
} from "./gateway-context";
import type { GatewayManifest } from "./gateway-manifest";
import type { PaymentGateway } from "./gateway.interface";
import {
    DEFAULT_GATEWAY_CAPABILITIES,
    freezeCapabilities,
    type GatewayCapabilities,
    type GatewayCapabilityKey,
} from "./gateway-capabilities";

/**
 * Map of gateway name → instance type. Used as the type parameter for a
 * built, typed registry.
 */
export type GatewayMap = Record<string, PaymentGateway>;

type AdapterFor<N extends string, G extends PaymentGateway<N>> = GatewayAdapter<
    N,
    G
>;

/**
 * Immutable registry of gateway adapters produced by
 * {@link GatewayRegistryBuilder.build}.
 *
 * - No `register` / `unregister` after build
 * - Adapters map and each manifest copy are `Object.freeze`d
 * - Prefer {@link createAll} once at client construction (not per request)
 */
export interface ImmutableGatewayRegistry<TMap extends GatewayMap = GatewayMap> {
    /**
     * Materialize gateway instances for every registered adapter.
     * Call once when constructing a payment client; do not recreate per request.
     */
    createAll(context: GatewayContext): { [K in keyof TMap]: TMap[K] };

    /**
     * Adapter lookup for a known registered name.
     * Instance type is `TMap[N]`; the adapter is typed as producing
     * `PaymentGateway<N>` (structurally compatible with the map entry).
     */
    getAdapter<N extends keyof TMap & string>(
        name: N,
    ): GatewayAdapter<N, PaymentGateway<N>> | undefined;

    /** Less-typed lookup by arbitrary string */
    getAdapterByName(name: string): GatewayAdapter | undefined;

    has(name: string): boolean;

    /** Registered names in registration order */
    names(): readonly (keyof TMap & string)[];

    /** Frozen manifest copies in registration order */
    manifests(): readonly GatewayManifest[];
}

/**
 * Fluent builder that accumulates adapters with compile-time map inference.
 *
 * - {@link register} rejects duplicate names
 * - {@link replace} overwrites an existing name (or inserts if absent)
 * - {@link build} freezes the registry; further builder use does not mutate
 *   already-built registries
 */
export interface GatewayRegistryBuilder<TMap extends GatewayMap = GatewayMap> {
    /**
     * Register a new adapter. Throws {@link InvalidRequestError} if `name`
     * is already registered — use {@link replace} for intentional overwrite.
     */
    register<N extends string, G extends PaymentGateway<N>>(
        adapter: AdapterFor<N, G>,
    ): GatewayRegistryBuilder<TMap & { [K in N]: G }>;

    /**
     * Register or overwrite an adapter by name. Prefer `register` for new
     * names so accidental duplicates fail loudly.
     * When overwriting, registration order is preserved (name keeps its index).
     */
    replace<N extends string, G extends PaymentGateway<N>>(
        adapter: AdapterFor<N, G>,
    ): GatewayRegistryBuilder<Omit<TMap, N> & { [K in N]: G }>;

    /**
     * Accept a loosely typed adapter and erase static map inference for this
     * entry (result still builds a usable string-keyed registry). Prefer the
     * generic {@link register} when you control the adapter type.
     */
    registerDynamic(
        adapter: GatewayAdapter<string, PaymentGateway>,
    ): GatewayRegistryBuilder<TMap & Record<string, PaymentGateway>>;

    /** Freeze adapters/manifests into an immutable registry */
    build(): ImmutableGatewayRegistry<TMap>;
}

/**
 * Deep-freeze a manifest copy so registry consumers cannot mutate shared
 * metadata/capabilities. Does not freeze the original adapter.manifest
 * reference if it differs from the copy.
 */
function freezeManifest(manifest: GatewayManifest): GatewayManifest {
    const copy: {
        name: string;
        displayName?: string;
        version?: string;
        apiVersion?: string;
        capabilities?: GatewayCapabilities;
        metadata?: Readonly<Record<string, unknown>>;
    } = {
        name: manifest.name,
    };
    if (manifest.displayName !== undefined) {
        copy.displayName = manifest.displayName;
    }
    if (manifest.version !== undefined) {
        copy.version = manifest.version;
    }
    if (manifest.apiVersion !== undefined) {
        copy.apiVersion = manifest.apiVersion;
    }
    if (manifest.capabilities !== undefined) {
        copy.capabilities = freezeCapabilities(manifest.capabilities);
    }
    if (manifest.metadata !== undefined) {
        copy.metadata = Object.freeze({ ...manifest.metadata });
    }
    return Object.freeze(copy) as GatewayManifest;
}

/**
 * Phase 3 surface: `capabilities` snapshot + `supports()`.
 * Pre-Phase-3 plain objects omit these; {@link attachDefaultCapabilitySurface}
 * fail-closes them at `createAll` time.
 */
function hasCapabilitySurface(gateway: PaymentGateway): boolean {
    return (
        typeof gateway.supports === "function" &&
        gateway.capabilities != null &&
        typeof gateway.capabilities === "object"
    );
}

/**
 * P05-CAPS-2: adapters that omit a capability surface must not silently
 * over-claim. Attach all-false {@link DEFAULT_GATEWAY_CAPABILITIES} + `supports()`.
 */
function attachDefaultCapabilitySurface(gateway: PaymentGateway): PaymentGateway {
    if (hasCapabilitySurface(gateway)) {
        return gateway;
    }

    const capabilities = DEFAULT_GATEWAY_CAPABILITIES;
    const supports = (capability: GatewayCapabilityKey): boolean =>
        capabilities[capability] === true;

    const defineSurface = (target: PaymentGateway): boolean => {
        try {
            Object.defineProperty(target, "capabilities", {
                value: capabilities,
                enumerable: true,
                configurable: true,
                writable: false,
            });
            Object.defineProperty(target, "supports", {
                value: supports,
                enumerable: true,
                configurable: true,
                writable: false,
            });
            return hasCapabilitySurface(target);
        } catch {
            return false;
        }
    };

    if (defineSurface(gateway)) {
        return gateway;
    }

    // Frozen / sealed instance: wrap so methods stay on the prototype chain.
    const wrapped = Object.create(gateway) as PaymentGateway;
    defineSurface(wrapped);
    return wrapped;
}

function assertAdapterName(adapter: GatewayAdapter): void {
    if (typeof adapter.name !== "string" || adapter.name.trim().length === 0) {
        throw new InvalidRequestError(
            "Gateway adapter name must be a non-empty string (whitespace-only names are not allowed)",
        );
    }
    if (adapter.manifest.name !== adapter.name) {
        throw new InvalidRequestError(
            `Gateway adapter name '${adapter.name}' must match manifest.name '${adapter.manifest.name}'`,
        );
    }
}

/**
 * Snapshot adapter shell at register/replace time so later mutation of the
 * caller's object cannot desync the builder entry name from create/manifest.
 */
function snapshotAdapter(adapter: GatewayAdapter): GatewayAdapter {
    return Object.freeze({
        name: adapter.name,
        manifest: freezeManifest(adapter.manifest),
        create: adapter.create.bind(adapter),
    }) as GatewayAdapter;
}

class ImmutableGatewayRegistryImpl<TMap extends GatewayMap>
    implements ImmutableGatewayRegistry<TMap>
{
    private readonly adaptersByName: Readonly<
        Record<string, GatewayAdapter>
    >;
    private readonly order: readonly string[];
    private readonly frozenManifests: readonly GatewayManifest[];

    constructor(entries: Array<{ name: string; adapter: GatewayAdapter }>) {
        const map: Record<string, GatewayAdapter> = {};
        const order: string[] = [];
        const manifests: GatewayManifest[] = [];

        for (const { name, adapter } of entries) {
            // Adapters are snapshotted at register/replace; re-freeze for safety
            // if an entry somehow bypassed that path.
            const frozenAdapter =
                Object.isFrozen(adapter) && Object.isFrozen(adapter.manifest)
                    ? adapter
                    : snapshotAdapter(adapter);
            map[name] = frozenAdapter;
            order.push(name);
            manifests.push(frozenAdapter.manifest);
        }

        this.adaptersByName = Object.freeze(map);
        this.order = Object.freeze(order.slice());
        this.frozenManifests = Object.freeze(manifests);
        Object.freeze(this);
    }

    createAll(context: GatewayContext): { [K in keyof TMap]: TMap[K] } {
        const instances: Record<string, PaymentGateway> = {};
        const safeContext = withRedactingTelemetry(context);
        for (const name of this.order) {
            const adapter = this.adaptersByName[name]!;
            const gateway = adapter.create(safeContext);
            if (gateway.name !== name) {
                throw new InvalidRequestError(
                    `Gateway adapter '${name}' created instance with name '${gateway.name}'`,
                );
            }
            instances[name] = attachDefaultCapabilitySurface(gateway);
        }
        return Object.freeze(instances) as { [K in keyof TMap]: TMap[K] };
    }

    getAdapter<N extends keyof TMap & string>(
        name: N,
    ): GatewayAdapter<N, PaymentGateway<N>> | undefined {
        return this.adaptersByName[name] as
            | GatewayAdapter<N, PaymentGateway<N>>
            | undefined;
    }

    getAdapterByName(name: string): GatewayAdapter | undefined {
        return this.adaptersByName[name];
    }

    has(name: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.adaptersByName, name);
    }

    names(): readonly (keyof TMap & string)[] {
        return this.order as readonly (keyof TMap & string)[];
    }

    manifests(): readonly GatewayManifest[] {
        return this.frozenManifests;
    }
}

class GatewayRegistryBuilderImpl<TMap extends GatewayMap>
    implements GatewayRegistryBuilder<TMap>
{
    /** Mutable only while building; each builder chain step clones the list */
    private readonly entries: Array<{ name: string; adapter: GatewayAdapter }>;

    constructor(
        entries: Array<{ name: string; adapter: GatewayAdapter }> = [],
    ) {
        this.entries = entries;
    }

    register<N extends string, G extends PaymentGateway<N>>(
        adapter: AdapterFor<N, G>,
    ): GatewayRegistryBuilder<TMap & { [K in N]: G }> {
        assertAdapterName(adapter);
        if (this.entries.some((e) => e.name === adapter.name)) {
            throw new InvalidRequestError(
                `Gateway '${adapter.name}' is already registered; use replace() to overwrite`,
            );
        }
        const snap = snapshotAdapter(adapter as GatewayAdapter);
        return new GatewayRegistryBuilderImpl([
            ...this.entries,
            { name: snap.name, adapter: snap },
        ]) as unknown as GatewayRegistryBuilder<TMap & { [K in N]: G }>;
    }

    replace<N extends string, G extends PaymentGateway<N>>(
        adapter: AdapterFor<N, G>,
    ): GatewayRegistryBuilder<Omit<TMap, N> & { [K in N]: G }> {
        assertAdapterName(adapter);
        const snap = snapshotAdapter(adapter as GatewayAdapter);
        const existingIndex = this.entries.findIndex(
            (e) => e.name === snap.name,
        );
        // Preserve registration order when overwriting; append when inserting.
        const next =
            existingIndex === -1
                ? [
                      ...this.entries,
                      {
                          name: snap.name,
                          adapter: snap,
                      },
                  ]
                : this.entries.map((entry, index) =>
                      index === existingIndex
                          ? {
                                name: snap.name,
                                adapter: snap,
                            }
                          : entry,
                  );
        return new GatewayRegistryBuilderImpl(
            next,
        ) as unknown as GatewayRegistryBuilder<Omit<TMap, N> & { [K in N]: G }>;
    }

    registerDynamic(
        adapter: GatewayAdapter<string, PaymentGateway>,
    ): GatewayRegistryBuilder<TMap & Record<string, PaymentGateway>> {
        // Same runtime path as register (duplicate rejection)
        return this.register(adapter) as unknown as GatewayRegistryBuilder<
            TMap & Record<string, PaymentGateway>
        >;
    }

    build(): ImmutableGatewayRegistry<TMap> {
        return new ImmutableGatewayRegistryImpl<TMap>(this.entries.slice());
    }
}

/**
 * Start a typed gateway registry builder with an empty map.
 *
 * @example
 * ```ts
 * const registry = createGatewayRegistry()
 *   .register(stripeAdapter)
 *   .register(customAdapter)
 *   .build();
 * const gateways = registry.createAll(createDefaultGatewayContext());
 * ```
 */
export function createGatewayRegistry(): GatewayRegistryBuilder<{}> {
    return new GatewayRegistryBuilderImpl<{}>();
}

/**
 * Start a **dynamically** typed registry builder.
 *
 * Use when adapter names are only known at runtime and static inference of
 * `TMap` is not needed. Prefer {@link createGatewayRegistry} for first-party
 * and well-typed third-party adapters.
 *
 * The returned builder still rejects duplicate `register()` calls and freezes
 * on `build()`.
 */
export function createDynamicGatewayRegistry(): GatewayRegistryBuilder<
    Record<string, PaymentGateway>
> {
    return new GatewayRegistryBuilderImpl<Record<string, PaymentGateway>>();
}

/** Wrap a hand-built context sink so adapter.create never sees raw telemetry. */
function withRedactingTelemetry(context: GatewayContext): GatewayContext {
    if (context.telemetry === undefined) return context;
    return {
        ...context,
        telemetry: createRedactingTelemetrySink(context.telemetry),
    };
}
