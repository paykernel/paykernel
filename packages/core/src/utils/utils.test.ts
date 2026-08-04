import { describe, it, expect } from "bun:test";
import {
  withRetry,
  parseRetryAfterSeconds,
  extractRetryAfterSeconds,
} from "./retry";
import { redact, createRedactingLogger, type Logger } from "./logger";
import {
  InMemoryIdempotencyStore,
  fingerprintParams,
} from "./idempotency";

describe("withRetry", () => {
  const fastConfig = { baseDelayMs: 0, maxDelayMs: 0 };

  it("retries retryable failures and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return "ok";
      },
      { isRetryable: () => true, config: fastConfig },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable failures", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("permanent");
        },
        { isRetryable: () => false, config: fastConfig },
      ),
    ).rejects.toThrow("permanent");
    expect(attempts).toBe(1);
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error(`fail-${attempts}`);
        },
        { isRetryable: () => true, config: { ...fastConfig, maxAttempts: 4 } },
      ),
    ).rejects.toThrow("fail-4");
    expect(attempts).toBe(4);
  });

  it("clamps maxAttempts to at least 1 (maxAttempts 0 still runs once)", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        return "once";
      },
      { isRetryable: () => true, config: { ...fastConfig, maxAttempts: 0 } },
    );
    expect(result).toBe("once");
    expect(attempts).toBe(1);
  });

  it("clamps negative maxAttempts to 1 and still surfaces a single failure", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("boom");
        },
        { isRetryable: () => true, config: { ...fastConfig, maxAttempts: -3 } },
      ),
    ).rejects.toThrow("boom");
    expect(attempts).toBe(1);
  });

  it("honors Retry-After above maxDelayMs (does not clamp to maxDelayMs)", async () => {
    const delays: number[] = [];
    let attempts = 0;
    // Avoid actually sleeping 120s: force the scheduled delay to 0 while
    // still recording the delay the default policy computed via onRetry.
    const originalSetTimeout = globalThis.setTimeout;
    // @ts-expect-error test stub
    globalThis.setTimeout = ((fn: () => void, _ms?: number) =>
      originalSetTimeout(fn, 0)) as typeof setTimeout;

    try {
      await withRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            const err = new Error("rate limited") as Error & {
              retryAfterSeconds: number;
            };
            err.retryAfterSeconds = 120;
            throw err;
          }
          return "ok";
        },
        {
          isRetryable: () => true,
          config: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5_000 },
          onRetry: (_err, _attempt, delayMs) => {
            delays.push(delayMs);
          },
        },
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(attempts).toBe(2);
    expect(delays).toHaveLength(1);
    // 120s must be respected even though maxDelayMs is only 5s
    expect(delays[0]).toBe(120_000);
  });

  it("clamps oversized Retry-After to the 120s high ceiling", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const originalSetTimeout = globalThis.setTimeout;
    // @ts-expect-error test stub
    globalThis.setTimeout = ((fn: () => void, _ms?: number) =>
      originalSetTimeout(fn, 0)) as typeof setTimeout;

    try {
      await withRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            const err = new Error("rate limited") as Error & {
              retryAfterSeconds: number;
            };
            err.retryAfterSeconds = 999;
            throw err;
          }
          return "ok";
        },
        {
          isRetryable: () => true,
          config: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5_000 },
          onRetry: (_err, _attempt, delayMs) => {
            delays.push(delayMs);
          },
        },
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(delays[0]).toBe(120_000);
  });

  it("applies full-jitter on exponential backoff (delay in [0, expCap])", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const originalSetTimeout = globalThis.setTimeout;
    // @ts-expect-error test stub
    globalThis.setTimeout = ((fn: () => void, _ms?: number) =>
      originalSetTimeout(fn, 0)) as typeof setTimeout;

    try {
      await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error("transient");
          return "ok";
        },
        {
          isRetryable: () => true,
          config: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 10_000 },
          onRetry: (_err, _attempt, delayMs) => {
            delays.push(delayMs);
          },
        },
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    // attempt 0: cap = 100; attempt 1: cap = 200
    expect(delays).toHaveLength(2);
    expect(delays[0]!).toBeGreaterThanOrEqual(0);
    expect(delays[0]!).toBeLessThanOrEqual(100);
    expect(delays[1]!).toBeGreaterThanOrEqual(0);
    expect(delays[1]!).toBeLessThanOrEqual(200);
  });
});

