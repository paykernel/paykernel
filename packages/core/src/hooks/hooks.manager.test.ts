/**
 * Unit tests for HooksManager composition and isolation paths.
 * Complements client/gateway integration tests that exercise executeWithHooks.
 */
import { describe, it, expect, mock } from "bun:test";
import { HooksManager } from "./hooks.manager";
import type { HookContext } from "./hooks.types";
import type { Logger } from "../utils/logger";
import type { WebhookEvent } from "../types/webhook.types";

function baseCtx<T>(
  overrides: Partial<HookContext<T>> & { params: T },
): HookContext<T> {
  return {
    gateway: "stripe",
    operation: "createPayment",
    timestamp: new Date(),
    metadata: {},
    ...overrides,
  };
}

function createCapturingLogger() {
  const warns: Array<{ msg: string; meta?: unknown }> = [];
  const errors: Array<{ msg: string; meta?: unknown }> = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg, meta) => {
      warns.push({ msg, meta });
    },
    error: (msg, meta) => {
      errors.push({ msg, meta });
    },
  };
  return { logger, warns, errors };
}

describe("HooksManager constructor and register", () => {
  it("shallow-copies initial hooks so caller mutation does not affect the manager", async () => {
    const hooks = {
      onBefore: async () => ({ proceed: true as const }),
    };
    const manager = new HooksManager(hooks);
    // Mutate caller's object after construction
    delete (hooks as { onBefore?: unknown }).onBefore;

    const result = await manager.runBefore(
      baseCtx({ params: { amount: 1 }, operation: "createPayment" }),
    );
    expect(result.proceed).toBe(true);
  });

  it("ignores register(undefined/null) without clearing existing handlers", async () => {
    const manager = new HooksManager({
      onBefore: async () => ({ proceed: true, params: { tagged: true } }),
    });
    manager.register("onBefore", undefined as never);
    manager.register("onBefore", null as never);

    const ctx = baseCtx({ params: { tagged: false }, operation: "createPayment" });
    const result = await manager.runBefore(ctx);
    expect(result.proceed).toBe(true);
    expect(result.params).toEqual({ tagged: true });
  });
});

describe("HooksManager before-hook composition", () => {
  it("short-circuits composed before-hooks when the previous returns proceed:false", async () => {
    const second = mock(async () => ({ proceed: true as const }));
    const manager = new HooksManager({
      beforeCreatePayment: async () => ({
        proceed: false,
        abortReason: "fraud",
      }),
    });
    manager.register("beforeCreatePayment", second);

    const result = await manager.runBefore(
      baseCtx({
        params: { amount: 10, currency: "USD" },
        operation: "createPayment",
      }),
    );

    expect(result.proceed).toBe(false);
    expect(result.abortReason).toBe("fraud");
    expect(second).not.toHaveBeenCalled();
  });

  it("applies previous param modifications before calling the next before-hook", async () => {
    const manager = new HooksManager({
      beforeCapture: async (ctx) => ({
        proceed: true,
        params: { ...ctx.params, amount: 99 },
      }),
    });
    manager.register("beforeCapture", async (ctx) => {
      expect(ctx.params).toEqual(
        expect.objectContaining({ gatewayPaymentId: "pi_1", amount: 99 }),
      );
      return {
        proceed: true,
        params: { ...ctx.params, metadata: { from: "second" } },
      };
    });

    const result = await manager.runBefore(
      baseCtx({
        params: { gatewayPaymentId: "pi_1", amount: 10 },
        operation: "capturePayment",
      }),
    );

    expect(result.proceed).toBe(true);
    expect(result.params).toEqual(
      expect.objectContaining({
        gatewayPaymentId: "pi_1",
        amount: 99,
        metadata: { from: "second" },
      }),
    );
  });

  it("runs global onBefore before specific before hooks and aborts if global stops", async () => {
    const specific = mock(async () => ({ proceed: true as const }));
    const manager = new HooksManager({
      onBefore: async () => ({ proceed: false, abortReason: "global stop" }),
      beforeRefund: specific,
    });

    const result = await manager.runBefore(
      baseCtx({
        params: { gatewayPaymentId: "pi_r" },
        operation: "refundPayment",
      }),
    );

    expect(result.proceed).toBe(false);
    expect(result.abortReason).toBe("global stop");
    expect(specific).not.toHaveBeenCalled();
  });

  it("composes onBefore short-circuit the same way as specific before hooks", async () => {
    const second = mock(async () => ({ proceed: true as const }));
    const manager = new HooksManager({
      onBefore: async () => ({ proceed: false, abortReason: "first global" }),
    });
    manager.register("onBefore", second);

    const result = await manager.runBefore(
      baseCtx({ params: {}, operation: "voidPayment" }),
    );
    expect(result.proceed).toBe(false);
    expect(result.abortReason).toBe("first global");
    expect(second).not.toHaveBeenCalled();
  });
});

