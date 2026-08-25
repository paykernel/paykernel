import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  processWebhookHttp,
  resolveCorrelationId,
  type ProcessWebhookHttpInput,
} from "@paykernel/integration-http";
export function expressRawJson(): RequestHandler {
  return express.raw({ type: "application/json" });
}

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
        const correlationId = resolveCorrelationId(req.headers as Record<string, string | string[] | undefined>);
        res.setHeader("x-request-id", correlationId);
        res.status(400).json({ error: "invalid_webhook" });
        return;
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
