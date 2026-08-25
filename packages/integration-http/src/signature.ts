import type { HeaderBag } from "./headers";
import { getHeader } from "./headers";

export type GatewayWebhookSignatureProfile =
  | { kind: "header"; header: string; required: true }
  | { kind: "headers"; headers: readonly string[] }
  | { kind: "header_or_query"; header: string; query: string }
  | { kind: "payload" };

export const GATEWAY_WEBHOOK_SIGNATURE: Record<
  string,
  GatewayWebhookSignatureProfile
> = {
  stripe: { kind: "header", header: "stripe-signature", required: true },
  tap: { kind: "header", header: "hashstring", required: true },
  myfatoorah: {
    kind: "header",
    header: "MyFatoorah-Signature",
    required: true,
  },
  paypal: {
    kind: "headers",
    headers: [
      "paypal-transmission-id",
      "paypal-transmission-time",
      "paypal-transmission-sig",
      "paypal-cert-url",
      "paypal-auth-algo",
    ],
  },
  paymob: { kind: "header_or_query", header: "hmac", query: "hmac" },
  moyasar: { kind: "payload" },
};

export function extractWebhookSignature(
  gateway: string,
  headers: HeaderBag,
  query?: Record<string, string | undefined>,
  profile?: GatewayWebhookSignatureProfile,
): string | Record<string, string> | undefined {
  const resolved =
    profile ?? GATEWAY_WEBHOOK_SIGNATURE[gateway.toLowerCase()];

  if (!resolved) return undefined;

  switch (resolved.kind) {
    case "header": {
      const value = getHeader(headers, resolved.header);
      if (value !== undefined && value.length > 0) return value;
      return undefined;
    }
    case "headers": {
      const out: Record<string, string> = {};
      let found = false;
      for (const name of resolved.headers) {
        const value = getHeader(headers, name);
        if (value !== undefined && value.length > 0) {
          out[name.toLowerCase()] = value;
          found = true;
        }
      }
      return found ? out : undefined;
    }
    case "header_or_query": {
      const headerValue = getHeader(headers, resolved.header);
      if (headerValue !== undefined && headerValue.length > 0) return headerValue;
      if (query) {
        // query keys case-sensitive? treat case-insensitive for hmac param
        for (const [k, v] of Object.entries(query)) {
          if (k.toLowerCase() === resolved.query.toLowerCase() && v !== undefined && v.length > 0) {
            return v;
          }
        }
      }
      return undefined;
    }
    case "payload":
      return undefined;
    default: {
      const exhaustive: never = resolved;
      return exhaustive;
    }
  }
}
