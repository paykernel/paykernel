import { InvalidWebhookError, createOperationContext, type OperationContext } from "@paykernel/core";
import { resolveInboxPayloadHash, type WebhookInboxEngine, type WebhookHandler, type WebhookProcessingOutcome } from "@paykernel/webhooks";
import { resolveCorrelationId } from "./headers";
import { mapInboxOutcome, retryAfterSeconds, type InboxHttpAckPolicy } from "./http-policy";
import { GATEWAY_WEBHOOK_SIGNATURE, extractWebhookSignature, type GatewayWebhookSignatureProfile } from "./signature";
import type { HeaderBag } from "./headers";

function hasBody(value: unknown): value is { body: unknown } {
  return typeof value === "object" && value !== null && "body" in value;
}

/**
 * Minimal webhook verifier surface accepted by {@link processWebhookHttp}.
 *
 * **WEBHOOKS-2 invariant — no fulfillment in `onWebhookVerified`:** `client`
 * MUST be a `PaymentClient` with **no `onWebhookVerified` fulfillment / money
 * side effects**. Verification can succeed before the inbox claim/lease, so a
 * hook that fulfills would run as `["verified_hook","inbox_handler"]` before
 * dedupe. Fulfillment belongs **only** in the `handler` passed to
 * `processWebhookHttp` (or `engine.processWithVerifier` / `processRetryable`)
 * after the inbox claim. See `docs/getting-started.md` “Never fulfill in
 * onWebhookVerified”. This type is intentionally structural to avoid a hard
 * `@paykernel/core` peer cycle, but at runtime the passed `client` SHOULD be
 * a `PaymentClient` created by `createPaymentClient` with no
 * `onWebhookVerified` hooks that mutate orders/inventory/payments (metrics-
 * only is allowed; even that will emit a `console.warn` via the inbox path).
 * If a runtime guard detects such hooks it MUST warn, not throw, to avoid
 * breaking existing callers.
 */
export type WebhookClient = {
  handleWebhook(
    gateway: string,
    payload: unknown,
    signatureOrHeaders?: string | Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<unknown>;
};
export type WebhookHttpResult = {
  status: number;
  headers: Record<string, string>;
  body: { outcome: string; reason?: string; retryable?: boolean } | { error: "invalid_webhook" };
};
export type ProcessWebhookHttpInput = {
  gateway: string;
  rawBody: string | Uint8Array;
  headers: HeaderBag;
  query?: Record<string, string | undefined>;
  /**
   * Verifier client — MUST be a `PaymentClient` with no `onWebhookVerified`
   * fulfillment. See {@link WebhookClient} and `docs/getting-started.md`
   * “Never fulfill in onWebhookVerified”. Fulfillment belongs only in
   * `handler` after the inbox claim/lease; the `verifyAndNormalize` path
   * must stay verify-only (WEBHOOKS-2). A warn-only runtime check may
   * `console.warn` if hooks are detected, but never throws.
   */
  client: WebhookClient;
  engine: WebhookInboxEngine;
  handler: WebhookHandler;
  ackPolicy?: InboxHttpAckPolicy;
  correlationId?: string;
  signatureProfile?: GatewayWebhookSignatureProfile;
};

export function webhookHttpResultToResponse(result: WebhookHttpResult): Response {
  const headers = new Headers();
  for (const [k, v] of Object.entries(result.headers)) {
    headers.set(k, v);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers,
  });
}

export function createWebhookOperationContext(input: {
  gateway: string;
  operationId: string;
  inboxEventKey?: string;
}): OperationContext {
  const ctx: Record<string, unknown> = {
    gateway: input.gateway,
    operationId: input.operationId,
    operationType: "payment.webhook.process",
  };
  if (input.inboxEventKey !== undefined) {
    ctx.inboxEventKey = input.inboxEventKey;
  }
  return createOperationContext(ctx as unknown as Parameters<typeof createOperationContext>[0]);
}

