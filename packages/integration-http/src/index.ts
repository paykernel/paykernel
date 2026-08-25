/**
 * @paykernel/integration-http — portable HTTP mapping and webhook helpers.
 * No framework imports. Framework packages depend on this.
 * @packageDocumentation
 */

export { mapInboxOutcome, retryAfterSeconds, type InboxHttpAckPolicy } from "./http-policy";
export { getHeader, resolveCorrelationId, requireStringBindings, type HeaderBag } from "./headers";
export {
  GATEWAY_WEBHOOK_SIGNATURE,
  extractWebhookSignature,
  type GatewayWebhookSignatureProfile,
} from "./signature";
export {
  processWebhookHttp,
  webhookHttpResultToResponse,
  createWebhookOperationContext,
  type WebhookClient,
  type WebhookHttpResult,
  type ProcessWebhookHttpInput,
} from "./process";
