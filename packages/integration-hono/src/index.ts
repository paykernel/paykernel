/**
 * @paykernel/integration-hono — thin Hono adapter for @paykernel/integration-http.
 * @packageDocumentation
 */

export { honoWebhook } from "./hono";

// Re-exports so apps can import one package
export {
  mapInboxOutcome,
  retryAfterSeconds,
  processWebhookHttp,
  webhookHttpResultToResponse,
  createWebhookOperationContext,
  getHeader,
  resolveCorrelationId,
  requireStringBindings,
  GATEWAY_WEBHOOK_SIGNATURE,
  extractWebhookSignature,
  type InboxHttpAckPolicy,
  type HeaderBag,
  type GatewayWebhookSignatureProfile,
  type WebhookClient,
  type WebhookHttpResult,
  type ProcessWebhookHttpInput,
} from "@paykernel/integration-http";
