/**
 * Phase 8 Stream C — AbortSignal helpers (combine, timeout, map, strip/reattach).
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  combineAbortSignals,
  createTimeoutSignal,
  isAbortError,
  mapHttpAbortError,
  isMutatingHttpMethod,
  extractAbortSignal,
  stripAbortSignal,
  withAbortSignal,
} from "./abort";
import { PaymentAbortedError, NetworkError } from "../errors";

type AbortSignalWithStatics = typeof AbortSignal & {
  any?: (signals: AbortSignal[]) => AbortSignal;
  timeout?: (ms: number) => AbortSignal;
};

const AbortSignalStatics = AbortSignal as AbortSignalWithStatics;
const originalAny = AbortSignalStatics.any;
const originalTimeout = AbortSignalStatics.timeout;

type TrackedSignal = {
  aborted: boolean;
  reason: unknown;
  listenerCount: number;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ): void;
  abortTracked(reason?: unknown): void;
};

function createTrackedSignal(preAborted = false): TrackedSignal {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const signal: TrackedSignal = {
    aborted: preAborted,
    reason: preAborted ? "pre-aborted" : undefined,
    listenerCount: 0,
    addEventListener(type, listener) {
      if (type !== "abort") {
        return;
      }
      listeners.add(listener);
      signal.listenerCount = listeners.size;
    },
    removeEventListener(type, listener) {
      if (type !== "abort") {
        return;
      }
      listeners.delete(listener);
      signal.listenerCount = listeners.size;
    },
    abortTracked(reason) {
      signal.aborted = true;
      signal.reason = reason;
      const event = {
        type: "abort",
        target: signal,
      } as unknown as Event;
      for (const listener of [...listeners]) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
  };
  return signal;
}

afterEach(() => {
  if (originalAny === undefined) {
    delete AbortSignalStatics.any;
  } else {
    AbortSignalStatics.any = originalAny;
  }
  if (originalTimeout === undefined) {
    delete AbortSignalStatics.timeout;
  } else {
    AbortSignalStatics.timeout = originalTimeout;
  }
});

describe("combineAbortSignals", () => {
  it("returns undefined when no signals are provided", () => {
    expect(combineAbortSignals()).toBeUndefined();
    expect(combineAbortSignals(undefined, null)).toBeUndefined();
  });

  it("returns the sole non-null signal", () => {
    const controller = new AbortController();
    expect(combineAbortSignals(undefined, controller.signal)).toBe(
      controller.signal,
    );
  });

  it("aborts when any input aborts", async () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined).toBeDefined();
    expect(combined!.aborted).toBe(false);

    b.abort("caller-cancel");
    // AbortSignal.any and polyfill both abort synchronously on listener fire.
    expect(combined!.aborted).toBe(true);
  });

  it("returns already-aborted signal when one input is pre-aborted", () => {
    const a = new AbortController();
    a.abort();
    const b = new AbortController();
    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined!.aborted).toBe(true);
  });

  it("polyfill path aborts when a live signal fires (no AbortSignal.any)", () => {
    delete AbortSignalStatics.any;
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined).toBeDefined();
    expect(combined!.aborted).toBe(false);
    a.abort("polyfill-reason");
    expect(combined!.aborted).toBe(true);
  });

  it("polyfill path returns aborted signal when an input is pre-aborted", () => {
    delete AbortSignalStatics.any;
    const a = new AbortController();
    a.abort("already-done");
    const b = new AbortController();
    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined!.aborted).toBe(true);
  });

  it("polyfill removes abort listeners from remaining inputs when one fires (P610-ABT-2)", () => {
    delete AbortSignalStatics.any;
    const a = createTrackedSignal();
    const b = createTrackedSignal();
    const combined = combineAbortSignals(
      a as unknown as AbortSignal,
      b as unknown as AbortSignal,
    );
    expect(combined).toBeDefined();
    expect(a.listenerCount).toBe(1);
    expect(b.listenerCount).toBe(1);

    a.abortTracked("polyfill-cleanup");
    expect(combined!.aborted).toBe(true);
    expect(a.listenerCount).toBe(0);
    expect(b.listenerCount).toBe(0);
  });

  it("polyfill detaches already-attached listeners when a later input is pre-aborted (P610-ABT-2)", () => {
    delete AbortSignalStatics.any;
    const live = createTrackedSignal();
    const dead = createTrackedSignal(true);
    const combined = combineAbortSignals(
      live as unknown as AbortSignal,
      dead as unknown as AbortSignal,
    );
    expect(combined!.aborted).toBe(true);
    expect(live.listenerCount).toBe(0);
  });

  it("uses the polyfill for duck-typed signals even when AbortSignal.any exists", () => {
    expect(typeof AbortSignalStatics.any).toBe("function");
    const a = createTrackedSignal();
    const b = createTrackedSignal();
    const combined = combineAbortSignals(
      a as unknown as AbortSignal,
      b as unknown as AbortSignal,
    );
    expect(combined).toBeDefined();
    expect(combined!.aborted).toBe(false);
    a.abortTracked("duck-combine");
    expect(combined!.aborted).toBe(true);
    expect(a.listenerCount).toBe(0);
    expect(b.listenerCount).toBe(0);
  });
});

describe("createTimeoutSignal", () => {
  it("aborts after timeoutMs (fallback path still works)", async () => {
    const { signal, clear } = createTimeoutSignal(20);
    expect(signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(signal.aborted).toBe(true);
    clear();
  });

  it("clear is safe to call (no throw)", () => {
    const { clear } = createTimeoutSignal(60_000);
    expect(() => clear()).not.toThrow();
    clear();
  });

  it("fallback timer path aborts when AbortSignal.timeout is missing", async () => {
    delete AbortSignalStatics.timeout;
    const { signal, clear } = createTimeoutSignal(15);
    expect(signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(signal.aborted).toBe(true);
    clear();
  });

  it("fallback clear cancels the pending timer", async () => {
    delete AbortSignalStatics.timeout;
    const { signal, clear } = createTimeoutSignal(200);
    clear();
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.aborted).toBe(false);
  });

  it("clamps negative timeoutMs to zero and aborts promptly on fallback path", async () => {
    delete AbortSignalStatics.timeout;
    const { signal, clear } = createTimeoutSignal(-5);
    expect(signal).toBeDefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(signal.aborted).toBe(true);
    clear();
  });

  it("does not use AbortSignal.timeout so clear() can cancel (P610-ABT-1)", () => {
    expect(typeof AbortSignalStatics.timeout).toBe("function");
    let timeoutCalls = 0;
    const nativeTimeout = AbortSignalStatics.timeout!;
    AbortSignalStatics.timeout = ((ms: number) => {
      timeoutCalls += 1;
      return nativeTimeout.call(AbortSignal, ms);
    }) as typeof nativeTimeout;
    try {
      const { signal, clear } = createTimeoutSignal(60_000);
      expect(timeoutCalls).toBe(0);
      expect(signal.aborted).toBe(false);
      clear();
    } finally {
      AbortSignalStatics.timeout = nativeTimeout;
    }
  });

  it("clear cancels the pending timer even when AbortSignal.timeout exists (P610-ABT-1)", async () => {
    expect(typeof AbortSignalStatics.timeout).toBe("function");
    const { signal, clear } = createTimeoutSignal(25);
    clear();
    await new Promise((r) => setTimeout(r, 60));
    expect(signal.aborted).toBe(false);
  });

  it("unrefs the timer when the host handle exposes unref (P610-ABT-1)", () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let unrefCalls = 0;
    const innerIds = new WeakMap<object, ReturnType<typeof originalSetTimeout>>();

    const patchedSetTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const id = originalSetTimeout(
        handler as Parameters<typeof originalSetTimeout>[0],
        timeout,
        ...args,
      );
      const handle = {
        unref() {
          unrefCalls += 1;
          if (id && typeof id === "object" && "unref" in id) {
            (id as { unref: () => void }).unref();
          }
        },
      };
      innerIds.set(handle, id);
      return handle;
    }) as typeof setTimeout;

    const patchedClearTimeout = ((handle: unknown) => {
      if (handle && typeof handle === "object" && innerIds.has(handle)) {
        originalClearTimeout(innerIds.get(handle) as never);
        return;
      }
      originalClearTimeout(handle as never);
    }) as typeof clearTimeout;

    globalThis.setTimeout = patchedSetTimeout;
    globalThis.clearTimeout = patchedClearTimeout;
    try {
      const { signal, clear } = createTimeoutSignal(60_000);
      expect(signal.aborted).toBe(false);
      expect(unrefCalls).toBe(1);
      clear();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

describe("isAbortError / mapHttpAbortError", () => {
  it("detects AbortError and TimeoutError by name", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new DOMException("x", "TimeoutError"))).toBe(true);
    expect(isAbortError(new Error("network"))).toBe(false);
  });

  it("returns false for null/primitive and true for nested cause names", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    const nested = new Error("wrapper");
    (nested as { cause?: unknown }).cause = new DOMException(
      "aborted",
      "AbortError",
    );
    expect(isAbortError(nested)).toBe(true);
    const nestedTimeout = new Error("wrapper");
    (nestedTimeout as { cause?: unknown }).cause = {
      name: "TimeoutError",
    };
    expect(isAbortError(nestedTimeout)).toBe(true);
    const nestedOther = new Error("wrapper");
    (nestedOther as { cause?: unknown }).cause = { name: "TypeError" };
    expect(isAbortError(nestedOther)).toBe(false);
  });

  it("maps caller abort to PaymentAbortedError", () => {
    const caller = new AbortController();
    caller.abort();
    const timeout = new AbortController();
    const mapped = mapHttpAbortError(
      new DOMException("Aborted", "AbortError"),
      {
        callerSignal: caller.signal,
        timeoutSignal: timeout.signal,
        timeoutMessage: "timed out",
        networkMessage: "network failed",
      },
    );
    expect(mapped).toBeInstanceOf(PaymentAbortedError);
    expect(mapped.message).toMatch(/aborted by caller/i);
  });

  it("maps timeout abort to NetworkError", () => {
    const caller = new AbortController();
    const timeout = new AbortController();
    timeout.abort();
    const mapped = mapHttpAbortError(
      new DOMException("Aborted", "AbortError"),
      {
        callerSignal: caller.signal,
        timeoutSignal: timeout.signal,
        timeoutMessage: "timed out after 1ms",
        networkMessage: "network failed",
      },
    );
    expect(mapped).toBeInstanceOf(NetworkError);
    expect(mapped.message).toBe("timed out after 1ms");
  });

  it("maps non-abort errors to NetworkError", () => {
    const mapped = mapHttpAbortError(new Error("ECONNRESET"), {
      timeoutMessage: "timed out",
      networkMessage: "network failed",
    });
    expect(mapped).toBeInstanceOf(NetworkError);
    expect(mapped.message).toBe("network failed");
  });

  it("prefers caller when both caller and timeout are aborted", () => {
    const caller = new AbortController();
    caller.abort();
    const timeout = new AbortController();
    timeout.abort();
    const mapped = mapHttpAbortError(
      new DOMException("Aborted", "AbortError"),
      {
        callerSignal: caller.signal,
        timeoutSignal: timeout.signal,
        timeoutMessage: "timed out",
        networkMessage: "network failed",
        callerAbortMessage: "custom caller abort",
      },
    );
    expect(mapped).toBeInstanceOf(PaymentAbortedError);
    expect(mapped.message).toBe("custom caller abort");
  });

  it("treats abort without tracked signals as timeout NetworkError", () => {
    const mapped = mapHttpAbortError(
      new DOMException("Aborted", "AbortError"),
      {
        timeoutMessage: "gateway timed out",
        networkMessage: "network failed",
      },
    );
    expect(mapped).toBeInstanceOf(NetworkError);
    expect(mapped.message).toBe("gateway timed out");
    expect((mapped as NetworkError).afterProviderSubmit).toBe(false);
  });

  it("tags afterProviderSubmit on mutating timeouts (P610-IND-1)", () => {
    const mapped = mapHttpAbortError(new Error("ECONNRESET"), {
      timeoutMessage: "timed out",
      networkMessage: "network failed",
      afterProviderSubmit: true,
    });
    expect(mapped).toBeInstanceOf(NetworkError);
    expect((mapped as NetworkError).afterProviderSubmit).toBe(true);
    expect(isMutatingHttpMethod("POST")).toBe(true);
    expect(isMutatingHttpMethod("GET")).toBe(false);
  });

  it("NEW-CORE-1: caller abort after provider submit is NetworkError not PaymentAbortedError", () => {
    const caller = new AbortController();
    caller.abort();
    const timeout = new AbortController();
    const mapped = mapHttpAbortError(
      new DOMException("Aborted", "AbortError"),
      {
        callerSignal: caller.signal,
        timeoutSignal: timeout.signal,
        timeoutMessage: "timed out",
        networkMessage: "network failed",
        afterProviderSubmit: true,
      },
    );
    expect(mapped).toBeInstanceOf(NetworkError);
    expect(mapped).not.toBeInstanceOf(PaymentAbortedError);
    expect((mapped as NetworkError).afterProviderSubmit).toBe(true);
  });

  it("NEW-CORE-1: both caller and timeout abort after submit stay NetworkError", () => {
    const caller = new AbortController();
    caller.abort();
    const timeout = new AbortController();
    timeout.abort();
    const mapped = mapHttpAbortError(
      new DOMException("Aborted", "AbortError"),
      {
        callerSignal: caller.signal,
        timeoutSignal: timeout.signal,
        timeoutMessage: "timed out",
        networkMessage: "network failed",
        callerAbortMessage: "custom caller abort",
        afterProviderSubmit: true,
      },
    );
    expect(mapped).toBeInstanceOf(NetworkError);
    expect(mapped).not.toBeInstanceOf(PaymentAbortedError);
    expect((mapped as NetworkError).afterProviderSubmit).toBe(true);
    expect(mapped.message).toBe("custom caller abort");
  });
});

describe("extract / strip / withAbortSignal", () => {
  it("extracts AbortSignal from params", () => {
    const c = new AbortController();
    expect(extractAbortSignal({ signal: c.signal })).toBe(c.signal);
    expect(extractAbortSignal({ amount: 1 })).toBeUndefined();
    expect(extractAbortSignal(null)).toBeUndefined();
    expect(extractAbortSignal(undefined)).toBeUndefined();
    expect(extractAbortSignal("x")).toBeUndefined();
    expect(extractAbortSignal({ signal: "not-a-signal" })).toBeUndefined();
  });

  it("extracts duck-typed signals (aborted boolean + addEventListener) (P610-ABT-3)", () => {
    const duck = {
      aborted: false,
      addEventListener() {},
    };
    expect(extractAbortSignal({ signal: duck })).toBe(duck);
    expect(
      extractAbortSignal({
        signal: { aborted: true, addEventListener() {} },
      }),
    ).toEqual(expect.objectContaining({ aborted: true }));

    expect(extractAbortSignal({ signal: { aborted: false } })).toBeUndefined();
    expect(
      extractAbortSignal({ signal: { addEventListener() {} } }),
    ).toBeUndefined();
    expect(
      extractAbortSignal({
        signal: { aborted: "no", addEventListener() {} },
      }),
    ).toBeUndefined();
    expect(
      extractAbortSignal({
        signal: { aborted: false, addEventListener: 1 },
      }),
    ).toBeUndefined();
  });

  it("strips duck-typed signals from params", () => {
    const duck = { aborted: false, addEventListener() {} };
    const { rest, signal } = stripAbortSignal({ amount: 1, signal: duck });
    expect(signal).toBe(duck);
    expect(rest).not.toHaveProperty("signal");
    expect((rest as { amount: number }).amount).toBe(1);
  });

  it("strips signal and reattaches without mutating when absent", () => {
    const c = new AbortController();
    const params = { amount: 10, currency: "SAR", signal: c.signal };
    const { rest, signal } = stripAbortSignal(params);
    expect(signal).toBe(c.signal);
    expect(rest).not.toHaveProperty("signal");
    expect((rest as { amount: number }).amount).toBe(10);

    const reattached = withAbortSignal(rest, signal);
    expect(extractAbortSignal(reattached)).toBe(c.signal);

    const plain = { amount: 5 };
    const { rest: plainRest, signal: noSig } = stripAbortSignal(plain);
    expect(noSig).toBeUndefined();
    expect(plainRest).toBe(plain);
  });

  it("withAbortSignal is a no-op for undefined signal / non-objects / same signal", () => {
    const c = new AbortController();
    const obj = { amount: 1, signal: c.signal };
    expect(withAbortSignal(obj, undefined)).toBe(obj);
    expect(withAbortSignal(obj, c.signal)).toBe(obj);
    expect(withAbortSignal(null as unknown as object, c.signal)).toBe(null);
    expect(withAbortSignal(42 as unknown as object, c.signal)).toBe(42);
  });
});