describe("parseRetryAfterSeconds", () => {
  it("parses numeric delta-seconds", () => {
    const headers = new Headers({ "retry-after": "30" });
    expect(parseRetryAfterSeconds(headers)).toBe(30);
  });

  it("returns undefined when header absent", () => {
    expect(parseRetryAfterSeconds(new Headers())).toBeUndefined();
    expect(parseRetryAfterSeconds(undefined)).toBeUndefined();
  });

  it("parses HTTP-date Retry-After into positive seconds from now", () => {
    // ~60s in the future; allow small clock skew in the assertion window
    const future = new Date(Date.now() + 60_000).toUTCString();
    const headers = new Headers({ "retry-after": future });
    const seconds = parseRetryAfterSeconds(headers);
    expect(seconds).toBeDefined();
    expect(seconds!).toBeGreaterThan(0);
    expect(seconds!).toBeLessThanOrEqual(120);
  });

  it("returns undefined for invalid non-numeric Retry-After values", () => {
    const headers = new Headers({ "retry-after": "not-a-date" });
    expect(parseRetryAfterSeconds(headers)).toBeUndefined();
  });

  it("returns undefined for HTTP-date Retry-After already in the past", () => {
    const past = new Date(Date.now() - 120_000).toUTCString();
    const headers = new Headers({ "retry-after": past });
    expect(parseRetryAfterSeconds(headers)).toBeUndefined();
  });
});

describe("extractRetryAfterSeconds", () => {
  it("reads retryAfterSeconds from an error object", () => {
    expect(extractRetryAfterSeconds({ retryAfterSeconds: 12 })).toBe(12);
    expect(extractRetryAfterSeconds(new Error("x"))).toBeUndefined();
  });
});

describe("redact", () => {
  it("redacts sensitive keys at any depth", () => {
    const input = {
      amount: 100,
      card: { number: "4242424242424242", brand: "visa" },
      customerEmail: "a@b.com",
      authorization: "Bearer secret",
      nested: { token: "tok_123", note: "ok" },
      items: [{ name: "Phone", price: 10 }],
    };

    const out = redact(input) as Record<string, any>;

    expect(out.amount).toBe(100);
    expect(out.card).toBe("[REDACTED]");
    expect(out.customerEmail).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.nested.token).toBe("[REDACTED]");
    expect(out.nested.note).toBe("ok");
    expect(out.items[0].name).toBe("[REDACTED]");
    expect(out.items[0].price).toBe(10);
  });

  it("does not mutate the input", () => {
    const input = { token: "tok_123" };
    redact(input);
    expect(input.token).toBe("tok_123");
  });

  it("keeps safe operational keys while still redacting PII name fields", () => {
    const out = redact({
      gateway: "stripe",
      gatewayName: "stripe",
      operationName: "createPayment",
      eventType: "payment_intent.succeeded",
      firstName: "Jane",
      lastName: "Doe",
      cardNumber: "4242424242424242",
    }) as Record<string, unknown>;

    expect(out.gateway).toBe("stripe");
    expect(out.gatewayName).toBe("stripe");
    expect(out.operationName).toBe("createPayment");
    expect(out.eventType).toBe("payment_intent.succeeded");
    expect(out.firstName).toBe("[REDACTED]");
    expect(out.lastName).toBe("[REDACTED]");
    expect(out.cardNumber).toBe("[REDACTED]");
  });

  it("allowlists payment identity keys that would otherwise match sensitive substrings", () => {
    const out = redact({
      idempotencyKey: "idem_abc",
      authorizationId: "AUTH-1",
      gatewayPaymentId: "pi_123",
      gatewayId: "pi_123",
      captureId: "CAP-1",
      orderId: "ORD-1",
      paymentId: "pay_1",
      authorization: "Bearer secret",
      apiKey: "sk_live_xxx",
    }) as Record<string, unknown>;

    expect(out.idempotencyKey).toBe("idem_abc");
    expect(out.authorizationId).toBe("AUTH-1");
    expect(out.gatewayPaymentId).toBe("pi_123");
    expect(out.gatewayId).toBe("pi_123");
    expect(out.captureId).toBe("CAP-1");
    expect(out.orderId).toBe("ORD-1");
    expect(out.paymentId).toBe("pay_1");
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.apiKey).toBe("[REDACTED]");
  });

  it("allowlists Phase 20 OperationContext / telemetry diagnostic keys", () => {
    const out = redact({
      operationId: "op_1",
      operationType: "payment.create",
      providerRequestId: "req_abc",
      providerObjectId: "pi_123",
      internalReference: "ord_1",
      attemptNumber: 2,
      durationMs: 12,
      duration: 12,
      tenant: "acme",
      namespace: "prod",
      inboxEventKey: "inbox:evt_1",
      eventKey: "evt_1",
      normalizedOutcome: "succeeded",
      outcome: "succeeded",
      reconciliationRequired: true,
      retry: false,
      retryable: true,
      errorName: "TimeoutError",
      exceptionType: "TimeoutError",
      // Still sensitive — must not weaken PII redaction
      firstName: "Jane",
      cardNumber: "4242424242424242",
      secretToken: "tok_x",
    }) as Record<string, unknown>;

    expect(out.operationId).toBe("op_1");
    expect(out.operationType).toBe("payment.create");
    expect(out.providerRequestId).toBe("req_abc");
    expect(out.providerObjectId).toBe("pi_123");
    expect(out.internalReference).toBe("ord_1");
    expect(out.attemptNumber).toBe(2);
    expect(out.durationMs).toBe(12);
    expect(out.duration).toBe(12);
    expect(out.tenant).toBe("acme");
    expect(out.namespace).toBe("prod");
    expect(out.inboxEventKey).toBe("inbox:evt_1");
    expect(out.eventKey).toBe("evt_1");
    expect(out.normalizedOutcome).toBe("succeeded");
    expect(out.outcome).toBe("succeeded");
    expect(out.reconciliationRequired).toBe(true);
    expect(out.errorName).toBe("TimeoutError");
    expect(out.exceptionType).toBe("TimeoutError");
    expect(out.retry).toBe(false);
    expect(out.retryable).toBe(true);
    expect(out.firstName).toBe("[REDACTED]");
    expect(out.cardNumber).toBe("[REDACTED]");
    expect(out.secretToken).toBe("[REDACTED]");
  });
});

