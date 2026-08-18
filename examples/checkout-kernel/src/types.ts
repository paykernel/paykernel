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
  gateway: string;
  idempotencyKey: string;
};

export type CreateOrderPaymentInput = {
  orderId?: string;
  amount?: string;
  currency?: string;
};

export type CheckoutHttpResult = {
  status: number;
  body: unknown;
};

export type CheckoutFetchApp = {
  fetch(req: Request): Promise<Response>;
};
