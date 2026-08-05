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
import { money } from "./money";

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

  it("redacts banking / government identifier keys (iban, bank, ssn, pin)", () => {
    const out = redact({
      iban: "DE89370400440532013000",
      bankAccount: "12345678",
      bankCode: "1100000",
      ssn: "123-45-6789",
      pin: "1234",
      pinCode: "9999",
      // Operational ids stay visible
      refundId: "re_1",
      customerId: "cus_1",
      amount: 10.5,
      currency: "SAR",
    }) as Record<string, unknown>;

    expect(out.iban).toBe("[REDACTED]");
    expect(out.bankAccount).toBe("[REDACTED]");
    expect(out.bankCode).toBe("[REDACTED]");
    expect(out.ssn).toBe("[REDACTED]");
    expect(out.pin).toBe("[REDACTED]");
    expect(out.pinCode).toBe("[REDACTED]");
    expect(out.refundId).toBe("re_1");
    expect(out.customerId).toBe("cus_1");
    expect(out.amount).toBe(10.5);
    expect(out.currency).toBe("SAR");
  });

  it("redacts card expiry and tax/DOB-style keys without over-matching", () => {
    const out = redact({
      expiry: "12/30",
      expiration: "12/30",
      exp_month: 12,
      exp_year: 2030,
      expMonth: 12,
      expYear: 2030,
      dob: "1990-01-01",
      dateOfBirth: "1990-01-01",
      date_of_birth: "1990-01-01",
      tax_id: "12-3456789",
      taxId: "12-3456789",
      nationalId: "NIN-1",
      national_id: "NIN-1",
      // Must remain visible (bare "exp"/"tax" would over-match these)
      expectedStatus: "paid",
      exportFormat: "json",
      syntaxTree: true,
    }) as Record<string, unknown>;

    expect(out.expiry).toBe("[REDACTED]");
    expect(out.expiration).toBe("[REDACTED]");
    expect(out.exp_month).toBe("[REDACTED]");
    expect(out.exp_year).toBe("[REDACTED]");
    expect(out.expMonth).toBe("[REDACTED]");
    expect(out.expYear).toBe("[REDACTED]");
    expect(out.dob).toBe("[REDACTED]");
    expect(out.dateOfBirth).toBe("[REDACTED]");
    expect(out.date_of_birth).toBe("[REDACTED]");
    expect(out.tax_id).toBe("[REDACTED]");
    expect(out.taxId).toBe("[REDACTED]");
    expect(out.nationalId).toBe("[REDACTED]");
    expect(out.national_id).toBe("[REDACTED]");
    expect(out.expectedStatus).toBe("paid");
    expect(out.exportFormat).toBe("json");
    expect(out.syntaxTree).toBe(true);
  });

  it("redacts cookie / passwd / pwd / otp / credentials without over-matching", () => {
    const out = redact({
      cookie: "session=abc",
      setCookie: "sid=xyz",
      passwd: "hunter2",
      pwd: "hunter2",
      userPwd: "hunter2",
      otp: "123456",
      otpValue: "654321",
      totpCode: "999999",
      credentials: { user: "a", pass: "b" },
      // Must remain visible — bare patterns must not substring-match these
      // (password already covered elsewhere; outcome/status stay diagnostic)
      outcome: "succeeded",
      status: "paid",
      amount: 10.5,
      currency: "SAR",
    }) as Record<string, unknown>;

    expect(out.cookie).toBe("[REDACTED]");
    expect(out.setCookie).toBe("[REDACTED]");
    expect(out.passwd).toBe("[REDACTED]");
    expect(out.pwd).toBe("[REDACTED]");
    expect(out.userPwd).toBe("[REDACTED]");
    expect(out.otp).toBe("[REDACTED]");
    expect(out.otpValue).toBe("[REDACTED]");
    expect(out.totpCode).toBe("[REDACTED]");
    expect(out.credentials).toBe("[REDACTED]");
    expect(out.outcome).toBe("succeeded");
    expect(out.status).toBe("paid");
    expect(out.amount).toBe(10.5);
    expect(out.currency).toBe("SAR");
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

  it("caps growth by evicting unknown; never drops completed/in_progress (MONEY-1)", () => {
    const store = new InMemoryIdempotencyStore(60_000, 3);
    store.set("a", { status: "unknown", fingerprint: "a", createdAt: 1 });
    store.set("b", { status: "completed", fingerprint: "b", createdAt: 2 });
    store.set("c", { status: "in_progress", fingerprint: "c", createdAt: 3 });

    // Unknown is unprotected and may be evicted under pressure.
    store.set("d", { status: "unknown", fingerprint: "d", createdAt: 4 });
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")?.status).toBe("completed");
    expect(store.get("c")?.status).toBe("in_progress");
    expect(store.get("d")?.status).toBe("unknown");
    expect(store.size).toBe(3);

    // Full of protected keys → refuse new key rather than drop mutation guards.
    const full = new InMemoryIdempotencyStore(60_000, 2);
    full.set("p1", { status: "completed", fingerprint: "1", createdAt: 1 });
    full.set("p2", { status: "in_progress", fingerprint: "2", createdAt: 2 });
    expect(() =>
      full.set("p3", { status: "completed", fingerprint: "3", createdAt: 3 }),
    ).toThrow(/protected in_progress\/completed/);
    expect(full.get("p1")).toBeDefined();
    expect(full.get("p2")).toBeDefined();
    expect(full.size).toBe(2);
  });

  it("clones records on get/set so callers cannot mutate the live cache", () => {
    const store = new InMemoryIdempotencyStore();
    const result = { status: "paid", amount: 10.5 };
    const record = {
      status: "completed" as const,
      fingerprint: "fp",
      createdAt: 1,
      result,
    };

    store.set("k", record);

    // Mutating the caller's original must not affect the store.
    record.status = "in_progress";
    record.fingerprint = "tampered";
    result.status = "failed";

    const got = store.get("k");
    expect(got).toEqual({
      status: "completed",
      fingerprint: "fp",
      createdAt: 1,
      result: { status: "paid", amount: 10.5 },
    });

    // Mutating the returned record must not affect a subsequent get.
    got!.status = "unknown";
    (got!.result as { status: string }).status = "refunded";
    expect(store.get("k")).toEqual({
      status: "completed",
      fingerprint: "fp",
      createdAt: 1,
      result: { status: "paid", amount: 10.5 },
    });
  });

  it("clones records returned from reserve", () => {
    const store = new InMemoryIdempotencyStore();
    const record = {
      status: "in_progress" as const,
      fingerprint: "fp",
      createdAt: 1,
    };
    expect(store.reserve("k", record)).toBeUndefined();

    const existing = store.reserve("k", {
      status: "in_progress",
      fingerprint: "other",
      createdAt: 2,
    });
    expect(existing).toEqual({
      status: "in_progress",
      fingerprint: "fp",
      createdAt: 1,
    });
    existing!.fingerprint = "mutated";
    expect(store.get("k")?.fingerprint).toBe("fp");
  });

  it("move-to-end on update; unknown-only eviction keeps protected keys (MONEY-1)", () => {
    const store = new InMemoryIdempotencyStore(60_000, 3);
    store.set("a", { status: "unknown", fingerprint: "a", createdAt: 1 });
    store.set("b", { status: "unknown", fingerprint: "b", createdAt: 2 });
    store.set("c", { status: "completed", fingerprint: "c", createdAt: 3 });

    // Refresh "a" — recency tracking still applies among unprotected keys.
    store.set("a", {
      status: "unknown",
      fingerprint: "a-updated",
      createdAt: 1,
      result: { ok: true },
    });

    store.set("d", { status: "unknown", fingerprint: "d", createdAt: 4 });

    expect(store.get("a")?.fingerprint).toBe("a-updated");
    expect(store.get("a")?.result).toEqual({ ok: true });
    // Least-recently-updated unknown "b" is preferred for eviction; completed "c" stays.
    expect(store.get("b")).toBeUndefined();
    expect(store.get("c")?.status).toBe("completed");
    expect(store.get("d")).toBeDefined();
    expect(store.size).toBe(3);
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

  it("canonicalizes Money / AmountInput so economically identical amounts match", () => {
    const asMoney = money("10.50", "SAR");
    const asNumber = 10.5;
    const asPadded = money("10.5", "SAR");

    // Top-level Money vs plain { amount, currency }
    expect(fingerprintParams(asMoney)).toBe(
      fingerprintParams({ amount: "10.50", currency: "SAR" }),
    );
    expect(fingerprintParams(asMoney)).toBe(fingerprintParams(asPadded));

    // money("10.50","SAR") ≡ number 10.5 with currency SAR
    expect(fingerprintParams(asMoney)).toBe(
      fingerprintParams({ amount: asNumber, currency: "SAR" }),
    );

    // Moyasar-style mutation fingerprint: amount is number | Money
    expect(
      fingerprintParams({ amount: asMoney, currency: "SAR" }),
    ).toBe(fingerprintParams({ amount: asNumber, currency: "SAR" }));
    expect(
      fingerprintParams({ amount: asMoney, currency: "SAR" }),
    ).toBe(fingerprintParams({ amount: "10.50", currency: "SAR" }));
    expect(
      fingerprintParams({ amount: asNumber, currency: "sar" }),
    ).toBe(fingerprintParams({ amount: "10.5", currency: "SAR" }));
  });

  it("preserves sibling keys on Money-shaped bags (no orderId collision)", () => {
    // Duck-typed Money + extra fields must not drop siblings after canonicalize.
    const a = fingerprintParams({
      amount: "10.00",
      currency: "USD",
      orderId: "A",
    });
    const b = fingerprintParams({
      amount: "10.00",
      currency: "USD",
      orderId: "B",
    });
    expect(a).not.toBe(b);

    // Amount forms still collapse while siblings remain distinct.
    expect(
      fingerprintParams({ amount: 10, currency: "usd", orderId: "A" }),
    ).toBe(
      fingerprintParams({ amount: "10.00", currency: "USD", orderId: "A" }),
    );
    expect(
      fingerprintParams({
        amount: money("10.00", "USD"),
        currency: "USD",
        orderId: "A",
      }),
    ).toBe(
      fingerprintParams({ amount: "10.00", currency: "USD", orderId: "A" }),
    );
  });

  it("keeps nested Money currency when sibling currency mismatches", () => {
    const nested = fingerprintParams({
      amount: money("10.50", "SAR"),
      currency: "USD",
    });
    const plainUsd = fingerprintParams({ amount: "10.50", currency: "USD" });
    const plainSar = fingerprintParams({ amount: "10.50", currency: "SAR" });
    expect(nested).not.toBe(plainUsd);
    expect(nested).not.toBe(plainSar);
  });

  it("encodes NaN / Infinity distinctly from null and ordinary strings", () => {
    expect(fingerprintParams(Number.NaN)).not.toBe(fingerprintParams(null));
    expect(fingerprintParams(Number.POSITIVE_INFINITY)).not.toBe(
      fingerprintParams(null),
    );
    expect(fingerprintParams(Number.NEGATIVE_INFINITY)).not.toBe(
      fingerprintParams(null),
    );
    expect(fingerprintParams(Number.NaN)).not.toBe(
      fingerprintParams(Number.POSITIVE_INFINITY),
    );
    expect(fingerprintParams({ x: Number.NaN })).not.toBe(
      fingerprintParams({ x: null }),
    );
    // Type tags must not equal JSON string encodings of the same text.
    expect(fingerprintParams(Number.NaN)).not.toBe(fingerprintParams("NaN"));
    expect(fingerprintParams(Number.POSITIVE_INFINITY)).not.toBe(
      fingerprintParams("Infinity"),
    );
    expect(fingerprintParams(Number.NEGATIVE_INFINITY)).not.toBe(
      fingerprintParams("-Infinity"),
    );
    expect(fingerprintParams(undefined)).not.toBe(
      fingerprintParams("undefined"),
    );
    expect(fingerprintParams(undefined)).not.toBe(
      fingerprintParams("__undefined__"),
    );
  });

  it("fingerprints BigInt without throwing and without colliding with strings", () => {
    expect(fingerprintParams(10n)).toBe(fingerprintParams(10n));
    expect(fingerprintParams(10n)).not.toBe(fingerprintParams(11n));
    expect(fingerprintParams(10n)).not.toBe(fingerprintParams(10));
    expect(fingerprintParams(10n)).not.toBe(fingerprintParams("10n"));
    expect(fingerprintParams({ amount: 1050n })).toBe(
      fingerprintParams({ amount: 1050n }),
    );
    expect(fingerprintParams({ amount: 1050n })).not.toBe(
      fingerprintParams({ amount: "1050n" }),
    );
  });

  it("fingerprints Date as ISO-8601, not empty object", () => {
    const d = new Date("2026-01-15T12:00:00.000Z");
    expect(fingerprintParams(d)).toBe(JSON.stringify(d.toISOString()));
    expect(fingerprintParams(d)).not.toBe(fingerprintParams({}));
    expect(fingerprintParams({ at: d })).toBe(
      fingerprintParams({ at: new Date("2026-01-15T12:00:00.000Z") }),
    );
  });
});
