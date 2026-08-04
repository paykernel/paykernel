// file: packages/core/src/runtime/abort.ts

import { PaymentAbortedError, NetworkError } from "../errors";

/**
 * Combine multiple abort signals into one that aborts when any input aborts.
 *
 * Uses `AbortSignal.any` when available; otherwise a portable AbortController
 * fan-in polyfill. Undefined/null entries are ignored. Returns `undefined`
 * when no signals are provided.
 */
export function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined | null>
): AbortSignal | undefined {
  const active = signals.filter(
    (s): s is AbortSignal => s != null && typeof s === "object",
  );

  if (active.length === 0) {
    return undefined;
  }
  if (active.length === 1) {
    return active[0];
  }

  const anyFn = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") {
    return anyFn.call(AbortSignal, active);
  }

  // Fan-in polyfill for runtimes without AbortSignal.any
  const controller = new AbortController();
  const onAbort = (event: Event) => {
    if (controller.signal.aborted) {
      return;
    }
    const source = event.target as AbortSignal | null;
    const reason =
      source && "reason" in source
        ? (source as AbortSignal).reason
        : undefined;
    try {
      controller.abort(reason);
    } catch {
      controller.abort();
    }
  };

  for (const signal of active) {
    if (signal.aborted) {
      try {
        controller.abort(signal.reason);
      } catch {
        controller.abort();
      }
      return controller.signal;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  return controller.signal;
}

export interface TimeoutSignalHandle {
  signal: AbortSignal;
  /** Clear the underlying timer (no-op when using AbortSignal.timeout). */
  clear(): void;
}

/**
 * Create an AbortSignal that aborts after `timeoutMs`.
 *
 * Prefer `AbortSignal.timeout` when available (Node 18+, modern Bun/Deno);
 * otherwise AbortController + setTimeout. Uses host timers (not {@link Clock})
 * because wall-clock injection cannot drive `setTimeout` without a scheduler
 * surface — inject a custom `fetch` that honors signals for test control.
 */
export function createTimeoutSignal(timeoutMs: number): TimeoutSignalHandle {
  const ms = Math.max(0, timeoutMs);

  const timeoutFn = (
    AbortSignal as typeof AbortSignal & {
      timeout?: (ms: number) => AbortSignal;
    }
  ).timeout;

  if (typeof timeoutFn === "function") {
    return {
      signal: timeoutFn.call(AbortSignal, ms),
      clear() {
        /* AbortSignal.timeout is self-contained */
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort(
        typeof DOMException !== "undefined"
          ? new DOMException("The operation was aborted due to timeout", "TimeoutError")
          : undefined,
      );
    } catch {
      controller.abort();
    }
  }, ms);

  // Avoid keeping the event loop alive solely for this timer (Node).
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    try {
      (timer as { unref: () => void }).unref();
    } catch {
      /* ignore */
    }
  }

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    },
  };
}

/** True when `error` looks like a fetch/abort cancellation. */
export function isAbortError(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  if (name === "AbortError" || name === "TimeoutError") {
    return true;
  }
  // Some environments nest the name on cause
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeName = (cause as { name?: unknown }).name;
    if (causeName === "AbortError" || causeName === "TimeoutError") {
      return true;
    }
  }
  return false;
}

/**
 * Map a failed HTTP fetch abort to {@link PaymentAbortedError} (caller signal)
 * or {@link NetworkError} (timeout / transport).
 *
 * Does not convert indeterminate money outcomes — only classifies transport
 * cancellation before a settled provider response.
 */
export function mapHttpAbortError(
  error: unknown,
  options: {
    /** Caller-supplied operation signal, if any. */
    callerSignal?: AbortSignal | null | undefined;
    /** Timeout signal created for this request, if any. */
    timeoutSignal?: AbortSignal | null | undefined;
    /** Message when the abort is attributed to timeout. */
    timeoutMessage: string;
    /** Message when the failure is a non-abort network error. */
    networkMessage: string;
    /** Message when the abort is attributed to the caller signal. */
    callerAbortMessage?: string | undefined;
  },
): PaymentAbortedError | NetworkError {
  if (!isAbortError(error)) {
    return new NetworkError(options.networkMessage, error);
  }

  const callerAborted = options.callerSignal?.aborted === true;
  const timeoutAborted = options.timeoutSignal?.aborted === true;

  // Prefer caller abort when the caller's signal is aborted (even if timeout
  // also raced); timeout-only when only the timeout signal fired.
  if (callerAborted && !timeoutAborted) {
    return new PaymentAbortedError(
      options.callerAbortMessage ?? "Request aborted by caller signal",
    );
  }

  if (timeoutAborted && !callerAborted) {
    return new NetworkError(options.timeoutMessage, error);
  }

  if (callerAborted) {
    // Both aborted (or timeout signal not tracked) — prefer clear caller abort.
    return new PaymentAbortedError(
      options.callerAbortMessage ?? "Request aborted by caller signal",
    );
  }

  // Abort without a tracked caller signal → treat as timeout (legacy behavior).
  return new NetworkError(options.timeoutMessage, error);
}

/**
 * Extract an AbortSignal from operation params without throwing.
 */
export function extractAbortSignal(
  params: unknown,
): AbortSignal | undefined {
  if (params == null || typeof params !== "object") {
    return undefined;
  }
  if (!("signal" in params)) {
    return undefined;
  }
  const value = (params as { signal?: unknown }).signal;
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) {
    return value;
  }
  return undefined;
}

/**
 * Remove `signal` from a params object for schema validation / fingerprinting.
 * Returns the original reference when there is no signal to strip.
 */
export function stripAbortSignal<T>(params: T): {
  rest: T;
  signal: AbortSignal | undefined;
} {
  const signal = extractAbortSignal(params);
  if (
    signal === undefined ||
    params == null ||
    typeof params !== "object"
  ) {
    return { rest: params, signal: undefined };
  }

  const { signal: _removed, ...rest } = params as T & {
    signal?: AbortSignal;
  };
  return { rest: rest as T, signal };
}

/**
 * Reattach a caller signal onto validated params (exactOptionalPropertyTypes-safe).
 */
export function withAbortSignal<T>(
  params: T,
  signal: AbortSignal | undefined,
): T {
  if (signal === undefined) {
    return params;
  }
  if (params == null || typeof params !== "object") {
    return params;
  }
  if ((params as { signal?: unknown }).signal === signal) {
    return params;
  }
  return { ...params, signal };
}
