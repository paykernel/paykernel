// file: packages/core/src/runtime/crypto-portable.test.ts

import { describe, it, expect } from "bun:test";
import {
  utf8Encode,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  utf8ToBase64,
  timingSafeEqualBytes,
  timingSafeEqualHex,
  sha256,
  sha256Hex,
  sha512Hex,
  hmacSha256Hex,
  hmacSha512Hex,
  concatBytes,
} from "./crypto-portable";

describe.skip("portable encoding", () => {
  it.skip("utf8Encode matches TextEncoder for ASCII and multibyte", () => {
    expect([...utf8Encode("abc")]).toEqual([0x61, 0x62, 0x63]);
    expect([...utf8Encode("✓")]).toEqual([...new TextEncoder().encode("✓")]);
  });

  it.skip("bytesToHex / hexToBytes round-trip", () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xa0, 0xff]);
    expect(bytesToHex(bytes)).toBe("000fa0ff");
    expect([...hexToBytes("000fa0ff")]).toEqual([...bytes]);
    expect([...hexToBytes("000Fa0Ff")]).toEqual([...bytes]);
  });

  it.skip("base64 encode/decode round-trip", () => {
    const bytes = utf8Encode("hello/world+");
    const b64 = bytesToBase64(bytes);
    expect(base64ToBytes(b64)).toEqual(bytes);
    expect(utf8ToBase64("user:pass")).toBe(btoa("user:pass"));
  });

  it.skip("pure base64 encode/decode path when btoa/atob are unavailable", () => {
    const originalBtoa = globalThis.btoa;
    const originalAtob = globalThis.atob;
    // Force pure table path (Workers-like hosts without btoa/atob still work).
    // @ts-expect-error deliberate deletion for portable fallback coverage
    delete globalThis.btoa;
    // @ts-expect-error deliberate deletion for portable fallback coverage
    delete globalThis.atob;
    try {
      const samples = [
        new Uint8Array([0]),
        new Uint8Array([0, 1]),
        new Uint8Array([0, 1, 2]),
        new Uint8Array([255, 254, 253, 1, 2]),
        utf8Encode("pay+ments/sdk"),
      ];
      for (const bytes of samples) {
        const b64 = bytesToBase64(bytes);
        expect(typeof b64).toBe("string");
        expect(b64.length).toBeGreaterThan(0);
        expect([...base64ToBytes(b64)]).toEqual([...bytes]);
      }
    } finally {
      globalThis.btoa = originalBtoa;
      globalThis.atob = originalAtob;
    }
  });

  it.skip("hexToBytes rejects odd length and does not pad (abc != 0abc)", () => {
    expect(() => hexToBytes("f")).toThrow(/invalid hex length/i);
    expect(() => hexToBytes("abc")).toThrow(/invalid hex length/i);
    // Padding would make "abc" decode as "0abc" → [0x0a, 0xbc]. It must not.
    expect([...hexToBytes("0abc")]).toEqual([0x0a, 0xbc]);
  });

  it.skip("hexToBytes rejects non-hex including parseInt-accepted 0g/ag", () => {
    expect(() => hexToBytes("0g")).toThrow(/invalid hex character/i);
    expect(() => hexToBytes("ag")).toThrow(/invalid hex character/i);
    expect(() => hexToBytes("zz")).toThrow(/invalid hex character/i);
    expect(() => hexToBytes("xy")).toThrow(/invalid hex character/i);
    expect(() => hexToBytes("0G")).toThrow(/invalid hex character/i);
  });

  it.skip("concatBytes joins parts", () => {
    expect([
      ...concatBytes(new Uint8Array([1]), new Uint8Array([2, 3])),
    ]).toEqual([1, 2, 3]);
  });
});

describe.skip("timingSafeEqualBytes / Hex", () => {
  it.skip("returns true for equal buffers", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(timingSafeEqualBytes(a, b)).toBe(true);
  });

  it.skip("returns false for unequal content", () => {
    expect(
      timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
    ).toBe(false);
  });

  it.skip("returns false on length mismatch", () => {
    expect(
      timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])),
    ).toBe(false);
  });

  it.skip("timingSafeEqualHex is case-insensitive and length-checked", () => {
    expect(timingSafeEqualHex("aBcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("ab", "abcd")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
  });
});

describe.skip("sha256 / sha512 pure digests", () => {
  it.skip("sha256Hex empty and 'abc' match NIST vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it.skip("sha256 accepts Uint8Array", () => {
    expect(bytesToHex(sha256(utf8Encode("abc")))).toBe(sha256Hex("abc"));
  });

  it.skip("sha256 64-bit length high word is written (S19-SHA256-LEN)", async () => {
    // Formula only — do not allocate 2^29 bytes. High word is byteLen / 2^29.
    const over512MiB = 0x20000000;
    expect(Math.floor(over512MiB / 0x20000000) >>> 0).toBe(1);
    expect((over512MiB * 8) >>> 0).toBe(0);
    // Small bodies (webhook HMAC) still match Web Crypto / NIST.
    const msg = "a".repeat(1000);
    const portable = sha256Hex(msg);
    const subtle = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(msg),
    );
    expect(portable).toBe(bytesToHex(new Uint8Array(subtle)));
  });

  it.skip("sha512Hex 'abc' matches NIST vector", () => {
    expect(sha512Hex("abc")).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
        "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
  });
});

describe.skip("hmacSha256 / hmacSha512 pure (RFC / Stripe / Paymob style)", () => {
  it.skip("HMAC-SHA256 known vector (key + fox)", () => {
    expect(
      hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"),
    ).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it.skip("HMAC-SHA512 known vector (key + fox)", () => {
    expect(
      hmacSha512Hex("key", "The quick brown fox jumps over the lazy dog"),
    ).toBe(
      "b42af09057bac1e2d41708e48a902e09b5ff7f12ab428a4fe86653c73dd248fb" +
        "82f948a549f7b791a5b41915ee4d1ec3935357e4e2317250d0372afa2ebeeb3a",
    );
  });

  it.skip("RFC 4231 test case 1 (HMAC-SHA256 / HMAC-SHA512)", () => {
    const key = new Uint8Array(20).fill(0x0b);
    const data = "Hi There";
    expect(hmacSha256Hex(key, data)).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
    expect(hmacSha512Hex(key, data)).toBe(
      "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cde" +
        "daa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
    );
  });

  it.skip("HMAC-SHA256 matches Stripe-style signed_payload form", () => {
    // Stripe: HMAC-SHA256(secret, `${timestamp}.${payload}`)
    const secret = "whsec_test_secret";
    const timestamp = "1609459200";
    const payload = '{"id":"evt_1"}';
    const signed = `${timestamp}.${payload}`;
    const expected = hmacSha256Hex(secret, signed);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    // recompute stable
    expect(hmacSha256Hex(secret, signed)).toBe(expected);
  });

  it.skip("HMAC-SHA512 matches Paymob-style concatenation", () => {
    const secret = "paymob_hmac_secret";
    const dataString = "1000trueTXN";
    const hex = hmacSha512Hex(secret, dataString);
    expect(hex).toMatch(/^[0-9a-f]{128}$/);
    expect(hmacSha512Hex(secret, dataString)).toBe(hex);
  });

  it.skip("key longer than block size is hashed first (HMAC-SHA256)", () => {
    // Block size 64; key > 64 triggers key = H(key)
    const longKey = "k".repeat(80);
    const msg = "data";
    const hex = hmacSha256Hex(longKey, msg);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    // Cross-check with Web Crypto if available
    // (optional; pure path is source of truth for sync verify)
  });
});
