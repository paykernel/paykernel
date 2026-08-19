// file: packages/core/src/runtime/crypto-portable.ts

/**
 * Pure portable crypto helpers for sync webhook verification and hashing.
 *
 * Strategy (Phase 8): pure SHA-256 / SHA-512 + HMAC implementations so
 * `verifyWebhook` stays **synchronous** on Workers / Deno / Bun / Node without
 * `node:crypto` or async Web Crypto `subtle`. No npm crypto dependencies.
 *
 * Encoding helpers use Web APIs (`TextEncoder`) or pure tables — never
 * `node:buffer` `Buffer`.
 *
 * @see docs/runtime.md
 */

// ─── Encoding ────────────────────────────────────────────────────────────────

const textEncoder =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : undefined;

/** UTF-8 encode a string via `TextEncoder` (Web API). */
export function utf8Encode(s: string): Uint8Array {
  if (textEncoder) {
    return textEncoder.encode(s);
  }
  // Minimal fallback when TextEncoder is missing (extremely rare).
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

const HEX = "0123456789abcdef";

/** Lowercase hex string from bytes. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out += HEX[b >> 4]! + HEX[b & 0xf]!;
  }
  return out;
}

/**
 * Decode one ASCII hex nibble. Returns -1 for non-hex (never uses parseInt).
 */
function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 97 && code <= 102) return code - 87; // a-f
  if (code >= 65 && code <= 70) return code - 55; // A-F
  return -1;
}

