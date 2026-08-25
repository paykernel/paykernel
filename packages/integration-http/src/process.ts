import { InvalidWebhookError, createOperationContext, type OperationContext } from "@paykernel/core";
import { resolveInboxPayloadHash, type WebhookInboxEngine, type WebhookHandler, type WebhookProcessingOutcome } from "@paykernel/webhooks";
import { getHeader, resolveCorrelationId } from "./headers";
import { mapInboxOutcome, retryAfterSeconds, type InboxHttpAckPolicy } from "./http-policy";
import { GATEWAY_WEBHOOK_SIGNATURE, extractWebhookSignature, type GatewayWebhookSignatureProfile } from "./signature";
import type { HeaderBag } from "./headers";

function hasBody(value: unknown): value is { body: unknown } {
  return typeof value === "object" && value !== null && "body" in value;
}

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
        try {
          const rawEvent: unknown = await input.client.handleWebhook(
            input.gateway,
            body,
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
