import {
  createPaymentClient,
  isMoney,
  NetworkError,
  money,
  stripeGateway,
  type Clock,
  type CreatePaymentParams,
  type GatewayAdapter,
  type GatewayPaymentResult,
  type Money,
  type PaymentStatus,
  type PaymentGateway,
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
  type WebhookInboxEngine,
  type WebhookHandler,
} from "@paykernel/webhooks";
import {
  createBunSqliteStoresInMemory,
  migrateSqliteAdapter,
} from "@paykernel/store-sqlite/bun";
import {
  createSqliteStores,
  type SqliteExecutor,
  type SqliteStoresBundle,
} from "@paykernel/store-sqlite";
import { processWebhookHttp, type WebhookClient } from "@paykernel/integration-http";
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

/**
 * Provider recon snapshot from `getPayment` Money only (1.0 fail-closed).
 * Incomplete money (Money without currency) fails closed; legacy number
 * major units are not accepted — return undefined so caller schedules reconcile
 * instead of forging a snapshot.
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
  if (!isMoney(got.amount)) return undefined;
  const amount = got.amount as Money;
  const input: Parameters<typeof buildProviderPaymentSnapshot>[0] = {
    gatewayPaymentId: got.gatewayId,
    status: got.status as unknown as PaymentStatus,
    amount,
    providerStatus: got.status,
  };
  if (got.capturedAmount !== undefined) {
    if (!isMoney(got.capturedAmount)) return undefined;
    input.capturedAmount = got.capturedAmount as Money;
  }
  if (got.refundedAmount !== undefined) {
    if (!isMoney(got.refundedAmount)) return undefined;
    input.refundedAmount = got.refundedAmount as Money;
  }
  return buildProviderPaymentSnapshot(input);
}


/** Bundle shape injected into the checkout kernel (SqliteStoresBundle + optional close). */
export type CheckoutStoresBundle = SqliteStoresBundle & {
  close?: () => void;
};

/** Factory that produces a stores bundle from the kernel clock. */
export type CheckoutStoreFactory = (
  clock: Clock,
) => CheckoutStoresBundle | Promise<CheckoutStoresBundle>;

