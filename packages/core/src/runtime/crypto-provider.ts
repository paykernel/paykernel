// file: packages/core/src/runtime/crypto-provider.ts

/**
 * Portable crypto surface for gateways and {@link PaymentRuntime}.
 *
 * Prefer Web Crypto (`globalThis.crypto`). Do not require Node-only modules
 * (`node:crypto`) on this type — adapters that need Node APIs may use them
 * privately inside their own package (discouraged in core production sources).
 */
export interface CryptoProvider {
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  /** Present when the runtime exposes Web Crypto SubtleCrypto */
  readonly subtle?: SubtleCrypto;
}

/**
 * Build a UUID v4 string using `getRandomValues` only (no `randomUUID` required).
 */
export function uuidV4FromGetRandomValues(
  getRandomValues: CryptoProvider["getRandomValues"],
): string {
  const bytes = new Uint8Array(16);
  getRandomValues(bytes);
  // RFC 4122 version 4 / variant 1
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Resolve a portable CryptoProvider from `globalThis.crypto` when available.
 *
 * **CORE-3:** Does **not** fall back to `Math.random`. Auto idempotency keys and
 * runtime UUIDs must be cryptographically strong. When Web Crypto is absent,
 * this function **throws** — inject a real {@link CryptoProvider} via
 * `createPaymentRuntime({ crypto })` / client `runtime.crypto`.
 */
export function resolveDefaultCrypto(): CryptoProvider {
  const g =
    typeof globalThis !== "undefined"
      ? (globalThis as typeof globalThis & { crypto?: Crypto })
      : undefined;
  const webCrypto = g?.crypto;

  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const getRandomValues = webCrypto.getRandomValues.bind(
      webCrypto,
    ) as CryptoProvider["getRandomValues"];
    const randomUUID =
      typeof webCrypto.randomUUID === "function"
        ? webCrypto.randomUUID.bind(webCrypto)
        : () => uuidV4FromGetRandomValues(getRandomValues);

    const provider: CryptoProvider = {
      randomUUID,
      getRandomValues,
    };
    if (webCrypto.subtle) {
      (provider as { subtle?: SubtleCrypto }).subtle = webCrypto.subtle;
    }
    return provider;
  }

  throw new Error(
    "Web Crypto API is unavailable (globalThis.crypto.getRandomValues). " +
      "Inject a CryptoProvider via createPaymentRuntime({ crypto }) or " +
      "createPaymentClient({ runtime: { crypto } }). " +
      "Math.random is not used for UUIDs or auto idempotency keys.",
  );
}