describe("HooksManager after-hook isolation (unit)", () => {
  it("ignores proceed:false on specific after-hook, warns, and still returns success", async () => {
    const { logger, warns } = createCapturingLogger();
    const manager = new HooksManager(
      {
        afterCreatePayment: async () => ({ proceed: false }),
      },
      logger,
    );

    const original = { success: true, status: "paid", gatewayId: "pay_1" };
    const result = await manager.runAfter(
      baseCtx({ params: {}, operation: "createPayment" }),
      original,
    );

    expect(result.proceed).toBe(true);
    expect(result.modifiedResult).toBeUndefined();
    expect(warns.some((w) => w.msg.includes("proceed:false"))).toBe(true);
  });

  it("isolates after-hook throws, keeps earlier modifiedResult, runs later onAfter", async () => {
    const { logger, errors } = createCapturingLogger();
    let onAfterSaw: unknown;
    const manager = new HooksManager(
      {
        afterVoid: async (_ctx, result) => {
          return {
            proceed: true,
            modifiedResult: { ...result, annotation: "kept" },
          };
        },
        onAfter: async (_ctx, result) => {
          onAfterSaw = result;
          throw new Error("analytics boom");
        },
      },
      logger,
    );
    // Re-register afterVoid to compose a second handler that throws
    manager.register("afterVoid", async () => {
      throw new Error("second after boom");
    });

    const original = { success: true, status: "cancelled", gatewayId: "pi_v" };
    const result = await manager.runAfter(
      baseCtx({ params: { gatewayPaymentId: "pi_v" }, operation: "voidPayment" }),
      original,
    );

    expect(result.proceed).toBe(true);
    expect(result.modifiedResult).toEqual(
      expect.objectContaining({ annotation: "kept", gatewayId: "pi_v" }),
    );
    expect(onAfterSaw).toEqual(
      expect.objectContaining({ annotation: "kept" }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(
      errors.some(
        (e) =>
          e.msg.includes("threw") &&
          String((e.meta as { hookError?: string })?.hookError ?? "").includes(
            "boom",
          ),
      ),
    ).toBe(true);
  });

  it("composed after-hooks continue after proceed:false and carry modifiedResult", async () => {
    const { logger, warns } = createCapturingLogger();
    const manager = new HooksManager(
      {
        afterRefund: async (_ctx, result) => ({
          proceed: false,
          modifiedResult: { ...result, step: 1 },
        }),
      },
      logger,
    );
    manager.register("afterRefund", async (_ctx, result) => ({
      proceed: true,
      modifiedResult: { ...result, step: 2 },
    }));

    const result = await manager.runAfter(
      baseCtx({
        params: { gatewayPaymentId: "pi_ref" },
        operation: "refundPayment",
      }),
      { success: true, refundId: "re_1" },
    );

    expect(result.proceed).toBe(true);
    expect(result.modifiedResult).toEqual(
      expect.objectContaining({ step: 2, refundId: "re_1" }),
    );
    expect(warns.some((w) => w.msg.includes("proceed:false"))).toBe(true);
  });

  it.each([
    {
      label: "afterCapture then onAfter",
      operation: "capturePayment" as const,
      compose: "onAfter" as const,
    },
    {
      label: "two afterCreatePayment handlers",
      operation: "createPayment" as const,
      compose: "register" as const,
    },
  ])("later handler sees frozen money identity ($label) (CORE-2)", async ({
    operation,
    compose,
  }) => {
    let laterSaw: unknown;
    const original = {
      success: false,
      status: "processing",
      amount: 50,
      currency: "USD",
      gatewayId: "pi_real",
      outcome: "requires_action",
      reconciliationRequired: true,
      nextAction: { type: "redirect", url: "https://bank.test/3ds" },
      references: { providerObjectId: "pi_real" },
    };
    const forged = {
      ...original,
      success: true,
      status: "paid",
      amount: 999,
      gatewayId: "forged",
      outcome: "succeeded",
      reconciliationRequired: false,
      nextAction: { type: "redirect", url: "https://evil.test/phish" },
      references: { providerObjectId: "forged" },
      annotation: "from-first",
    };

    const first = async (_ctx: HookContext<unknown>, _result: unknown) => ({
      proceed: true,
      modifiedResult: forged,
    });
    const second = async (_ctx: HookContext<unknown>, result: unknown) => {
      laterSaw = result;
      return { proceed: true };
    };

    const hooks =
      compose === "onAfter"
        ? { afterCapture: first, onAfter: second }
        : { afterCreatePayment: first };
    const manager = new HooksManager(hooks);
    if (compose === "register") {
      manager.register("afterCreatePayment", second);
    }

    const result = await manager.runAfter(
      baseCtx({ params: { gatewayPaymentId: "pi_real" }, operation }),
      original,
    );

    expect(laterSaw).toEqual(
      expect.objectContaining({
        success: false,
        status: "processing",
        amount: 50,
        gatewayId: "pi_real",
        outcome: "requires_action",
        reconciliationRequired: true,
        nextAction: { type: "redirect", url: "https://bank.test/3ds" },
        references: { providerObjectId: "pi_real" },
        annotation: "from-first",
      }),
    );
    expect(result.modifiedResult).toEqual(
      expect.objectContaining({
        success: false,
        status: "processing",
        amount: 50,
        gatewayId: "pi_real",
        annotation: "from-first",
      }),
    );
  });
});

describe("HooksManager onError composition", () => {
  it("runs both composed onError handlers and rethrows the first error after both complete", async () => {
    const order: string[] = [];
    const manager = new HooksManager({
      onError: async () => {
        order.push("first");
        throw new Error("first onError fail");
      },
    });
    manager.register("onError", async () => {
      order.push("second");
      throw new Error("second onError fail");
    });

    await expect(
      manager.runError(
        baseCtx({ params: {}, operation: "createPayment" }),
        new Error("primary payment error"),
      ),
    ).rejects.toThrow("first onError fail");

    expect(order).toEqual(["first", "second"]);
  });

  it("rethrows only the second onError error when the first succeeds", async () => {
    const manager = new HooksManager({
      onError: async () => {
        /* ok */
      },
    });
    manager.register("onError", async () => {
      throw new Error("only second fails");
    });

    await expect(
      manager.runError(
        baseCtx({ params: {}, operation: "capturePayment" }),
        new Error("gateway 500"),
      ),
    ).rejects.toThrow("only second fails");
  });

  it("completes when both composed onError handlers succeed", async () => {
    const seen: string[] = [];
    const manager = new HooksManager({
      onError: async (_ctx, err) => {
        seen.push(`a:${err.message}`);
      },
    });
    manager.register("onError", async (_ctx, err) => {
      seen.push(`b:${err.message}`);
    });

    await manager.runError(
      baseCtx({ params: {}, operation: "refundPayment" }),
      new Error("mapped"),
    );
    expect(seen).toEqual(["a:mapped", "b:mapped"]);
  });
});

describe("HooksManager webhook hook composition", () => {
  it("runs both onWebhookReceived handlers and rethrows the first error after both complete", async () => {
    const order: string[] = [];
    const manager = new HooksManager({
      onWebhookReceived: async () => {
        order.push("recv1");
        throw new Error("recv first");
      },
    });
    manager.register("onWebhookReceived", async () => {
      order.push("recv2");
    });

    await expect(
      manager.runWebhookReceived("stripe", { raw: true }),
    ).rejects.toThrow("recv first");
    expect(order).toEqual(["recv1", "recv2"]);
  });

  it("fail-fast onWebhookVerified: does not run next when previous throws", async () => {
    const second = mock(async () => {});
    const manager = new HooksManager({
      onWebhookVerified: async () => {
        throw new Error("fulfillment failed");
      },
    });
    manager.register("onWebhookVerified", second);

    const event = {
      id: "evt_fail_fast",
      gateway: "stripe",
      type: "payment.paid",
      paymentId: "pi_1",
      gatewayPaymentId: "pi_1",
      status: "paid",
      timestamp: new Date("2024-01-01T00:00:00.000Z"),
      rawPayload: {},
    } as WebhookEvent;

    await expect(manager.runWebhookVerified(event)).rejects.toThrow(
      "fulfillment failed",
    );
    expect(second).not.toHaveBeenCalled();
  });

  it("runs both onWebhookVerified handlers in order when none throw", async () => {
    const order: string[] = [];
    const manager = new HooksManager({
      onWebhookVerified: async (e) => {
        order.push(`a:${e.paymentId}`);
      },
    });
    manager.register("onWebhookVerified", async (e) => {
      order.push(`b:${e.paymentId}`);
    });

    await manager.runWebhookVerified({
      id: "evt_order",
      gateway: "moyasar",
      type: "payment_paid",
      paymentId: "pay_x",
      gatewayPaymentId: "pay_x",
      status: "paid",
      timestamp: new Date("2024-01-01T00:00:00.000Z"),
      rawPayload: {},
    } as WebhookEvent);

    expect(order).toEqual(["a:pay_x", "b:pay_x"]);
  });

  it("clones event per onWebhookVerified handler so first cannot poison second (CORE-2)", async () => {
    const seen: Array<{ status: string; amount?: number }> = [];
    const manager = new HooksManager({
      onWebhookVerified: async (e) => {
        seen.push({ status: e.status, amount: e.amount });
        // Mutate identity fields — must not affect the next handler.
        e.status = "failed";
        e.amount = 0.01;
        (e as { stableType?: string }).stableType = "payment.failed";
      },
    });
    manager.register("onWebhookVerified", async (e) => {
      seen.push({ status: e.status, amount: e.amount });
    });

    await manager.runWebhookVerified({
      id: "evt_clone",
      gateway: "stripe",
      type: "payment_intent.succeeded",
      paymentId: "pi_1",
      gatewayPaymentId: "pi_1",
      status: "paid",
      amount: 25,
      currency: "USD",
      timestamp: new Date("2024-01-01T00:00:00.000Z"),
      rawPayload: {},
      stableType: "payment.succeeded",
    } as WebhookEvent);

    expect(seen).toEqual([
      { status: "paid", amount: 25 },
      { status: "paid", amount: 25 },
    ]);
  });

  it("PERF-6: onWebhookVerified clones isolate rawPayload root keys without deep-copy", async () => {
    const raw = { id: "evt_raw", nested: { n: 1 } };
    const seen: unknown[] = [];
    const manager = new HooksManager({
      onWebhookVerified: async (e) => {
        (e.rawPayload as Record<string, unknown>).annotated = true;
        seen.push((e.rawPayload as Record<string, unknown>).annotated);
      },
    });
    manager.register("onWebhookVerified", async (e) => {
      seen.push((e.rawPayload as Record<string, unknown>).annotated);
    });

    await manager.runWebhookVerified({
      id: "evt_raw_clone",
      gateway: "stripe",
      type: "payment_intent.succeeded",
      paymentId: "pi_1",
      gatewayPaymentId: "pi_1",
      status: "paid",
      timestamp: new Date("2024-01-01T00:00:00.000Z"),
      rawPayload: raw,
    } as WebhookEvent);

    expect(seen).toEqual([true, undefined]);
    expect((raw as { annotated?: boolean }).annotated).toBeUndefined();
    expect(raw.nested.n).toBe(1);
  });

  it("post-before guards see hook-injected amount (CORE-1 support)", async () => {
    const seenAmounts: unknown[] = [];
    const manager = new HooksManager({
      beforeCapture: async (ctx) => ({
        proceed: true,
        params: { ...ctx.params, amount: 42 },
      }),
    });
    manager.registerPostBeforeGuard((ctx) => {
      if (ctx.operation === "capturePayment") {
        seenAmounts.push((ctx.params as { amount?: unknown }).amount);
      }
    });

    const result = await manager.runBefore(
      baseCtx({
        params: { gatewayPaymentId: "pi_1" },
        operation: "capturePayment",
      }),
    );

    expect(result.proceed).toBe(true);
    expect(result.params).toEqual(
      expect.objectContaining({ amount: 42, gatewayPaymentId: "pi_1" }),
    );
    expect(seenAmounts).toEqual([42]);
  });

  it("runs both onWebhookFailed handlers and rethrows the first error after both complete", async () => {
    const order: string[] = [];
    const manager = new HooksManager({
      onWebhookFailed: async () => {
        order.push("fail1");
        throw new Error("secondary fail1");
      },
    });
    manager.register("onWebhookFailed", async () => {
      order.push("fail2");
      throw new Error("secondary fail2");
    });

    await expect(
      manager.runWebhookFailed({ bad: true }, new Error("invalid signature")),
    ).rejects.toThrow("secondary fail1");
    expect(order).toEqual(["fail1", "fail2"]);
  });

  it("rethrows only the second onWebhookFailed error when the first succeeds", async () => {
    const manager = new HooksManager({
      onWebhookFailed: async () => {},
    });
    manager.register("onWebhookFailed", async () => {
      throw new Error("only second webhook-failed");
    });

    await expect(
      manager.runWebhookFailed({}, new Error("verify failed")),
    ).rejects.toThrow("only second webhook-failed");
  });
});

describe("HooksManager operation-specific hook routing", () => {
  const ops = [
    "createPayment",
    "authorizePayment",
    "capturePayment",
    "refundPayment",
    "voidPayment",
  ] as const;

  for (const operation of ops) {
    it(`routes before/after hooks for ${operation}`, async () => {
      const beforeKey = {
        createPayment: "beforeCreatePayment",
        authorizePayment: "beforeAuthorize",
        capturePayment: "beforeCapture",
        refundPayment: "beforeRefund",
        voidPayment: "beforeVoid",
      }[operation] as
        | "beforeCreatePayment"
        | "beforeAuthorize"
        | "beforeCapture"
        | "beforeRefund"
        | "beforeVoid";

      const afterKey = {
        createPayment: "afterCreatePayment",
        authorizePayment: "afterAuthorize",
        capturePayment: "afterCapture",
        refundPayment: "afterRefund",
        voidPayment: "afterVoid",
      }[operation] as
        | "afterCreatePayment"
        | "afterAuthorize"
        | "afterCapture"
        | "afterRefund"
        | "afterVoid";

      const manager = new HooksManager({
        [beforeKey]: async () => ({
          proceed: true,
          params: { via: beforeKey },
        }),
        [afterKey]: async (_ctx: unknown, result: { ok: boolean }) => ({
          proceed: true,
          modifiedResult: { ...result, via: afterKey },
        }),
      });

      const before = await manager.runBefore(
        baseCtx({ params: {}, operation }),
      );
      expect(before.proceed).toBe(true);
      expect(before.params).toEqual({ via: beforeKey });

      const after = await manager.runAfter(
        baseCtx({ params: {}, operation }),
        { ok: true },
      );
      expect(after.proceed).toBe(true);
      expect(after.modifiedResult).toEqual({ ok: true, via: afterKey });
    });
  }

  it("returns proceed:true with original params when no before hooks are registered", async () => {
    const manager = new HooksManager({});
    const params = { gatewayPaymentId: "x" };
    const result = await manager.runBefore(
      baseCtx({ params, operation: "getPayment" as never }),
    );
    expect(result).toEqual({ proceed: true, params });
  });

  it("no-ops webhook/error runners when hooks are absent", async () => {
    const manager = new HooksManager();
    await manager.runError(
      baseCtx({ params: {}, operation: "createPayment" }),
      new Error("x"),
    );
    await manager.runWebhookReceived("paypal", {});
    await manager.runWebhookVerified({
      gateway: "paypal",
      type: "x",
      paymentId: "y",
      status: "paid",
    } as WebhookEvent);
    await manager.runWebhookFailed({}, new Error("z"));
  });
});
