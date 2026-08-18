import {
  createPaymentClient,
  InvalidRequestError,
  InvalidWebhookError,
  NetworkError,
  money,
  stripeGateway,
  type Clock,
  type CreatePaymentParams,
  type GatewayAdapter,
  type Money,
  type PaymentGateway,
  type WebhookEvent,
} from "@paykernel/core";
import {
  buildLocalPaymentSnapshot,
  buildProviderPaymentSnapshot,
  buildReconciliationTarget,
  createPaymentReconciler,
  createReconciliationScheduler,
  decideReconciliationPolicy,
  type LookupOutcome,
  type ProviderLookupPort,
  type ProviderPaymentSnapshot,
  type ReconciliationScheduler,
  type ReconciliationTarget,
} from "@paykernel/reconciliation";
import { mockGateway, type ScriptedPaymentOutcome } from "@paykernel/testkit";
import {
  createWebhookInboxEngine,
  resolveInboxPayloadHash,
  type ProcessVerifiedInput,
  type WebhookInboxEngine,
} from "@paykernel/webhooks";
import {
  createBunSqliteStoresInMemory,
  migrateSqliteAdapter,
} from "@paykernel/store-sqlite/bun";
import { mapInboxOutcome } from "./http-policy";
import { CHECKOUT_STRIPE_WEBHOOK_SECRET } from "./stripe-webhook";
import type {
  CheckoutHttpResult,
  CheckoutOrder,
  CheckoutOrderRecord,
  CreateOrderPaymentInput,
} from "./types";

const DEFAULT_AMOUNT = "10.00";
const DEFAULT_CURRENCY = "USD";
const CALLBACK_URL = "https://example.invalid/callback";
const STRIPE_SECRET_KEY = "sk_test_example_not_live";
const CHARGE_GATEWAY = "mock";

export type CreateCheckoutKernelOptions = {
  /** FIFO mock `createPayment` outcomes (scripted). */
  scriptCreate?: ScriptedPaymentOutcome[];
  /** Throw in the inbox fulfill handler before marking the order paid. */
  fulfillThrows?: boolean;
  clock?: Clock;
};

export type CheckoutKernel = {
  readonly clock: Clock;
  createPaymentCount(): number;
  getOrder(orderId: string): CheckoutOrder | undefined;
  createOrderPayment(input?: CreateOrderPaymentInput): Promise<CheckoutHttpResult>;
  handleStripeWebhook(
    rawBody: string,
    signature: string | null,
  ): Promise<CheckoutHttpResult>;
  markProviderPaid(gatewayPaymentId: string): CheckoutHttpResult;
  reconcileDue(): Promise<CheckoutHttpResult>;
  close(): void;
};

function systemClock(): Clock {
  return {
    now: () => new Date(),
    nowMs: () => Date.now(),
  };
}

function publicOrder(order: CheckoutOrderRecord): CheckoutOrder {
  const out: CheckoutOrder = {
    orderId: order.orderId,
    status: order.status,
    fulfillCount: order.fulfillCount,
  };
  if (order.gatewayPaymentId !== undefined) {
    out.gatewayPaymentId = order.gatewayPaymentId;
  }
  return out;
}

function isPaidFulfillmentEvent(event: unknown): boolean {
  if (event === null || typeof event !== "object") return false;
  const rec = event as { type?: unknown; payment?: { status?: unknown } };
  return (
    (rec.type === "payment.succeeded" || rec.type === "capture.completed") &&
    rec.payment?.status === "paid"
  );
}