function toRawBodyString(rawBody: string | Uint8Array): string {
  if (typeof rawBody === "string") return rawBody;
  return new TextDecoder().decode(rawBody);
}
function headerBagToLowerRecord(headers: HeaderBag): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) {
      if (v.length > 0 && typeof v[0] === "string") out[k.toLowerCase()] = v[0]!;
    } else if (typeof v === "string") {
      out[k.toLowerCase()] = v;
    }
  }
  return out;
}
/**
 * Stripe/PayPal/MyFatoorah verify HMAC over the raw string/bytes — the
 * signature is computed from the exact byte payload sent by the provider.
 * Tap/Moyasar/Paymob verify HMAC over fields extracted from the parsed JSON
 * object — passing the raw string to their verifiers would always fail.
 *
 * ProcessWebhookHttp is gateway-agnostic and receives `rawBody` as
 * `string | Uint8Array` via `toRawBodyString`. For string-HMAC gateways we
 * keep the raw string byte-exact (Stripe needs exact bytes). For object-HMAC
 * gateways we defensively try to parse the raw string to an object/array and
 * pass the parsed value when valid; otherwise we fall back to the raw string
 * (fail-closed) so verification still runs and returns 400 rather than 500.
 * This makes both string-accepting and object-only gateway implementations
 * work regardless of fix ordering (Slice A vs Slice B).
 */
const OBJECT_HMAC_GATEWAYS: Record<string, true> = {
  tap: true,
  moyasar: true,
  paymob: true,
};

function maybeParsedBody(rawBodyString: string): unknown {
  try {
    const parsed = JSON.parse(rawBodyString);
    if (parsed !== null && typeof parsed === "object") return parsed;
  } catch {
    // Invalid JSON — fall back to raw string (verifier will fail-closed to 400)
  }
  return rawBodyString;
}
function hasOnWebhookVerifiedHook(client: WebhookClient): boolean {
  const anyClient = client as unknown as { hooksManager?: { hooks?: Record<string, unknown> } };
  return Boolean(anyClient.hooksManager?.hooks?.["onWebhookVerified"]);
}

/**
 * Verify a webhook via `client.handleWebhook` and claim/lease it via
 * `engine.processWithVerifier`. Maps engine outcomes to HTTP status via
 * `mapInboxOutcome`.
 *
 * **WEBHOOKS-2:** `input.client` MUST be a `PaymentClient` with **no
 * `onWebhookVerified` fulfillment**. Fulfillment belongs only in
 * `input.handler` after the inbox claim (see {@link WebhookClient} and
 * `docs/getting-started.md` “Never fulfill in onWebhookVerified”). The
 * `verifyAndNormalize` callback is verify-only; if a runtime check detects
 * `onWebhookVerified` hooks it will `console.warn` (never throw) so existing
 * callers keep working but operators see the invariant violation.
 *
 * **String vs object:** Stripe/PayPal/MyFatoorah HMAC over raw bytes; Tap/
 * Moyasar/Paymob HMAC over parsed fields — those verifiers accept string
 * payloads and parse internally, and this helper also parses rawBody for those
 * three gateways so both old and new gateway implementations verify.
 */
