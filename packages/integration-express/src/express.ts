import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  OBJECT_HMAC_GATEWAYS,
  processWebhookHttp,
  resolveCorrelationId,
  type ProcessWebhookHttpInput,
} from "@paykernel/integration-http";


/**
 * Returns `express.raw({ type: "application/json" })` middleware for webhook
 * routes. The `type: "application/json"` option is evaluated via the `type-is`
 * library, so it matches `application/json` with or without a
 * `; charset=utf-8` suffix (e.g. `application/json; charset=utf-8`). Use only
 * on webhook routes that need raw-body preservation; regular JSON routes should
 * keep `express.json()`.
 */
export function expressRawJson(): RequestHandler {
  // `express.raw({ type: "application/json" })` delegates to `type-is` which
  // handles `; charset=utf-8` automatically — no custom type function needed.
  return express.raw({ type: "application/json" });
}

/**
 * Express adapter for {@link processWebhookHttp}.
 *
 * Gateway-aware object-body handling:
 * - For object-HMAC gateways (`tap`, `moyasar`, `paymob`) which verify HMAC
 *   over fields extracted from the parsed JSON object, a pre-parsed
 *   `req.body` object (e.g. when `express.json()` ran before this handler) is
 *   tolerated by serializing it via `JSON.stringify(body)` and forwarding the
 *   resulting string as `rawBody`. `processWebhookHttp` will re-parse it for
 *   verification, preserving the verify path.
 * - For string-HMAC gateways (`stripe`, `paypal`, `myfatoorah`, etc.) which
 *   verify HMAC over the exact raw bytes, a pre-parsed object body cannot be
 *   safely re-serialized to the original bytes, so the handler fail-closes with
 *   `400 { error: "invalid_webhook" }` without calling the client.
 *
 * Still handles `Buffer`, `string`, and `Uint8Array` bodies as before; the
 * `Buffer.isBuffer` guard is preserved for Node buffers.
 */
export function expressWebhook(
  options: Omit<ProcessWebhookHttpInput, "rawBody" | "headers" | "query">,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let rawBody: string | Uint8Array;
      const body: unknown = (req as unknown as { body?: unknown }).body;

      if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
        rawBody = body as Uint8Array;
      } else if (typeof body === "string") {
        rawBody = body;
      } else if (body instanceof Uint8Array) {
        rawBody = body;
      } else if (body !== undefined && body !== null && typeof body === "object") {
        const gatewayLower = options.gateway.toLowerCase();
        if (OBJECT_HMAC_GATEWAYS.has(gatewayLower)) {
          rawBody = JSON.stringify(body);
        } else {
          const correlationId = resolveCorrelationId(req.headers as Record<string, string | string[] | undefined>);
          res.setHeader("x-request-id", correlationId);
          res.status(400).json({ error: "invalid_webhook" });
          return;
        }
      } else if (body === undefined || body === null) {
        rawBody = "";
      } else {
        rawBody = String(body);
      }

      const headers = req.headers as Record<string, string | string[] | undefined>;

      const query: Record<string, string | undefined> = {};
      const rawQuery: unknown = (req as unknown as { query?: unknown }).query;
      if (rawQuery !== null && typeof rawQuery === "object") {
        for (const [k, v] of Object.entries(rawQuery as Record<string, unknown>)) {
          if (typeof v === "string") query[k] = v;
          else if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") query[k] = v[0] as string;
        }
      }

      const result = await processWebhookHttp({
        ...options,
        rawBody,
        headers,
        query,
      });

      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  };
}
