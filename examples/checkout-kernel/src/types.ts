import type { Money } from "@paykernel/core";

export type OrderStatus = "unpaid" | "paid" | "failed";

/** Process-local order book row (public JSON shape). */
export type CheckoutOrder = {
  orderId: string;
  status: OrderStatus;
  fulfillCount: number;
  gatewayPaymentId?: string;
};

export type CheckoutOrderRecord = CheckoutOrder & {
  amount: Money;
  gateway: "mock" | "stripe";
  idempotencyKey: string;
};

export type CreateOrderPaymentInput = {
  orderId?: string;
};

/** HTTP test-hook gating. Do not enable on a deployed host. */
export type CheckoutHttpOptions = {
  /**
   * Serve unauthenticated `/internal/reconcile`, `/internal/provider-paid`,
   * and `/internal/create-count`. Test-only. Do not deploy with this flag on.
   */
  enableTestHooks?: boolean;
};

export type CheckoutHttpResult = {
  status: number;
  body: unknown;
};

export type CheckoutFetchApp = {
  fetch(req: Request): Promise<Response>;
};
