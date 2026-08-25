/**
 * @paykernel/integration-elysia — thin Elysia adapter for @paykernel/integration-http.
 * @packageDocumentation
 */

export { elysiaWebhook } from "./elysia";

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
