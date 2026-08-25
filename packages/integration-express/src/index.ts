/**
 * @paykernel/integration-express — thin Express adapter.
 * @packageDocumentation
 */

export { expressRawJson, expressWebhook } from "./express";

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
