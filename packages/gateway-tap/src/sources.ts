import { InvalidRequestError } from "@paykernel/core";
import { TAP_DEFAULT_SOURCE_ID } from "./config";
import type { TapSource } from "./types";

const ALLOWED_SOURCE = /^(tok_|src_|auth_)/i;

export function resolveTapSourceId(source: TapSource | undefined): string {
  const id = source?.id?.trim() || TAP_DEFAULT_SOURCE_ID;
  assertAllowedTapSourceId(id);
  return id;
}

export function assertAllowedTapSourceId(id: string): void {
  if (id.length === 0) {
    throw new InvalidRequestError("Tap source id must be a non-empty string");
  }
  if (looksLikePan(id)) {
    throw new InvalidRequestError(
      "Tap source must be a token or src_* method id, not cardholder data",
    );
  }
  if (ALLOWED_SOURCE.test(id)) {
    return;
  }
  throw new InvalidRequestError(
    `Unsupported Tap source id "${id}". Use tok_…, src_all, src_card, a local method (src_kw.knet, …), or an authorize id (auth_…).`,
  );
}

export function assertNoPciCardSource(body: Record<string, unknown>): void {
  const source = body.source;
  if (source !== null && typeof source === "object" && !Array.isArray(source)) {
    const rec = source as Record<string, unknown>;
    if (rec.card !== undefined && rec.card !== null) {
      throw new InvalidRequestError(
        "Tap PCI source.card is not accepted by this backend adapter",
      );
    }
    if (rec.on_file === true && rec.card !== undefined) {
      throw new InvalidRequestError(
        "Tap PCI on_file+card source is not accepted by this backend adapter",
      );
    }
  }
}

function looksLikePan(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 19;
}
