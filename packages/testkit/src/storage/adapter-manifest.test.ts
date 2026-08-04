import { describe, expect, it } from "bun:test";
import {
  MEMORY_STORAGE_ADAPTER_MANIFEST,
  assertStorageAdapterManifest,
  getMemoryStorageAdapterManifest,
  isProductionSafeCoordination,
  isStrongClaimAdapter,
  type StorageAdapterManifest,
} from "./adapter-manifest";
import { createMemoryStores } from "../memory/memory-stores";

function cloneManifest(
  overrides: Partial<StorageAdapterManifest> = {},
): StorageAdapterManifest {
  const base = MEMORY_STORAGE_ADAPTER_MANIFEST;
  return {
    ...base,
    ...overrides,
    contracts: { ...base.contracts, ...overrides.contracts },
    consistency: { ...base.consistency, ...overrides.consistency },
    notes: overrides.notes ?? [...base.notes],
  };
}

describe("MEMORY_STORAGE_ADAPTER_MANIFEST", () => {
  it("has all required fields and correct enums", () => {
    const m = MEMORY_STORAGE_ADAPTER_MANIFEST;
    expect(m.name).toBe("memory");
    expect(m.contracts).toEqual({
      idempotency: true,
      webhookInbox: true,
      reconciliation: true,
    });
    expect(m.consistency.claims).toBe("strong");
    expect(m.consistency.readAfterWrite).toBe("strong");
    expect(m.consistency.staleReadsPossible).toBe(false);
    expect(m.coordinationScope).toBe("single-process");
    expect(m.durability).toBe("ephemeral");
    expect(m.supportsTransactions).toBe(true);
    expect(m.supportsLeases).toBe(true);
    expect(m.supportsRetentionCleanup).toBe(true);
    expect(Array.isArray(m.notes)).toBe(true);
    expect(m.notes.length).toBeGreaterThan(0);
    expect(m.notes.some((n) => n.includes("NON-PRODUCTION"))).toBe(true);
    expect(m.notes.some((n) => /single isolate|process-local/i.test(n))).toBe(
      true,
    );
    expect(m.notes.some((n) => /crash|ephemeral|restart/i.test(n))).toBe(true);
  });

  it("is machine-readable: JSON.stringify round-trips without functions", () => {
    const json = JSON.stringify(MEMORY_STORAGE_ADAPTER_MANIFEST);
    const parsed = JSON.parse(json) as StorageAdapterManifest;
    expect(parsed).toEqual(MEMORY_STORAGE_ADAPTER_MANIFEST);
    assertStorageAdapterManifest(parsed);
    // No function values in the serialized graph
    expect(json).not.toMatch(/function/i);
  });

  it("getMemoryStorageAdapterManifest returns the same constant", () => {
    expect(getMemoryStorageAdapterManifest()).toBe(
      MEMORY_STORAGE_ADAPTER_MANIFEST,
    );
  });

  it("is not production-safe coordination (single-process + ephemeral)", () => {
    expect(isProductionSafeCoordination(MEMORY_STORAGE_ADAPTER_MANIFEST)).toBe(
      false,
    );
  });

  it("is a strong-claim adapter (claims strong + leases)", () => {
    expect(isStrongClaimAdapter(MEMORY_STORAGE_ADAPTER_MANIFEST)).toBe(true);
  });
});

describe("assertStorageAdapterManifest", () => {
  it("accepts the memory manifest", () => {
    expect(() =>
      assertStorageAdapterManifest(MEMORY_STORAGE_ADAPTER_MANIFEST),
    ).not.toThrow();
  });

  it("rejects null / non-objects", () => {
    expect(() => assertStorageAdapterManifest(null)).toThrow(TypeError);
    expect(() => assertStorageAdapterManifest(undefined)).toThrow(TypeError);
    expect(() => assertStorageAdapterManifest("memory")).toThrow(TypeError);
  });

  it("rejects missing name", () => {
    const bad = { ...MEMORY_STORAGE_ADAPTER_MANIFEST } as Record<string, unknown>;
    delete bad.name;
    expect(() => assertStorageAdapterManifest(bad)).toThrow(TypeError);
  });

  it("rejects empty name", () => {
    expect(() =>
      assertStorageAdapterManifest(cloneManifest({ name: "" })),
    ).toThrow(TypeError);
  });

  it("rejects missing contracts fields", () => {
    const bad = {
      ...MEMORY_STORAGE_ADAPTER_MANIFEST,
      contracts: { idempotency: true, webhookInbox: true },
    };
    expect(() => assertStorageAdapterManifest(bad)).toThrow(TypeError);
  });

  it("rejects bad coordinationScope enum", () => {
    const bad = {
      ...MEMORY_STORAGE_ADAPTER_MANIFEST,
      coordinationScope: "cluster",
    };
    expect(() => assertStorageAdapterManifest(bad)).toThrow(TypeError);
  });

  it("rejects bad durability enum", () => {
    const bad = {
      ...MEMORY_STORAGE_ADAPTER_MANIFEST,
      durability: "memory",
    };
    expect(() => assertStorageAdapterManifest(bad)).toThrow(TypeError);
  });

  it("rejects bad readAfterWrite enum", () => {
    const bad = cloneManifest({
      consistency: {
        claims: "strong",
        readAfterWrite: "linearizable" as StorageAdapterManifest["consistency"]["readAfterWrite"],
        staleReadsPossible: false,
      },
    });
    // Force invalid at runtime
    (bad.consistency as { readAfterWrite: string }).readAfterWrite =
      "linearizable";
    expect(() => assertStorageAdapterManifest(bad)).toThrow(TypeError);
  });

  it('rejects non-"strong" claims', () => {
    const bad = cloneManifest();
    (bad.consistency as { claims: string }).claims = "eventual";
    expect(() => assertStorageAdapterManifest(bad)).toThrow(TypeError);
  });

  it("rejects non-boolean supports* flags", () => {
    const bad = {
      ...MEMORY_STORAGE_ADAPTER_MANIFEST,
      supportsLeases: "yes",
    };
    expect(() => assertStorageAdapterManifest(bad)).toThrow(TypeError);
  });

  it("rejects non-array notes", () => {
    const bad = {
      ...MEMORY_STORAGE_ADAPTER_MANIFEST,
      notes: "single note",
    };
    expect(() => assertStorageAdapterManifest(bad)).toThrow(TypeError);
  });
});

describe("isProductionSafeCoordination / isStrongClaimAdapter", () => {
  it("returns true only when not single-process and not ephemeral", () => {
    expect(
      isProductionSafeCoordination(
        cloneManifest({
          coordinationScope: "multi-host",
          durability: "durable",
        }),
      ),
    ).toBe(true);
    expect(
      isProductionSafeCoordination(
        cloneManifest({
          coordinationScope: "multi-host",
          durability: "ephemeral",
        }),
      ),
    ).toBe(false);
    expect(
      isProductionSafeCoordination(
        cloneManifest({
          coordinationScope: "single-process",
          durability: "durable",
        }),
      ),
    ).toBe(false);
  });

  it("isStrongClaimAdapter requires leases", () => {
    expect(
      isStrongClaimAdapter(cloneManifest({ supportsLeases: false })),
    ).toBe(false);
  });
});

describe("createMemoryStores().manifest", () => {
  it("attaches the same MEMORY_STORAGE_ADAPTER_MANIFEST reference", () => {
    const stores = createMemoryStores();
    expect(stores.manifest).toBe(MEMORY_STORAGE_ADAPTER_MANIFEST);
    assertStorageAdapterManifest(stores.manifest);
  });
});