/**
 * Parse a hex string into bytes.
 * @throws {Error} if length is odd or characters are non-hex
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hexToBytes: invalid hex length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = hexNibble(hex.charCodeAt(i * 2));
    const lo = hexNibble(hex.charCodeAt(i * 2 + 1));
    if (hi < 0 || lo < 0) {
      throw new Error("hexToBytes: invalid hex character");
    }
    out[i] = (hi << 4) | lo;
  }
  return out;
}

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64-encode bytes (no `Buffer`). Uses `btoa` when available. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      B64[(n >> 18) & 63]! +
      B64[(n >> 12) & 63]! +
      B64[(n >> 6) & 63]! +
      B64[n & 63]!;
  }
  if (i < bytes.length) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const n = (a << 16) | (b << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : "=";
    out += "=";
  }
  return out;
}

/** Base64-decode to bytes (no `Buffer`). Uses `atob` when available. */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  const cleaned = b64.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((cleaned.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const a = B64.indexOf(cleaned[i]!);
    const b = B64.indexOf(cleaned[i + 1]!);
    const c = i + 2 < cleaned.length ? B64.indexOf(cleaned[i + 2]!) : 0;
    const d = i + 3 < cleaned.length ? B64.indexOf(cleaned[i + 3]!) : 0;
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < cleaned.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < cleaned.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/** UTF-8 string → Base64 (Basic auth helpers, etc.). */
export function utf8ToBase64(s: string): string {
  return bytesToBase64(utf8Encode(s));
}

// ─── timing-safe compare ─────────────────────────────────────────────────────

/**
 * Constant-time equality for equal-length byte arrays.
 * Returns `false` immediately when lengths differ (length is not secret).
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * Constant-time equality for equal-length hex strings (case-insensitive).
 * Returns `false` when lengths differ.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  // Normalize to lowercase without allocating intermediate decoded buffers
  // for the common equal-length hex path used by webhook signatures.
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    // fold A-F → a-f
    const na = ca >= 65 && ca <= 70 ? ca + 32 : ca;
    const nb = cb >= 65 && cb <= 70 ? cb + 32 : cb;
    diff |= na ^ nb;
  }
  return diff === 0;
}

// ─── Pure SHA-256 ────────────────────────────────────────────────────────────

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(message: Uint8Array): Uint8Array {
  // padding: 0x80 + zeros + 8-byte length → multiple of 64
  const withPad = message.length + 1 + 8;
  const padLen = (64 - (withPad % 64)) % 64;
  const total = message.length + 1 + padLen + 8;
  const buf = new Uint8Array(total);
  buf.set(message);
  buf[message.length] = 0x80;
  // big-endian 64-bit bit length (S19-SHA256-LEN: write high 32 bits too)
  const view = new DataView(buf.buffer);
  view.setUint32(
    total - 8,
    Math.floor(message.length / 0x20000000) >>> 0,
    false,
  );
  view.setUint32(total - 4, (message.length * 8) >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr32(w[i - 15]!, 7) ^ rotr32(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 =
        rotr32(w[i - 2]!, 17) ^ rotr32(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const dv = new DataView(digest.buffer);
  dv.setUint32(0, h0, false);
  dv.setUint32(4, h1, false);
  dv.setUint32(8, h2, false);
  dv.setUint32(12, h3, false);
  dv.setUint32(16, h4, false);
  dv.setUint32(20, h5, false);
  dv.setUint32(24, h6, false);
  dv.setUint32(28, h7, false);
  return digest;
}

// ─── Pure SHA-512 (big-endian 64-bit via pairs of uint32) ─────────────────────

/** 64-bit as [hi, lo] uint32 */
type U64 = [number, number];

function u64(hi: number, lo: number): U64 {
  return [hi >>> 0, lo >>> 0];
}

function add64(a: U64, b: U64): U64 {
  const lo = (a[1] + b[1]) >>> 0;
  const carry = lo < a[1] ? 1 : 0;
  const hi = (a[0] + b[0] + carry) >>> 0;
  return [hi, lo];
}

function rotr64(x: U64, n: number): U64 {
  if (n === 0) return [x[0], x[1]];
  if (n < 32) {
    const hi = ((x[0] >>> n) | (x[1] << (32 - n))) >>> 0;
    const lo = ((x[1] >>> n) | (x[0] << (32 - n))) >>> 0;
    return [hi, lo];
  }
  n -= 32;
  const hi = ((x[1] >>> n) | (x[0] << (32 - n))) >>> 0;
  const lo = ((x[0] >>> n) | (x[1] << (32 - n))) >>> 0;
  return [hi, lo];
}

function shr64(x: U64, n: number): U64 {
  if (n === 0) return [x[0], x[1]];
  if (n < 32) {
    const hi = x[0] >>> n;
    const lo = ((x[1] >>> n) | (x[0] << (32 - n))) >>> 0;
    return [hi, lo];
  }
  return [0, x[0] >>> (n - 32)];
}

function xor64(a: U64, b: U64): U64 {
  return [(a[0] ^ b[0]) >>> 0, (a[1] ^ b[1]) >>> 0];
}

function and64(a: U64, b: U64): U64 {
  return [(a[0] & b[0]) >>> 0, (a[1] & b[1]) >>> 0];
}

function not64(a: U64): U64 {
  return [~a[0] >>> 0, ~a[1] >>> 0];
}

// SHA-512 round constants (hi, lo) pairs
const SHA512_K: U64[] = [
  [0x428a2f98, 0xd728ae22], [0x71374491, 0x23ef65cd], [0xb5c0fbcf, 0xec4d3b2f],
  [0xe9b5dba5, 0x8189dbbc], [0x3956c25b, 0xf348b538], [0x59f111f1, 0xb605d019],
  [0x923f82a4, 0xaf194f9b], [0xab1c5ed5, 0xda6d8118], [0xd807aa98, 0xa3030242],
  [0x12835b01, 0x45706fbe], [0x243185be, 0x4ee4b28c], [0x550c7dc3, 0xd5ffb4e2],
  [0x72be5d74, 0xf27b896f], [0x80deb1fe, 0x3b1696b1], [0x9bdc06a7, 0x25c71235],
  [0xc19bf174, 0xcf692694], [0xe49b69c1, 0x9ef14ad2], [0xefbe4786, 0x384f25e3],
  [0x0fc19dc6, 0x8b8cd5b5], [0x240ca1cc, 0x77ac9c65], [0x2de92c6f, 0x592b0275],
  [0x4a7484aa, 0x6ea6e483], [0x5cb0a9dc, 0xbd41fbd4], [0x76f988da, 0x831153b5],
  [0x983e5152, 0xee66dfab], [0xa831c66d, 0x2db43210], [0xb00327c8, 0x98fb213f],
  [0xbf597fc7, 0xbeef0ee4], [0xc6e00bf3, 0x3da88fc2], [0xd5a79147, 0x930aa725],
  [0x06ca6351, 0xe003826f], [0x14292967, 0x0a0e6e70], [0x27b70a85, 0x46d22ffc],
  [0x2e1b2138, 0x5c26c926], [0x4d2c6dfc, 0x5ac42aed], [0x53380d13, 0x9d95b3df],
  [0x650a7354, 0x8baf63de], [0x766a0abb, 0x3c77b2a8], [0x81c2c92e, 0x47edaee6],
  [0x92722c85, 0x1482353b], [0xa2bfe8a1, 0x4cf10364], [0xa81a664b, 0xbc423001],
  [0xc24b8b70, 0xd0f89791], [0xc76c51a3, 0x0654be30], [0xd192e819, 0xd6ef5218],
  [0xd6990624, 0x5565a910], [0xf40e3585, 0x5771202a], [0x106aa070, 0x32bbd1b8],
  [0x19a4c116, 0xb8d2d0c8], [0x1e376c08, 0x5141ab53], [0x2748774c, 0xdf8eeb99],
  [0x34b0bcb5, 0xe19b48a8], [0x391c0cb3, 0xc5c95a63], [0x4ed8aa4a, 0xe3418acb],
  [0x5b9cca4f, 0x7763e373], [0x682e6ff3, 0xd6b2b8a3], [0x748f82ee, 0x5defb2fc],
  [0x78a5636f, 0x43172f60], [0x84c87814, 0xa1f0ab72], [0x8cc70208, 0x1a6439ec],
  [0x90befffa, 0x23631e28], [0xa4506ceb, 0xde82bde9], [0xbef9a3f7, 0xb2c67915],
  [0xc67178f2, 0xe372532b], [0xca273ece, 0xea26619c], [0xd186b8c7, 0x21c0c207],
  [0xeada7dd6, 0xcde0eb1e], [0xf57d4f7f, 0xee6ed178], [0x06f067aa, 0x72176fba],
  [0x0a637dc5, 0xa2c898a6], [0x113f9804, 0xbef90dae], [0x1b710b35, 0x131c471b],
  [0x28db77f5, 0x23047d84], [0x32caab7b, 0x40c72493], [0x3c9ebe0a, 0x15c9bebc],
  [0x431d67c4, 0x9c100d4c], [0x4cc5d4be, 0xcb3e42b6], [0x597f299c, 0xfc657e2a],
  [0x5fcb6fab, 0x3ad6faec], [0x6c44198c, 0x4a475817],
];

function sha512Bytes(message: Uint8Array): Uint8Array {
  const bitLenLo = (message.length * 8) >>> 0;
  const bitLenHi = Math.floor(message.length / 0x20000000); // >> 29 without float issues for small msgs

  const withPad = message.length + 1 + 16;
  const padLen = (128 - (withPad % 128)) % 128;
  const total = message.length + 1 + padLen + 16;
  const buf = new Uint8Array(total);
  buf.set(message);
  buf[message.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, bitLenHi >>> 0, false);
  view.setUint32(total - 4, bitLenLo >>> 0, false);

  let h0 = u64(0x6a09e667, 0xf3bcc908);
  let h1 = u64(0xbb67ae85, 0x84caa73b);
  let h2 = u64(0x3c6ef372, 0xfe94f82b);
  let h3 = u64(0xa54ff53a, 0x5f1d36f1);
  let h4 = u64(0x510e527f, 0xade682d1);
  let h5 = u64(0x9b05688c, 0x2b3e6c1f);
  let h6 = u64(0x1f83d9ab, 0xfb41bd6b);
  let h7 = u64(0x5be0cd19, 0x137e2179);

  const w: U64[] = new Array(80);

  for (let offset = 0; offset < total; offset += 128) {
    for (let i = 0; i < 16; i++) {
      w[i] = u64(
        view.getUint32(offset + i * 8, false),
        view.getUint32(offset + i * 8 + 4, false),
      );
    }
    for (let i = 16; i < 80; i++) {
      const s0 = xor64(
        xor64(rotr64(w[i - 15]!, 1), rotr64(w[i - 15]!, 8)),
        shr64(w[i - 15]!, 7),
      );
      const s1 = xor64(
        xor64(rotr64(w[i - 2]!, 19), rotr64(w[i - 2]!, 61)),
        shr64(w[i - 2]!, 6),
      );
      w[i] = add64(add64(add64(w[i - 16]!, s0), w[i - 7]!), s1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 80; i++) {
      const S1 = xor64(xor64(rotr64(e, 14), rotr64(e, 18)), rotr64(e, 41));
      const ch = xor64(and64(e, f), and64(not64(e), g));
      const t1 = add64(
        add64(add64(add64(h, S1), ch), SHA512_K[i]!),
        w[i]!,
      );
      const S0 = xor64(xor64(rotr64(a, 28), rotr64(a, 34)), rotr64(a, 39));
      const maj = xor64(xor64(and64(a, b), and64(a, c)), and64(b, c));
      const t2 = add64(S0, maj);

      h = g;
      g = f;
      f = e;
      e = add64(d, t1);
      d = c;
      c = b;
      b = a;
      a = add64(t1, t2);
    }

    h0 = add64(h0, a);
    h1 = add64(h1, b);
    h2 = add64(h2, c);
    h3 = add64(h3, d);
    h4 = add64(h4, e);
    h5 = add64(h5, f);
    h6 = add64(h6, g);
    h7 = add64(h7, h);
  }

  const digest = new Uint8Array(64);
  const dv = new DataView(digest.buffer);
  const hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    dv.setUint32(i * 8, hs[i]![0], false);
    dv.setUint32(i * 8 + 4, hs[i]![1], false);
  }
  return digest;
}

// ─── HMAC ────────────────────────────────────────────────────────────────────

function hmac(
  hash: (data: Uint8Array) => Uint8Array,
  blockSize: number,
  key: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  let k = key;
  if (k.length > blockSize) {
    k = hash(k);
  }
  if (k.length < blockSize) {
    const padded = new Uint8Array(blockSize);
    padded.set(k);
    k = padded;
  }

  const oKey = new Uint8Array(blockSize);
  const iKey = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKey[i] = k[i]! ^ 0x5c;
    iKey[i] = k[i]! ^ 0x36;
  }

  const inner = new Uint8Array(blockSize + message.length);
  inner.set(iKey);
  inner.set(message, blockSize);
  const innerHash = hash(inner);

  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(oKey);
  outer.set(innerHash, blockSize);
  return hash(outer);
}

function coerceBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? utf8Encode(data) : data;
}

