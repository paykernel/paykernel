import type { CheckoutKernel } from "./kernel";
import type {
  CheckoutFetchApp,
  CheckoutHttpOptions,
  CheckoutHttpResult,
  CreateOrderPaymentInput,
} from "./types";

export type CheckoutHandlers = {
  createPayment(input?: CreateOrderPaymentInput): Promise<CheckoutHttpResult>;
  handleStripeWebhook(
    rawBody: string,
    signature: string | null,
  ): Promise<CheckoutHttpResult>;
  reconcile(): Promise<CheckoutHttpResult>;
  getOrder(orderId: string): CheckoutHttpResult;
  providerPaid(input: { gatewayPaymentId?: unknown }): CheckoutHttpResult;
  createCount(): CheckoutHttpResult;
};

export function checkoutJsonResponse(result: CheckoutHttpResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function readRequestJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim().length === 0) return {};
  return JSON.parse(text) as unknown;
}

export function createPaymentInputFromUnknown(value: unknown): CreateOrderPaymentInput {
  if (value === null || typeof value !== "object") return {};
  const rec = value as Record<string, unknown>;
  const input: CreateOrderPaymentInput = {};
  if (typeof rec.orderId === "string") input.orderId = rec.orderId;
  return input;
}

export function gatewayPaymentIdFromUnknown(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const gatewayPaymentId = (value as { gatewayPaymentId?: unknown }).gatewayPaymentId;
  return typeof gatewayPaymentId === "string" ? gatewayPaymentId : undefined;
}

function testHookDisabled(): CheckoutHttpResult {
  return { status: 404, body: { error: "not_found" } };
}

/**
 * Shared route helpers so Hono/Elysia stay thin.
 * Webhook callers must pass the **raw** body text (do not JSON.parse first).
 *
 * `/internal/reconcile`, `/internal/provider-paid`, and `/internal/create-count`
 * are test hooks. They are unauthenticated — do not deploy them. Pass
 * `{ enableTestHooks: true }` only in local tests.
 */
export function createCheckoutHandlers(
  kernel: CheckoutKernel,
  options: CheckoutHttpOptions = {},
): CheckoutHandlers {
  const enableTestHooks = options.enableTestHooks === true;
  return {
    createPayment(input) {
      return kernel.createOrderPayment(input ?? {});
    },
    handleStripeWebhook(rawBody, signature) {
      return kernel.handleStripeWebhook(rawBody, signature);
    },
    async reconcile() {
      // Test hook only — unauthenticated. Do not deploy this route.
      if (!enableTestHooks) return testHookDisabled();
      return kernel.reconcileDue();
    },
    getOrder(orderId) {
      const order = kernel.getOrder(orderId);
      if (!order) {
        return { status: 404, body: { error: "not_found" } };
      }
      return { status: 200, body: order };
    },
    providerPaid(input) {
      // Test hook only — unauthenticated. Do not deploy this route.
      if (!enableTestHooks) return testHookDisabled();
      if (typeof input.gatewayPaymentId !== "string") {
        return { status: 400, body: { error: "gatewayPaymentId required" } };
      }
      return kernel.markProviderPaid(input.gatewayPaymentId);
    },
    createCount() {
      // Test hook only — unauthenticated. Do not deploy this route.
      if (!enableTestHooks) return testHookDisabled();
      return { status: 200, body: { count: kernel.createPaymentCount() } };
    },
  };
}

export async function dispatchCheckoutRequest(
  kernel: CheckoutKernel,
  req: Request,
  options: CheckoutHttpOptions = {},
): Promise<Response> {
  const handlers = createCheckoutHandlers(kernel, options);
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  try {
    if (method === "POST" && path === "/payments") {
      const input = createPaymentInputFromUnknown(await readRequestJson(req));
      return checkoutJsonResponse(await handlers.createPayment(input));
    }
    if (method === "POST" && path === "/webhooks/stripe") {
      const rawBody = await req.text();
      const signature =
        req.headers.get("stripe-signature") ?? req.headers.get("Stripe-Signature");
      return checkoutJsonResponse(await handlers.handleStripeWebhook(rawBody, signature));
    }
    // Test hook only — unauthenticated. Do not deploy this route.
    if (method === "POST" && path === "/internal/reconcile") {
      return checkoutJsonResponse(await handlers.reconcile());
    }
    // Test hook only — unauthenticated. Do not deploy this route.
    if (method === "GET" && path === "/internal/create-count") {
      return checkoutJsonResponse(handlers.createCount());
    }
    // Test hook only — unauthenticated. Do not deploy this route.
    if (method === "POST" && path === "/internal/provider-paid") {
      const gatewayPaymentId = gatewayPaymentIdFromUnknown(await readRequestJson(req));
      return checkoutJsonResponse(
        gatewayPaymentId === undefined
          ? handlers.providerPaid({})
          : handlers.providerPaid({ gatewayPaymentId }),
      );
    }
    if (method === "GET" && path.startsWith("/orders/")) {
      const orderId = decodeURIComponent(path.slice("/orders/".length));
      return checkoutJsonResponse(handlers.getOrder(orderId));
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      return checkoutJsonResponse({ status: 400, body: { error: "invalid_json" } });
    }
    throw err;
  }

  return checkoutJsonResponse({ status: 404, body: { error: "not_found" } });
}

export function createCheckoutFetchApp(
  kernel: CheckoutKernel,
  options: CheckoutHttpOptions = {},
): CheckoutFetchApp {
  return {
    fetch(req: Request): Promise<Response> {
      return dispatchCheckoutRequest(kernel, req, options);
    },
  };
}