function metadataOrderId(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const data = (raw as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return undefined;
  const object = (data as { object?: unknown }).object;
  if (object === null || typeof object !== "object") return undefined;
  const metadata = (object as { metadata?: unknown }).metadata;
  if (metadata === null || typeof metadata !== "object") return undefined;
  const bag = metadata as Record<string, unknown>;
  if (typeof bag.orderId === "string" && bag.orderId.length > 0) {
    return bag.orderId;
  }
  if (typeof bag.paymentId === "string" && bag.paymentId.length > 0) {
    return bag.paymentId;
  }
  return undefined;
}

function jsonError(status: number, error: string): CheckoutHttpResult {
  return { status, body: { error } };
}

/**
 * In-memory Bun SQLite checkout kernel.
 * Migrates explicitly; injects one clock into Stripe runtime, stores, and inbox.
 */
export async function createCheckoutKernel(
  options: CreateCheckoutKernelOptions = {},
): Promise<CheckoutKernel> {
  const clock = options.clock ?? systemClock();
  const fulfillThrows = options.fulfillThrows === true;

  const stores = createBunSqliteStoresInMemory({ clock });
  try {
    await migrateSqliteAdapter(stores.executor);
  } catch (err) {
    stores.close();
    throw err;
  }

  const mockOptions: Parameters<typeof mockGateway>[0] = {
    name: "mock",
    clock,
  };
  if (options.scriptCreate !== undefined) {
    mockOptions.createPayment = options.scriptCreate;
  }
  const mock = mockGateway(mockOptions);

  const mockAdapter: GatewayAdapter<"mock", PaymentGateway<"mock">> = {
    name: "mock",
    manifest: { name: "mock" },
    create: () => mock as PaymentGateway<"mock">,
  };

  const client = createPaymentClient({
    gateways: {
      mock: mockAdapter,
      stripe: stripeGateway({
        secretKey: STRIPE_SECRET_KEY,
        webhookSecret: CHECKOUT_STRIPE_WEBHOOK_SECRET,
      }),
    },
    defaultGateway: "mock",
    runtime: { clock },
  });

  const engine: WebhookInboxEngine = createWebhookInboxEngine({
    store: stores.webhookInbox,
    mode: "inline",
    clock,
  });

  const scheduler: ReconciliationScheduler = createReconciliationScheduler({
    store: stores.reconciliation,
    clock,
  });

  const orders = new Map<string, CheckoutOrderRecord>();
  const byGatewayPaymentId = new Map<string, CheckoutOrderRecord>();
  const providerOverrides = new Map<string, ProviderPaymentSnapshot>();
  let orderSeq = 0;
  let closed = false;

  function findByGatewayPaymentId(
    gatewayPaymentId: string,
  ): CheckoutOrderRecord | undefined {
    return byGatewayPaymentId.get(gatewayPaymentId);
  }

  function rememberGatewayPaymentId(
    order: CheckoutOrderRecord,
    gatewayPaymentId: string,
  ): void {
    order.gatewayPaymentId = gatewayPaymentId;
    byGatewayPaymentId.set(gatewayPaymentId, order);
  }

  async function snapshotForOrder(order: CheckoutOrderRecord): Promise<LookupOutcome> {
    if (order.gatewayPaymentId !== undefined) {
      const override = providerOverrides.get(order.gatewayPaymentId);
      if (override) return { kind: "found", snapshots: [override] };
      try {
        const got = await client.getPayment(
          { gatewayPaymentId: order.gatewayPaymentId },
          order.gateway,
        );
        if (got.gatewayId) {
          return {
            kind: "found",
            snapshots: [
              buildProviderPaymentSnapshot({
                gatewayPaymentId: got.gatewayId,
                status: got.status,
                amount: order.amount,
                providerStatus: got.status,
              }),
            ],
          };
        }
      } catch {
        return { kind: "unavailable" };
      }
    }

    const providerSide = mock.getLastProviderSideSuccess();
    if (providerSide?.gatewayId) {
      rememberGatewayPaymentId(order, providerSide.gatewayId);
      return {
        kind: "found",
        snapshots: [
          buildProviderPaymentSnapshot({
            gatewayPaymentId: providerSide.gatewayId,
            status: providerSide.status,
            amount: order.amount,
            providerStatus: providerSide.status,
          }),
        ],
      };
    }

    return { kind: "not_found" };
  }

  const lookup: ProviderLookupPort = {
    async findByPaymentId(_gateway, id) {
      const override = providerOverrides.get(id);
      if (override) return { kind: "found", snapshots: [override] };
      const order = findByGatewayPaymentId(id);
      if (!order) return { kind: "not_found" };
      return snapshotForOrder(order);
    },
    async findByIdempotencyKey(_gateway, key) {
      for (const order of orders.values()) {
        if (order.idempotencyKey === key) return snapshotForOrder(order);
      }
      return { kind: "not_found" };
    },
    async findByLocalReference(_gateway, ref) {
      const order = orders.get(ref);
      if (!order) return { kind: "not_found" };
      return snapshotForOrder(order);
    },
  };

  const reconciler = createPaymentReconciler({ lookup });

  function trustedAmount(input?: CreateOrderPaymentInput): Money {
    const amount = input?.amount ?? DEFAULT_AMOUNT;
    const currency = input?.currency ?? DEFAULT_CURRENCY;
    return money(amount, currency);
  }

  function nextOrderId(): string {
    orderSeq += 1;
    return `order_checkout_${orderSeq}`;
  }

  function createPaymentCount(): number {
    return mock.history.filter((row) => row.operation === "createPayment").length;
  }

  function getOrder(orderId: string): CheckoutOrder | undefined {
    const row = orders.get(orderId);
    return row ? publicOrder(row) : undefined;
  }

  function findOrderForEvent(
    webhookEvent: WebhookEvent,
    event: unknown,
  ): CheckoutOrderRecord | undefined {
    if (webhookEvent.paymentId) {
      const byPaymentId = orders.get(webhookEvent.paymentId);
      if (byPaymentId) return byPaymentId;
    }
    const fromMeta = metadataOrderId(webhookEvent.rawPayload);
    if (fromMeta) {
      const byMeta = orders.get(fromMeta);
      if (byMeta) return byMeta;
    }
    if (webhookEvent.gatewayPaymentId) {
      const byGw = findByGatewayPaymentId(webhookEvent.gatewayPaymentId);
      if (byGw) return byGw;
    }
    if (event !== null && typeof event === "object" && "payment" in event) {
      const payment = (event as { payment?: { references?: { internalReference?: string } } })
        .payment;
      const ref = payment?.references?.internalReference;
      if (ref) {
        const byRef = orders.get(ref);
        if (byRef) return byRef;
      }
    }
    return undefined;
  }

  function fulfill(order: CheckoutOrderRecord): void {
    if (fulfillThrows) {
      throw new Error("checkout kernel fulfillThrows");
    }
    if (order.status === "paid") return;
    order.status = "paid";
    order.fulfillCount += 1;
  }

  function rebuildTarget(order: CheckoutOrderRecord): ReconciliationTarget {
    const expectedInput: Parameters<typeof buildLocalPaymentSnapshot>[0] = {
      status:
        order.status === "paid" ? "paid" : order.status === "failed" ? "failed" : "processing",
      amount: order.amount,
    };
    if (order.gatewayPaymentId !== undefined) {
      expectedInput.gatewayPaymentId = order.gatewayPaymentId;
    }
    const targetInput: Parameters<typeof buildReconciliationTarget>[0] = {
      gateway: order.gateway,
      localReference: order.orderId,
      idempotencyKey: order.idempotencyKey,
      expected: buildLocalPaymentSnapshot(expectedInput),
    };
    if (order.gatewayPaymentId !== undefined) {
      targetInput.gatewayPaymentId = order.gatewayPaymentId;
    }
    return buildReconciliationTarget(targetInput);
  }

  async function scheduleIndeterminate(order: CheckoutOrderRecord): Promise<void> {
    await scheduler.schedule({
      target: rebuildTarget(order),
      runAt: new Date(clock.nowMs()).toISOString(),
      reason: "indeterminate_create",
    });
  }

  function orderFromSubject(subjectId: string): CheckoutOrderRecord | undefined {
    return findByGatewayPaymentId(subjectId) ?? orders.get(subjectId);
  }

  async function createOrderPayment(
    input: CreateOrderPaymentInput = {},
  ): Promise<CheckoutHttpResult> {
    let amount: Money;
    try {
      amount = trustedAmount(input);
    } catch (err) {
      if (err instanceof InvalidRequestError) {
        return jsonError(400, "invalid_amount");
      }
      throw err;
    }
    const orderId = input.orderId ?? nextOrderId();
    if (orders.has(orderId)) {
      return jsonError(409, "order_exists");
    }

    const order: CheckoutOrderRecord = {
      orderId,
      status: "unpaid",
      fulfillCount: 0,
      amount,
      gateway: CHARGE_GATEWAY,
      idempotencyKey: orderId,
    };
    orders.set(orderId, order);

    const params: CreatePaymentParams = {
      amount,
      currency: amount.currency,
      orderId,
      callbackUrl: CALLBACK_URL,
      idempotencyKey: orderId,
      metadata: { orderId },
    };

    let result;
    try {
      result = await client.createPayment(params);
    } catch (err) {
      const providerSide = mock.getLastProviderSideSuccess();
      const submitted =
        err instanceof NetworkError &&
        (err.afterProviderSubmit || providerSide !== undefined);
      if (submitted) {
        if (providerSide?.gatewayId) {
          rememberGatewayPaymentId(order, providerSide.gatewayId);
        }
        await scheduleIndeterminate(order);
        return {
          status: 200,
          body: {
            ...publicOrder(order),
            outcome: "indeterminate",
            reconciliationRequired: true,
          },
        };
      }
      orders.delete(orderId);
      const message = err instanceof Error ? err.message : String(err);
      return jsonError(500, message);
    }

    if (result.gatewayId) {
      rememberGatewayPaymentId(order, result.gatewayId);
    }

    if (result.outcome === "indeterminate" || result.reconciliationRequired === true) {
      await scheduleIndeterminate(order);
    }

    const body: Record<string, unknown> = {
      ...publicOrder(order),
    };
    if (result.outcome !== undefined) body.outcome = result.outcome;
    if (result.reconciliationRequired !== undefined) {
      body.reconciliationRequired = result.reconciliationRequired;
    }
    if (result.status !== undefined) body.paymentStatus = result.status;
    return { status: 200, body };
  }

  async function handleStripeWebhook(
    rawBody: string,
    signature: string | null,
  ): Promise<CheckoutHttpResult> {
    if (signature === null || signature.length === 0) {
      return jsonError(400, "invalid_webhook");
    }

    let webhookEvent: WebhookEvent;
    try {
      webhookEvent = await client.handleWebhook("stripe", rawBody, signature);
    } catch (err) {
      if (err instanceof InvalidWebhookError) {
        return jsonError(400, "invalid_webhook");
      }
      throw err;
    }

    const hashInput: Parameters<typeof resolveInboxPayloadHash>[0] = {};
    if (webhookEvent.payloadHash !== undefined && webhookEvent.payloadHash.length > 0) {
      hashInput.eventPayloadHash = webhookEvent.payloadHash;
    } else {
      hashInput.payloadForHash = webhookEvent.rawPayload ?? webhookEvent;
    }

    const processInput: ProcessVerifiedInput = {
      gateway: "stripe",
      providerEventId: webhookEvent.id,
      payloadHash: resolveInboxPayloadHash(hashInput),
      handler: async (ctx) => {
        if (!isPaidFulfillmentEvent(ctx.event)) return;
        const order = findOrderForEvent(webhookEvent, ctx.event);
        if (!order) {
          throw new Error("no local order for paid webhook");
        }
        fulfill(order);
      },
    };
    if (webhookEvent.event !== undefined) {
      processInput.event = webhookEvent.event;
    } else {
      processInput.event = webhookEvent;
    }

    const outcome = await engine.processVerified(processInput);
    return {
      status: mapInboxOutcome(outcome),
      body: { outcome: outcome.outcome },
    };
  }

  function markProviderPaid(gatewayPaymentId: string): CheckoutHttpResult {
    if (gatewayPaymentId.length === 0) {
      return jsonError(400, "gatewayPaymentId required");
    }
    const order = findByGatewayPaymentId(gatewayPaymentId);
    if (!order) {
      return jsonError(404, "order not found");
    }
    providerOverrides.set(
      gatewayPaymentId,
      buildProviderPaymentSnapshot({
        gatewayPaymentId,
        status: "paid",
        amount: order.amount,
        providerStatus: "paid",
      }),
    );
    return { status: 200, body: { ok: true, gatewayPaymentId } };
  }

  async function reconcileDue(): Promise<CheckoutHttpResult> {
    const result = await scheduler.processDue({
      handler: async (job) => {
        const order = orderFromSubject(job.record.subjectId);
        if (!order) {
          return { disposition: "manual_review", note: "order_not_found" };
        }
        const target = rebuildTarget(order);
        const recon = await reconciler.reconcile(target);
        const decision = decideReconciliationPolicy(recon, target);

        if (decision.action === "mark_consistent" && decision.safe) {
          return { disposition: "complete" };
        }
        if (decision.action === "update_local_to_paid" && decision.safe) {
          fulfill(order);
          return { disposition: "complete" };
        }
        if (decision.action === "update_local_to_failed" && decision.safe) {
          order.status = "failed";
          return { disposition: "complete" };
        }
        if (decision.action === "retry_later") {
          if (decision.retryAfterMs !== undefined) {
            return { disposition: "retry_later" as const, retryAfterMs: decision.retryAfterMs };
          }
          return { disposition: "retry_later" as const };
        }
        if (decision.action === "do_not_create_replacement") {
          return {
            disposition: "retry" as const,
            error: new Error(decision.reason),
          };
        }
        return { disposition: "manual_review" as const, note: decision.action };
      },
    });
    return { status: 200, body: result };
  }

  function close(): void {
    if (closed) return;
    closed = true;
    stores.close();
  }

  return {
    clock,
    createPaymentCount,
    getOrder,
    createOrderPayment,
    handleStripeWebhook,
    markProviderPaid,
    reconcileDue,
    close,
  };
}
