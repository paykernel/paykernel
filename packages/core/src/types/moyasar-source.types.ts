// file: packages/payments/src/types/moyasar-source.types.ts

/**
 * Moyasar Payment Source Types
 *
 * Represents all supported payment sources for Moyasar gateway.
 * @see https://docs.moyasar.com/api/payments/01-create-payment
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Credit Card Source (Raw Card Details)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Raw credit card payment source for Moyasar.js / PCI-compliant collection only.
 * Backend `createPayment` rejects `type: "creditcard"` (PAN/CVC) with
 * InvalidRequestError — tokenize via Moyasar.js and send {@link CardTokenSource}.
 */
export interface CreditCardSource {
    type: "creditcard";
    /** Cardholder name (min 2 names, English only) */
    name: string;
    /** Card number (16-19 digits, no separators) */
    number: string;
    /** Expiry month (1-12) */
    month: number;
    /** Expiry year (>= 2000) */
    year: number;
    /** CVV/CVC/CSC (3-4 digits) */
    cvc: string;
    /** Optional statement descriptor suffix */
    statementDescriptor?: string;
    /** Enable 3DS authentication (default: true) */
    _3ds?: boolean;
    /** Authorize only (don't auto-capture) */
    manualCapture?: boolean;
    /** Save card for future tokenized payments */
    saveCard?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Card Token Source (Tokenized Card via Moyasar.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tokenized card payment source.
 * Token is obtained from Moyasar.js or previous payment with save_card=true.
 */
export interface CardTokenSource {
    type: "token";
    /** Token ID (starts with 'token_') */
    token: string;
    /** CVV/CVC/CSC (required for save_only tokens) */
    cvc?: string;
    /** Optional statement descriptor suffix */
    statementDescriptor?: string;
    /** Enable 3DS (depends on token status if not specified) */
    _3ds?: boolean;
    /** Authorize only (don't auto-capture) */
    manualCapture?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Apple Pay Source
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apple Pay payment source (encrypted token from Apple Pay JS).
 */
export interface ApplePaySource {
    type: "applepay";
    /** Encrypted token payload from Apple Pay */
    token: string;
    /** Authorize only (don't auto-capture) */
    manualCapture?: boolean;
    /** Save card for future tokenized payments */
    saveCard?: boolean;
    /** Optional statement descriptor suffix */
    statementDescriptor?: string;
}

/**
 * Apple Pay decrypted token source (when merchant decrypts the token).
 * Contains the Device Primary Account Number (DPAN) and cryptogram.
 */
export interface ApplePayDecryptedSource {
    type: "applepay";
    /** Device Primary Account Number (16-19 digits). Sent to Moyasar as `number`. */
    dpan: string;
    /** Expiry month (1-12) */
    month: number;
    /** Expiry year (>= 2000) */
    year: number;
    /** Network token cryptogram (up to 64 chars) */
    cryptogram: string;
    /** Device identifier (8-16 chars) */
    deviceId: string;
    /** Last 4 digits of the device card number. Sent to Moyasar as `last_four`. */
    lastFour?: string;
    /** Electronic Commerce Indicator (2 digits) */
    eci?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Samsung Pay Source
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Samsung Pay payment source.
 */
export interface SamsungPaySource {
    type: "samsungpay";
    /** Encrypted token payload from Samsung Pay */
    token: string;
    /** Authorize only (don't auto-capture) */
    manualCapture?: boolean;
    /** Save card for future tokenized payments */
    saveCard?: boolean;
    /** Optional statement descriptor suffix */
    statementDescriptor?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STC Pay Source
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * STC Pay mobile wallet payment source.
 * Customer receives OTP on their registered mobile number.
 *
 * Manual / authorize-only capture is not supported: `capture: false` or
 * `manualCapture` on create is rejected with InvalidRequestError.
 */
export interface StcPaySource {
    type: "stcpay";
    /**
     * Saudi Arabian mobile number in one of these formats:
     * - 05xxxxxxxx (local)
     * - +9665xxxxxxxx (E.164)
     * - 009665xxxxxxxx
     * - 9665xxxxxxxx
     *
     * Passed through to Moyasar as-is; the SDK does not reformat.
     */
    mobile: string;
    /** Cashier identifier (shown in Moyasar dashboard) */
    cashier?: string;
    /** Branch identifier (shown in Moyasar dashboard) */
    branch?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Union Type for All Moyasar Sources
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * All Moyasar payment source types (discriminated on `type`).
 * {@link CreditCardSource} is Moyasar.js / PCI-only; backend create accepts
 * token, applepay, samsungpay, and stcpay.
 */
export type MoyasarPaymentSource =
    | CreditCardSource
    | CardTokenSource
    | ApplePaySource
    | ApplePayDecryptedSource
    | SamsungPaySource
    | StcPaySource;

/**
 * Type guard to check if source is a credit card source
 */
export function isCreditCardSource(
    source: MoyasarPaymentSource,
): source is CreditCardSource {
    return source.type === "creditcard";
}

/**
 * Type guard to check if source is a token source
 */
export function isCardTokenSource(
    source: MoyasarPaymentSource,
): source is CardTokenSource {
    return source.type === "token";
}

/**
 * Type guard to check if source is an Apple Pay source
 */
export function isApplePaySource(
    source: MoyasarPaymentSource,
): source is ApplePaySource | ApplePayDecryptedSource {
    return source.type === "applepay";
}

/**
 * Type guard to check if source is a Samsung Pay source
 */
export function isSamsungPaySource(
    source: MoyasarPaymentSource,
): source is SamsungPaySource {
    return source.type === "samsungpay";
}

/**
 * Type guard to check if source is an STC Pay source
 */
export function isStcPaySource(
    source: MoyasarPaymentSource,
): source is StcPaySource {
    return source.type === "stcpay";
}