export async function processWebhookHttp(
  input: ProcessWebhookHttpInput,
): Promise<WebhookHttpResult> {
  const correlationId = input.correlationId ?? resolveCorrelationId(input.headers);
  const rawBodyString = toRawBodyString(input.rawBody);
  const ackPolicy: InboxHttpAckPolicy = input.ackPolicy ?? { kind: "provider_redelivery" };

  const profile =
    input.signatureProfile ?? GATEWAY_WEBHOOK_SIGNATURE[input.gateway.toLowerCase()];

  const extracted = extractWebhookSignature(
    input.gateway,
    input.headers,
    input.query,
    profile,
  );

  if (
    profile?.kind === "header" &&
    profile.required === true &&
    (extracted === undefined || (typeof extracted === "string" && extracted.length === 0))
  ) {
    return {
      status: 400,
      headers: { "x-request-id": correlationId },
      body: { error: "invalid_webhook" },
    };
  }

  let signatureOrHeaders: string | Record<string, string> | undefined;
  if (typeof extracted === "string") {
    signatureOrHeaders = extracted;
  } else if (extracted !== undefined && typeof extracted === "object") {
    signatureOrHeaders = extracted as Record<string, string>;
  } else {
    signatureOrHeaders = undefined;
  }

  const headerRecord = headerBagToLowerRecord(input.headers);

  let outcome: WebhookProcessingOutcome;
  try {
    outcome = await input.engine.processWithVerifier({
      raw: { body: rawBodyString, headers: headerRecord, query: input.query },
      verifyAndNormalize: async (raw: unknown) => {
        if (!hasBody(raw) || typeof raw.body !== "string") {
          throw new Error("invalid raw wrapper");
        }
        const body = raw.body;
        // Defensive bridge: Stripe/PayPal/MyFatoorah keep raw string (byte-exact HMAC).
        // Tap/Moyasar/Paymob need parsed object/array for field-based HMAC. Try
        // parsing the raw string when the gateway is object-HMAC; fall back to
        // string on invalid JSON (fail-closed — verifier returns 400).
        const gatewayKey = input.gateway.toLowerCase();
        let payloadForVerify: unknown = body;
        if (OBJECT_HMAC_GATEWAYS[gatewayKey]) {
          const parsed = maybeParsedBody(body);
          if (parsed !== body) payloadForVerify = parsed;
        }
        // WEBHOOKS-2 warn-only guard: client MUST have no onWebhookVerified fulfillment.
        // Fulfillment belongs in `handler` after inbox claim. Warn, never throw.
        if (hasOnWebhookVerifiedHook(input.client)) {
          console.warn(
            "[paykernel] WEBHOOKS-2: ProcessWebhookHttpInput.client has onWebhookVerified hooks; " +
              "fulfillment must be in handler after inbox claim. See docs/getting-started.md \"Never fulfill in onWebhookVerified\".",
          );
        }
        try {
          const rawEvent: unknown = await input.client.handleWebhook(
            input.gateway,
            payloadForVerify,
            signatureOrHeaders,
            headerRecord,
          );
          if (rawEvent === null || typeof rawEvent !== "object") {
            throw new Error("missing providerEventId");
          }
          const eventRecord = rawEvent as Record<string, unknown>;
          const providerEventIdValue = eventRecord["id"];
          const providerEventId =
            typeof providerEventIdValue === "string" ? providerEventIdValue : "";
          if (providerEventId.length === 0) {
            throw new Error("missing providerEventId");
          }
          const payloadHashValue = eventRecord["payloadHash"];
          const rawPayloadValue = eventRecord["rawPayload"];
          const eventValue = eventRecord["event"];

          const payloadHash = resolveInboxPayloadHash({
            eventPayloadHash:
              typeof payloadHashValue === "string" && payloadHashValue.length > 0
                ? payloadHashValue
                : undefined,
            payloadForHash:
              rawPayloadValue !== undefined
                ? rawPayloadValue
                : eventValue !== undefined
                  ? eventValue
                  : rawEvent,
          });

          const event = eventValue !== undefined ? eventValue : rawEvent;

          return {
            ok: true,
            gateway: input.gateway,
            providerEventId,
            payloadHash,
            event,
          };
        } catch (err) {
          if (err instanceof InvalidWebhookError) {
            return { ok: false, reason: "invalid_webhook" };
          }
          throw err;
        }
      },
      handler: input.handler,
    });
  } catch (err) {
    if (err instanceof InvalidWebhookError) {
      return {
        status: 400,
        headers: { "x-request-id": correlationId },
        body: { error: "invalid_webhook" },
      };
    }
    const status = 500;
    const headers: Record<string, string> = { "x-request-id": correlationId };
    return {
      status,
      headers,
      body: { outcome: "handler_failed", retryable: true },
    };
  }

  const status = mapInboxOutcome(outcome, ackPolicy);
  const headers: Record<string, string> = { "x-request-id": correlationId };
  const seconds = retryAfterSeconds(outcome);
  if (status === 503 && seconds !== undefined) {
    headers["retry-after"] = String(seconds);
  }

  let body: WebhookHttpResult["body"];
  if (outcome.outcome === "invalid_webhook") {
    body = { error: "invalid_webhook" };
  } else if (outcome.outcome === "scheduled_for_retry") {
    body = { outcome: outcome.outcome, reason: outcome.reason };
  } else if (outcome.outcome === "handler_failed") {
    body = { outcome: outcome.outcome, retryable: outcome.retryable };
  } else {
    body = { outcome: outcome.outcome };
  }

  return { status, headers, body };
}