export type CreateCheckoutKernelOptions = {
  /** FIFO mock `createPayment` outcomes (scripted). */
  scriptCreate?: readonly ScriptedPaymentOutcome[];
  /** FIFO mock `getPayment` outcomes (scripted). */
  scriptGet?: readonly ScriptedPaymentOutcome[];
  /** Throw in the inbox fulfill handler before marking the order paid. */
  fulfillThrows?: boolean;
  clock?: Clock;
  /** Optional SQLite executor to build stores from (e.g., Node/D1). If `stores` or `storeFactory` is set this is ignored. */
  executor?: SqliteExecutor;
  /** Optional pre-built stores bundle (e.g., D1/DO). When provided, its `executor` is migrated if present. */
  stores?: CheckoutStoresBundle;
  /** Optional factory producing a stores bundle from the resolved clock. Precedence: storeFactory > stores > executor > in-memory Bun SQLite. */
  storeFactory?: CheckoutStoreFactory;
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
  /** Webhook composition for framework adapters — do not export secrets. */
  webhook: {
    gateway: "stripe";
    client: WebhookClient;
    engine: WebhookInboxEngine;
    handler: WebhookHandler;
  };
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


function jsonError(status: number, error: string): CheckoutHttpResult {
  return { status, body: { error } };
}

/**
 * In-memory Bun SQLite checkout kernel.
 * Migrates explicitly; injects one clock into Stripe runtime, stores, and inbox.
 *
 * WEBHOOKS-2: `client` is created with **no `onWebhookVerified` hooks** —
 * fulfillment belongs only in the inbox `handler` after claim (see
 * `webhookHandler` below and `docs/getting-started.md` “Never fulfill in
 * onWebhookVerified”). The kernel exposes `webhook.client`/`engine`/`handler`
 * for `processWebhookHttp`-style composition, not direct `handleWebhook` with
 * fulfillment hooks.
 */
export async function createCheckoutKernel(
  options: CreateCheckoutKernelOptions = {},
): Promise<CheckoutKernel> {
  const clock = options.clock ?? systemClock();
  const fulfillThrows = options.fulfillThrows === true;

  let stores: CheckoutStoresBundle;
  let storesClose: (() => void) | undefined;
  if (options.storeFactory) {
    const produced = await options.storeFactory(clock);
    stores = produced;
    if (typeof produced.close === "function") {
      storesClose = produced.close.bind(produced);
    }
  } else if (options.stores) {
    stores = options.stores;
    if (typeof options.stores.close === "function") {
      storesClose = options.stores.close.bind(options.stores);
    }
  } else if (options.executor) {
    stores = createSqliteStores({ executor: options.executor, clock }) as CheckoutStoresBundle;
    storesClose = undefined;
  } else {
    const mem = createBunSqliteStoresInMemory({ clock });
    stores = mem as CheckoutStoresBundle;
    storesClose = mem.close.bind(mem);
  }
  if (stores.executor) {
    try {
      await migrateSqliteAdapter(stores.executor);
    } catch (err) {
      if (storesClose) {
        try {
          storesClose();
        } catch {
          // ignore close error during migrate failure
        }
      }
      throw err;
    }
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

  // WEBHOOKS-2: no onWebhookVerified hooks — fulfillment only in webhookHandler after inbox claim.
  // See docs/getting-started.md “Never fulfill in onWebhookVerified”.
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

  const webhookHandler: WebhookHandler = async (ctx) => {
    if (fulfillThrows) {
      throw new Error("checkout kernel fulfillThrows");
    }
    if (!isPaidFulfillmentEvent(ctx.event)) return;
    // Extract gatewayPaymentId from PaymentEvent payment.references.providerObjectId
    let gatewayPaymentId: string | undefined;
    if (ctx.event !== null && typeof ctx.event === "object" && "payment" in ctx.event) {
      const payment = (ctx.event as { payment?: unknown }).payment;
      if (payment !== null && typeof payment === "object" && "references" in payment) {
        const refs = (payment as { references?: unknown }).references;
        if (refs !== null && typeof refs === "object" && "providerObjectId" in refs) {
          const id = (refs as { providerObjectId?: unknown }).providerObjectId;
          if (typeof id === "string" && id.length > 0) gatewayPaymentId = id;
        }
      }
    }
    // Fallback to direct gatewayPaymentId if PaymentEvent was wrapped as WebhookEvent
    if (!gatewayPaymentId && ctx.event !== null && typeof ctx.event === "object" && "gatewayPaymentId" in ctx.event) {
      const v = (ctx.event as { gatewayPaymentId?: unknown }).gatewayPaymentId;
      if (typeof v === "string" && v.length > 0) gatewayPaymentId = v;
    }
    if (!gatewayPaymentId) return;

    const byGw = findByGatewayPaymentId(gatewayPaymentId);
    if (byGw) {
      fulfill(byGw, gatewayPaymentId);
      return;
    }

    // Fallback via internalReference (orderId)
    let internalRef: string | undefined;
    if (ctx.event !== null && typeof ctx.event === "object" && "payment" in ctx.event) {
      const payment = (ctx.event as { payment?: unknown }).payment;
      if (payment !== null && typeof payment === "object" && "references" in payment) {
        const refs = (payment as { references?: unknown }).references;
        if (refs !== null && typeof refs === "object" && "internalReference" in refs) {
          const r = (refs as { internalReference?: unknown }).internalReference;
          if (typeof r === "string" && r.length > 0) internalRef = r;
        }
      }
    }
    if (!internalRef) {
      internalRef = eventInternalReference(ctx.event);
    }
    if (internalRef) {
      const candidate = orders.get(internalRef);
      if (candidate) {
        if (candidate.gatewayPaymentId === undefined) {
          fulfill(candidate, gatewayPaymentId);
          return;
        }
        if (candidate.gatewayPaymentId === gatewayPaymentId) {
          fulfill(candidate);
          return;
        }
        return;
      }
    }

    throw new Error("no local order for paid webhook");
  };

  async function handleStripeWebhook(
    rawBody: string,
    signature: string | null,
  ): Promise<CheckoutHttpResult> {
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody,
      headers: signature ? { "stripe-signature": signature } : {},
      client,
      engine,
      handler: webhookHandler,
      ackPolicy: { kind: "provider_redelivery" },
    });
    // Adapt WebhookHttpResult to CheckoutHttpResult, preserving retry-after and x-request-id
    if ("error" in result.body) {
      return { status: result.status, headers: result.headers, body: { error: result.body.error } };
    }
    if (result.body.reason !== undefined) {
      return { status: result.status, headers: result.headers, body: { outcome: result.body.outcome, reason: result.body.reason } };
    }
    if (result.body.retryable !== undefined) {
      return { status: result.status, headers: result.headers, body: { outcome: result.body.outcome, retryable: result.body.retryable } };
    }
    return { status: result.status, headers: result.headers, body: { outcome: result.body.outcome } };
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
    if (storesClose) {
      try {
        storesClose();
      } catch {
        // ignore close error
      }
      return;
    }
    if (typeof stores.close === "function") {
      try {
        stores.close();
      } catch {
        // ignore
      }
    }
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
    webhook: {
      gateway: "stripe" as const,
      client: client as unknown as WebhookClient,
      engine,
      handler: webhookHandler,
    },
  };
}
