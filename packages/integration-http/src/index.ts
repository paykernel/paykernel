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
  /** WEBHOOKS-2: verifier with no onWebhookVerified fulfillment — see process.ts WebhookClient. */
  type WebhookClient,
  type WebhookHttpResult,
  /** WEBHOOKS-2: client must have no onWebhookVerified fulfillment — see process.ts. */
  type ProcessWebhookHttpInput,
} from "./process";
