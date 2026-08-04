/**
 * Mock DurableObjectNamespace routing by name for partition tests.
 *
 * Each distinct object name gets its own mock DoStorageLike + PaymentsStoreObject.
 */

import type { DoNamespaceLike, DoStubLike, DoStorageLike } from "../types";
import type { StoreClock } from "../clock";
import type { SchemaNamespaceConfig } from "@paykernel/sql-foundation";
import type { DoAlarmOptions } from "../types";
import { createMockDoSql, type MockDoSqlHandle } from "./mock-do-sql";
import { PaymentsStoreObject } from "../object/payments-store-object";

export type MockDoNamespaceOptions = {
  clock?: StoreClock;
  tableNamespace?: SchemaNamespaceConfig;
  alarms?: DoAlarmOptions;
  /** Auto-migrate each new partition on first access. Default true for tests. */
  autoMigrate?: boolean;
};

export type MockDoNamespaceHandle = {
  namespace: DoNamespaceLike;
  /** Per-shard mock handles. */
  partitions: Map<string, MockDoSqlHandle>;
  /** Per-shard PaymentsStoreObject. */
  objects: Map<string, PaymentsStoreObject>;
  close: () => void;
};

/**
 * Create a mock DO namespace that materializes one SQLite mock per object name.
 */
export function createMockDoNamespace(
  options: MockDoNamespaceOptions = {},
): MockDoNamespaceHandle {
  const partitions = new Map<string, MockDoSqlHandle>();
  const objects = new Map<string, PaymentsStoreObject>();
  /** One ready promise per name so concurrent first RPCs share a single migrate. */
  const readyByName = new Map<string, Promise<PaymentsStoreObject>>();
  const autoMigrate = options.autoMigrate !== false;

  function createObject(name: string): PaymentsStoreObject {
    const existing = objects.get(name);
    if (existing) return existing;

    const handle = createMockDoSql({
      alarms: options.alarms?.enabled === true,
    });
    partitions.set(name, handle);

    const objOpts: {
      storage: DoStorageLike;
      clock?: StoreClock;
      namespace?: SchemaNamespaceConfig;
      alarms?: DoAlarmOptions;
    } = { storage: handle.storage };
    if (options.clock !== undefined) objOpts.clock = options.clock;
    if (options.tableNamespace !== undefined) {
      objOpts.namespace = options.tableNamespace;
    }
    if (options.alarms !== undefined) objOpts.alarms = options.alarms;

    const obj = new PaymentsStoreObject(objOpts);
    objects.set(name, obj);
    return obj;
  }

  function readyObject(name: string): Promise<PaymentsStoreObject> {
    let p = readyByName.get(name);
    if (p) return p;
    p = (async () => {
      const obj = createObject(name);
      if (autoMigrate) {
        await obj.ensureSchema();
      }
      return obj;
    })();
    readyByName.set(name, p);
    return p;
  }

  function wrapStub(name: string): DoStubLike {
    return new Proxy({} as DoStubLike, {
      get(_target, prop: string | symbol) {
        if (typeof prop !== "string") return undefined;
        return async (...args: unknown[]) => {
          const obj = await readyObject(name);
          const fn = (obj as unknown as Record<string, unknown>)[prop];
          if (typeof fn !== "function") {
            throw new TypeError(`mock DO stub missing method: ${String(prop)}`);
          }
          return await (fn as (...a: unknown[]) => unknown).apply(obj, args);
        };
      },
    });
  }

  const namespace: DoNamespaceLike = {
    idFromName(name: string) {
      return { toString: () => name };
    },
    get(id: { toString(): string }) {
      return wrapStub(id.toString());
    },
    getByName(name: string) {
      return wrapStub(name);
    },
  };

  return {
    namespace,
    partitions,
    objects,
    close: () => {
      for (const h of partitions.values()) h.close();
      partitions.clear();
      objects.clear();
      readyByName.clear();
    },
  };
}
