import {
  createPaymentClient,
  InvalidWebhookError,
  NetworkError,
  money,
  stripeGateway,
  type Clock,
  type CreatePaymentParams,
  type GatewayAdapter,
  type GatewayPaymentResult,
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
/** Server catalog price. Never charge client-posted amounts. */
const CATALOG_AMOUNT = money(DEFAULT_AMOUNT, DEFAULT_CURRENCY);
const CALLBACK_URL = "https://example.invalid/callback";
const STRIPE_SECRET_KEY = "sk_test_example_not_live";
const CHARGE_GATEWAY = "mock";

function publishableCurrency(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function moneyFromMajorUnits(
  amount: number | undefined,
  currency: string | undefined,
): Money | undefined {
  if (amount === undefined || !Number.isFinite(amount)) return undefined;
  if (currency === undefined) return undefined;
  try {
    return money(amount, currency);
  } catch {
    return undefined;
  }
}

/**
 * Provider recon snapshot from `getPayment` money only.
 * Incomplete major-unit fields (amount without currency) fail closed.
 */
function providerSnapshotFromGetPayment(
  got: GatewayPaymentResult,
): ProviderPaymentSnapshot | undefined {
  if (!got.gatewayId) return undefined;
  const currency = publishableCurrency(got.currency);
  const hasAmountLike =
    got.amount !== undefined ||
    got.capturedAmount !== undefined ||
    got.refundedAmount !== undefined;
  if (hasAmountLike && currency === undefined) {
    return undefined;
  }
  const amount = moneyFromMajorUnits(got.amount, currency);
  if (amount === undefined) {
    return undefined;
  }
  const input: Parameters<typeof buildProviderPaymentSnapshot>[0] = {
    gatewayPaymentId: got.gatewayId,
    status: got.status,
    amount,
    providerStatus: got.status,
  };
  if (got.capturedAmount !== undefined) {
    const captured = moneyFromMajorUnits(got.capturedAmount, currency);
    if (captured === undefined) return undefined;
    input.capturedAmount = captured;
  }
  if (got.refundedAmount !== undefined) {
    const refunded = moneyFromMajorUnits(got.refundedAmount, currency);
    if (refunded === undefined) return undefined;
    input.refundedAmount = refunded;
  }
  return buildProviderPaymentSnapshot(input);
}

export type CreateCheckoutKernelOptions = {
  /** FIFO mock `createPayment` outcomes (scripted). */
  scriptCreate?: readonly ScriptedPaymentOutcome[];
  /** FIFO mock `getPayment` outcomes (scripted). */
  scriptGet?: readonly ScriptedPaymentOutcome[];
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
  /** Test hook: inject a paid provider snapshot. Not a production API. */
  markProviderPaid(gatewayPaymentId: string): CheckoutHttpResult;
  /** Test hook: process due recon jobs. Not a production API. */
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
    mockOptions.createPayment = [...options.scriptCreate];
  }
  if (options.scriptGet !== undefined) {
    mockOptions.getPayment = [...options.scriptGet];
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
    const gatewayPaymentId = order.gatewayPaymentId;
    // Never bind mock.getLastProviderSideSuccess() — that id may belong to another order.
    if (gatewayPaymentId === undefined) {
      return { kind: "unavailable" };
    }
    const override = providerOverrides.get(gatewayPaymentId);
    if (override) return { kind: "found", snapshots: [override] };
    try {
      const got = await client.getPayment({ gatewayPaymentId }, order.gateway);
      const snapshot = providerSnapshotFromGetPayment(got);
      if (snapshot) {
        return { kind: "found", snapshots: [snapshot] };
      }
      if (!got.gatewayId) {
        return { kind: "not_found" };
      }
      return { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    }
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

  function eventInternalReference(event: unknown): string | undefined {
    if (event === null || typeof event !== "object" || !("payment" in event)) {
      return undefined;
    }
    const payment = (event as { payment?: { references?: { internalReference?: string } } })
      .payment;
    const ref = payment?.references?.internalReference;
    return typeof ref === "string" && ref.length > 0 ? ref : undefined;
  }

  type OrderForPaidWebhook =
    | { kind: "ok"; order: CheckoutOrderRecord }
    | { kind: "mismatch" }
    | { kind: "missing" };

  /**
   * Bind webhook PI first, then match. Metadata orderId alone must not
   * fulfill a mock-charged order whose stored gatewayPaymentId differs.
   */
  function findOrderForEvent(
    webhookEvent: WebhookEvent,
    event: unknown,
  ): OrderForPaidWebhook {
    const webhookPi =
      typeof webhookEvent.gatewayPaymentId === "string" &&
      webhookEvent.gatewayPaymentId.length > 0
        ? webhookEvent.gatewayPaymentId
        : undefined;
    if (webhookPi === undefined) {
      return { kind: "missing" };
    }

    const byGw = findByGatewayPaymentId(webhookPi);
    if (byGw) {
      return { kind: "ok", order: byGw };
    }

    const candidates: CheckoutOrderRecord[] = [];
    const seen = new Set<string>();
    const add = (row: CheckoutOrderRecord | undefined): void => {
      if (row && !seen.has(row.orderId)) {
        seen.add(row.orderId);
        candidates.push(row);
      }
    };
    if (webhookEvent.paymentId) add(orders.get(webhookEvent.paymentId));
    const fromMeta = metadataOrderId(webhookEvent.rawPayload);
    if (fromMeta) add(orders.get(fromMeta));
    const fromRef = eventInternalReference(event);
    if (fromRef) add(orders.get(fromRef));

    let sawMismatch = false;
    for (const candidate of candidates) {
      if (candidate.gatewayPaymentId === undefined) {
        return { kind: "ok", order: candidate };
      }
      if (candidate.gatewayPaymentId === webhookPi) {
        return { kind: "ok", order: candidate };
      }
      sawMismatch = true;
    }
    if (sawMismatch) return { kind: "mismatch" };
    return { kind: "missing" };
  }

  function fulfill(order: CheckoutOrderRecord, gatewayPaymentId?: string): void {
    if (fulfillThrows) {
      throw new Error("checkout kernel fulfillThrows");
    }
    if (gatewayPaymentId !== undefined && gatewayPaymentId.length > 0) {
      if (order.gatewayPaymentId === undefined) {
        rememberGatewayPaymentId(order, gatewayPaymentId);
      } else if (order.gatewayPaymentId !== gatewayPaymentId) {
        return;
      }
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
    const amount = CATALOG_AMOUNT;
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
      // Tagged or not: NetworkError is uncertain — keep the order and schedule recon.
      // Never attach getLastProviderSideSuccess() (may be another order). Never leak err.message.
      if (err instanceof NetworkError) {
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
      return jsonError(500, "create_failed");
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
        const webhookPi = webhookEvent.gatewayPaymentId;
        if (typeof webhookPi !== "string" || webhookPi.length === 0) {
          return;
        }
        const found = findOrderForEvent(webhookEvent, ctx.event);
        if (found.kind === "mismatch") return;
        if (found.kind === "missing") {
          throw new Error("no local order for paid webhook");
        }
        fulfill(found.order, webhookPi);
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

  /** Test hook: inject a paid provider snapshot. Not a production API. */
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

  /** Test hook: process due recon jobs. Not a production API. */
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