describe("createRedactingLogger", () => {
  it("redacts structured context before forwarding", () => {
    const calls: Array<[string, unknown]> = [];
    const sink: Logger = {
      debug: () => {},
      info: () => {},
      warn: (m, c) => calls.push([m, c]),
      error: () => {},
    };

    const logger = createRedactingLogger(sink);
    logger.warn("charging", { amount: 5, card: { number: "4242" } });

    expect(calls[0]![0]).toBe("charging");
    expect((calls[0]![1] as any).amount).toBe(5);
    expect((calls[0]![1] as any).card).toBe("[REDACTED]");
  });
});

describe("InMemoryIdempotencyStore", () => {
  it("reserves a free key and reports existing on second reserve", () => {
    const store = new InMemoryIdempotencyStore();
    const record = { status: "in_progress" as const, fingerprint: "fp", createdAt: Date.now() };

    expect(store.reserve("k", record)).toBeUndefined();
    expect(store.reserve("k", record)).toEqual(record);
  });

  it("expires entries after the TTL", () => {
    const store = new InMemoryIdempotencyStore(1);
    store.set("k", { status: "completed", fingerprint: "fp", createdAt: Date.now() });
    const before = store.get("k");
    expect(before).toBeDefined();
    // Wait past the 1ms TTL.
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }
    expect(store.get("k")).toBeUndefined();
  });

  it("caps the number of stored entries to avoid unbounded growth", () => {
    const store = new InMemoryIdempotencyStore(60_000, 100);
    for (let i = 0; i < 1000; i++) {
      store.set(`k${i}`, { status: "completed", fingerprint: "fp", createdAt: Date.now() });
    }
    expect(store.size).toBeLessThanOrEqual(100);
    // The most recently written key survives; the oldest are evicted first.
    expect(store.get("k999")).toBeDefined();
    expect(store.get("k0")).toBeUndefined();
  });
});

describe("fingerprintParams", () => {
  it("is stable regardless of key order", () => {
    expect(fingerprintParams({ a: 1, b: 2 })).toBe(fingerprintParams({ b: 2, a: 1 }));
  });

  it("differs when values differ", () => {
    expect(fingerprintParams({ amount: 50 })).not.toBe(fingerprintParams({ amount: 60 }));
  });

  it("encodes undefined distinctly from null", () => {
    expect(fingerprintParams(undefined)).not.toBe(fingerprintParams(null));
    expect(fingerprintParams({ a: undefined })).not.toBe(fingerprintParams({ a: null }));
    expect(fingerprintParams([undefined])).not.toBe(fingerprintParams([null]));
  });
});