// ─── Public digests (sync, pure) ─────────────────────────────────────────────

/** Sync SHA-256 digest as bytes. */
export function sha256(data: string | Uint8Array): Uint8Array {
  return sha256Bytes(coerceBytes(data));
}

/** Sync SHA-256 hex digest (64 lowercase hex chars). */
export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(data));
}

/** Sync SHA-512 digest as bytes. */
export function sha512(data: string | Uint8Array): Uint8Array {
  return sha512Bytes(coerceBytes(data));
}

/** Sync SHA-512 hex digest (128 lowercase hex chars). */
export function sha512Hex(data: string | Uint8Array): string {
  return bytesToHex(sha512(data));
}

/** Sync HMAC-SHA256 as bytes. Key/message accept UTF-8 strings or bytes. */
export function hmacSha256(
  key: string | Uint8Array,
  message: string | Uint8Array,
): Uint8Array {
  return hmac(sha256Bytes, 64, coerceBytes(key), coerceBytes(message));
}

/** Sync HMAC-SHA256 hex (Stripe-style webhook signatures). */
export function hmacSha256Hex(
  key: string | Uint8Array,
  message: string | Uint8Array,
): string {
  return bytesToHex(hmacSha256(key, message));
}

/** Sync HMAC-SHA512 as bytes. */
export function hmacSha512(
  key: string | Uint8Array,
  message: string | Uint8Array,
): Uint8Array {
  return hmac(sha512Bytes, 128, coerceBytes(key), coerceBytes(message));
}

/** Sync HMAC-SHA512 hex (Paymob-style webhook signatures). */
export function hmacSha512Hex(
  key: string | Uint8Array,
  message: string | Uint8Array,
): string {
  return bytesToHex(hmacSha512(key, message));
}

/**
 * Concatenate byte arrays (portable replacement for `Buffer.concat`).
 */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
