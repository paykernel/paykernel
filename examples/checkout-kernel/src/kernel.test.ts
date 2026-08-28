import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NetworkError } from "@paykernel/core";
import { money } from "@paykernel/core";
import { createCheckoutKernel } from "./kernel";

function bodyOf(result: { body: unknown }): Record<string, unknown> {
  expect(result.body).toBeTruthy();
  expect(typeof result.body).toBe("object");
  return result.body as Record<string, unknown>;
}

describe("checkout kernel recon bind", () => {
  it("does not bind getLastProviderSideSuccess onto another order", async () => {
    const kernel = await createCheckoutKernel({
      scriptCreate: [
        { outcome: "provider_ok_client_timeout" },
        { outcome: "network_error" },
      ],
    });
    try {
      const first = await kernel.createOrderPayment({ orderId: "order_a" });
      expect(first.status).toBe(200);
      const firstBody = bodyOf(first);
      expect(firstBody.outcome).toBe("indeterminate");
      expect(firstBody.gatewayPaymentId).toBeUndefined();

      const second = await kernel.createOrderPayment({ orderId: "order_b" });
      expect(second.status).toBe(200);
      const secondBody = bodyOf(second);
      expect(secondBody.outcome).toBe("indeterminate");
      expect(secondBody.gatewayPaymentId).toBeUndefined();

      await kernel.reconcileDue();

      const orderA = kernel.getOrder("order_a");
      const orderB = kernel.getOrder("order_b");
      expect(orderA).toBeDefined();
      expect(orderB).toBeDefined();
      expect(orderA?.status).toBe("unpaid");
      expect(orderB?.status).toBe("unpaid");
      expect(orderA?.fulfillCount).toBe(0);
      expect(orderB?.fulfillCount).toBe(0);
      expect(orderA?.gatewayPaymentId).toBeUndefined();
      expect(orderB?.gatewayPaymentId).toBeUndefined();
      expect(kernel.createPaymentCount()).toBe(2);
    } finally {
      kernel.close();
    }
  });

  it.each([
    {
      label: "untagged NetworkError",
      orderId: "order_net",
      leak: "do-not-leak-network-detail",
      scriptCreate: [
        { outcome: "network_error" as const, message: "do-not-leak-network-detail" },
      ],
    },
    {
      label: "tagged afterProviderSubmit NetworkError",
      orderId: "order_tagged",
      leak: "do-not-leak-tagged-detail",
      scriptCreate: [
        {
          throw: new NetworkError("do-not-leak-tagged-detail", undefined, {
            afterProviderSubmit: true,
          }),
        },
      ],
    },
  ])("$label keeps the order and omits err.message", async ({ orderId, leak, scriptCreate }) => {
    const kernel = await createCheckoutKernel({ scriptCreate });
    try {
      const created = await kernel.createOrderPayment({ orderId });
      expect(created.status).toBe(200);
      const body = bodyOf(created);
      expect(body.outcome).toBe("indeterminate");
      expect(body.reconciliationRequired).toBe(true);
      expect(JSON.stringify(body)).not.toContain(leak);
      expect(kernel.getOrder(orderId)?.status).toBe("unpaid");
      expect(kernel.getOrder(orderId)?.gatewayPaymentId).toBeUndefined();
      expect(kernel.createPaymentCount()).toBe(1);
    } finally {
      kernel.close();
    }
  });
});

describe("checkout kernel provider snapshot money", () => {
  it("does not name trustedAmount and snapshotForOrder does not copy order.amount", () => {
    const src = readFileSync(join(import.meta.dir, "kernel.ts"), "utf8");
    expect(src).not.toContain("trustedAmount");
    const start = src.indexOf("async function snapshotForOrder");
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf("const lookup:", start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).not.toContain("order.amount");
    expect(body).toContain("providerSnapshotFromGetPayment");
  });

  it("uses getPayment money so a different provider amount is not treated as catalog paid", async () => {
    const kernel = await createCheckoutKernel({
      scriptCreate: [{ outcome: "indeterminate" }],
      scriptGet: [
        {
          outcome: "custom",
          result: {
            outcome: "succeeded",
            gatewayId: "pay_mock_1",
            status: "paid",
            amount: money("99", "USD"),
            currency: "USD",
            redirectUrl: undefined,
            rawResponse: {},
          },
        },
      ],
    });
    try {
      const created = await kernel.createOrderPayment({ orderId: "order_money" });
      expect(created.status).toBe(200);
      const createdBody = bodyOf(created);
      expect(createdBody.gatewayPaymentId).toBe("pay_mock_1");
      expect(createdBody.outcome).toBe("indeterminate");

      const recon = await kernel.reconcileDue();
      expect(recon.status).toBe(200);
      const order = kernel.getOrder("order_money");
      expect(order?.status).toBe("unpaid");
      expect(order?.fulfillCount).toBe(0);
    } finally {
      kernel.close();
    }
  });

  it("fail-closes getPayment amount without currency instead of copying order.amount", async () => {
    const kernel = await createCheckoutKernel({
      scriptCreate: [{ outcome: "indeterminate" }],
      scriptGet: [
        {
          outcome: "custom",
          result: {
            outcome: "succeeded",
            gatewayId: "pay_mock_1",
            status: "paid",
            amount: money("10", "USD"),
            redirectUrl: undefined,
            rawResponse: {},
          },
        },
      ],
    });
    try {
      const created = await kernel.createOrderPayment({ orderId: "order_incomplete_money" });
      expect(created.status).toBe(200);
      expect(bodyOf(created).gatewayPaymentId).toBe("pay_mock_1");

      await kernel.reconcileDue();
      const order = kernel.getOrder("order_incomplete_money");
      expect(order?.status).toBe("unpaid");
      expect(order?.fulfillCount).toBe(0);
    } finally {
      kernel.close();
    }
  });
});
