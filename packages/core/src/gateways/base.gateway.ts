// file: packages/payments/src/gateways/base.gateway.ts

import type { PaymentGateway } from './gateway.interface';
import type {
    CreatePaymentParams,
    CaptureParams,
    RefundParams,
    GatewayPaymentResult,
    GatewayRefundResult,
} from '../types/payment.types';
import type { WebhookEvent } from '../types/webhook.types';
import type { GatewayConfig } from '../types/config.types';
import type { HookContext, OperationType } from '../hooks/hooks.types';
import type { HooksManager } from '../hooks/hooks.manager';
import { z } from 'zod';
import {
    PaymentAbortedError,
    InvalidRequestError,
    PaymentError,
    OperationNotSupportedError,
} from '../errors';
import { createRedactingLogger, noopLogger, type Logger } from '../utils/logger';
import type { Clock } from '../runtime/clock';
import type {
    GatewayRuntimeDeps,
    PaymentRuntime,
} from '../runtime/payment-runtime';
import { createPaymentRuntime } from '../runtime/payment-runtime';
import {
    extractAbortSignal,
    stripAbortSignal,
    withAbortSignal,
} from '../runtime/abort';
import {
    defineGatewayCapabilities,
    freezeCapabilities,
    type GatewayCapabilities,
    type GatewayCapabilityKey,
} from './gateway-capabilities';

/**
 * Money / payment-identity fields that after-hooks must not alter.
 * After-hooks may still add/merge non-critical fields (metadata, rawResponse,
 * etc.); these keys are restored from the original gateway result whenever they
 * were present on that original object.
 *
 * Includes fee / capturedAmount / refundedAmount / clientSecret so after-hooks
 * cannot forge settlement totals or client secrets. Top-level `redirectUrl` and
 * `gatewayObjectId` are frozen so hooks cannot phishing-redirect customers or
 * forge secondary provider object IDs. `nextAction`, `references`, and `decline`
 * are deep-cloned (including nested redirect graphs such as
 * `redirect_to_url.url` and nested decline `code`/`message`/`softDecline`) so
 * hooks cannot forge/strip 3DS / redirect / OTP action payloads, hard-fail vs
 * soft-retry decline identity, or provider identity refs (`rawResponse` remains
 * additive and is intentionally not listed / not deep-cloned).
 */
const MONEY_IDENTITY_KEYS = [
    'success',
    'outcome',
    'status',
    'amount',
    'gatewayId',
    'gatewayObjectId',
    'captureId',
    'authorizationId',
    'orderId',
    'totalRefunded',
    'refundId',
    'gatewayRefundId',
    'fee',
    'capturedAmount',
    'refundedAmount',
    'clientSecret',
    'redirectUrl',
    'nextAction',
    'references',
    'decline',
    'reconciliationRequired',
    'providerRequestId',
] as const;

/**
 * Nested money/identity object keys that must be fully detached (deep-cloned)
 * from the hook-visible clone and freeze snapshot so nested rewrites
 * (`nextAction.redirectUrl`, `nextAction.redirect_to_url.url`,
 * `references.providerObjectId`, `decline.code` / `decline.softDecline`) cannot
 * poison freeze — including when the gateway aliases `nextAction` into
 * `rawResponse` (e.g. Stripe).
 */
const NESTED_IDENTITY_KEYS = ['nextAction', 'references', 'decline'] as const;

/**
 * Deep-clone plain objects / arrays (own enumerable props). Used for nested
 * identity fields (`nextAction`, `references`, `decline`) so multi-level
 * redirect/decline graphs are fully detached. Not for large additive bags like
 * `rawResponse`. Cycle-safe via WeakMap. Non-plain objects (class instances,
 * Date, etc.) are returned as-is — identity graphs are expected to be JSON-like.
 */
function deepClonePlain(value: unknown, seen?: WeakMap<object, unknown>): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const map = seen ?? new WeakMap<object, unknown>();
    const cached = map.get(value as object);
    if (cached !== undefined) {
        return cached;
    }

    if (Array.isArray(value)) {
        const arr: unknown[] = new Array(value.length);
        map.set(value, arr);
        for (let i = 0; i < value.length; i++) {
            arr[i] = deepClonePlain(value[i], map);
        }
        return arr;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        // Non-plain object — leave shared; not expected in identity graphs.
        return value;
    }

    const out: Record<string, unknown> = {};
    map.set(value as object, out);
    for (const key of Object.keys(value as Record<string, unknown>)) {
        out[key] = deepClonePlain(
            (value as Record<string, unknown>)[key],
            map,
        );
    }
    return out;
}

/**
 * Deep-detach nested identity fields on the committed gateway result so the
 * freeze snapshot is independent of any `rawResponse` alias (Stripe sets
 * `nextAction = intent.next_action` and `rawResponse = intent`).
 */
function detachNestedIdentityFields<R>(result: R): R {
    if (result === null || typeof result !== 'object') {
        return result;
    }
    const obj = result as Record<string, unknown>;
    for (const key of NESTED_IDENTITY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            obj[key] = deepClonePlain(obj[key]);
        }
    }
    return result;
}

/**
 * Restore critical money/identity fields from the original gateway result onto
 * an after-hook `modifiedResult`. Hooks cannot flip paid status or amounts,
 * and cannot introduce identity fields (e.g. forge `outcome: 'succeeded'` or
 * clear `reconciliationRequired`) that the gateway did not set.
 *
 * Nested identity objects (`nextAction`, `references`, `decline`) are always
 * reattached as deep clones of the freeze original so multi-level nested
 * rewrites cannot stick on the returned result.
 *
 * If `modified` is not a non-null object (null / undefined / primitive), it is
 * ignored and the original gateway result is returned unchanged.
 */
function restoreMoneyIdentityFields<R>(original: R, modified: R): R {
    // Non-object modifiedResult cannot carry additive fields safely — ignore it.
    // (Caller may log a warn when a logger is available.)
    if (modified === null || typeof modified !== 'object') {
        return original;
    }

    if (original === null || typeof original !== 'object') {
        return modified;
    }

    const orig = original as Record<string, unknown>;
    const out: Record<string, unknown> = {
        ...(modified as Record<string, unknown>),
    };
    let touched = false;

    for (const key of MONEY_IDENTITY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(orig, key)) {
            const origVal = orig[key];
            if (
                (NESTED_IDENTITY_KEYS as readonly string[]).includes(key) &&
                origVal !== null &&
                typeof origVal === 'object'
            ) {
                // Always re-snapshot nested identity (deep) from the freeze original.
                out[key] = deepClonePlain(origVal);
                touched = true;
            } else if (out[key] !== origVal) {
                out[key] = origVal;
                touched = true;
            }
        } else if (Object.prototype.hasOwnProperty.call(out, key)) {
            // Hook added an identity field the gateway never set — strip it so
            // after-hooks cannot forge paid/outcome/reconciliation markers.
            delete out[key];
            touched = true;
        }
    }

    return (touched ? out : modified) as R;
}

/**
 * Shallow-clone a gateway result so after-hooks that mutate the argument
 * in-place cannot poison the freeze snapshot used by restoreMoneyIdentityFields.
 *
 * Also deep-detaches nested identity objects (`nextAction`, `references`,
 * `decline`) so multi-level rewrites (e.g. `redirect_to_url.url`,
 * `providerObjectId`, `decline.softDecline`) do not mutate the freeze snapshot.
 * `rawResponse` is intentionally not deep-cloned.
 */
function shallowCloneResult<R>(result: R): R {
    if (result === null || typeof result !== 'object') {
        return result;
    }
    const clone: Record<string, unknown> = {
        ...(result as Record<string, unknown>),
    };
    for (const key of NESTED_IDENTITY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(clone, key)) {
            clone[key] = deepClonePlain(clone[key]);
        }
    }
    return clone as R;
}

/**
 * Abstract base gateway that provides hook execution for all operations.
 * All concrete gateway implementations should extend this class.
 *
 * `name` is an open string so third-party gateways need not cast to the
 * closed built-in {@link import('../types/payment.types').GatewayName} union.
 *
 * ## Capabilities (Phase 3)
 *
 * Instances always expose a complete frozen {@link capabilities} snapshot.
 * Pass explicit claims via the optional constructor argument (or
 * {@link defineGatewayCapabilities}). When omitted, capabilities default to
 * **all false** (fail-closed). The base class does **not** infer `true` from
 * optional method presence — built-ins and third-party adapters must claim
 * support deliberately.
 */
export abstract class BaseGateway implements PaymentGateway {
    abstract readonly name: string;

    /**
     * Frozen, complete capability snapshot. Always every
     * {@link GatewayCapabilityKey}, never partial.
     */
    readonly capabilities: GatewayCapabilities;

    /**
     * Redacting logger shared by all gateways. Defaults to a no-op when the
     * client is created without a logger. Never log secrets/PII directly;
     * structured context passed here is scrubbed before reaching the sink.
     */
    protected readonly logger: Logger;

    /**
     * Portable runtime (fetch / crypto / clock / randomUUID).
     * Defaults from {@link createPaymentRuntime} when ctor omits overrides.
     */
    protected readonly runtime: PaymentRuntime;

    /** Injected HTTP implementation (never bare global `fetch` at call sites). */
    protected readonly fetch: typeof globalThis.fetch;

    /** Wall clock from runtime (prefer over `Date.now` for ops/skew). */
    protected readonly clock: Clock;

    /**
     * @param config - Gateway config (may contain secrets; never copied into capabilities)
     * @param hooks - Shared hooks manager
     * @param logger - Optional logger sink (wrapped with redaction)
     * @param capabilities - Optional partial or complete capability claims.
     *   Merged with all-false defaults via {@link defineGatewayCapabilities}.
     *   Do not put secrets or credential material here.
     * @param runtime - Optional partial {@link PaymentRuntime} (fetch/crypto/clock/uuid).
     *   When omitted, portable defaults are used so `new StripeGateway(config, hooks)` still works.
     *   Access Web Crypto via `this.runtime.crypto` when needed.
     */
    constructor(
        protected readonly config: GatewayConfig,
        protected readonly hooks: HooksManager,
        logger?: Logger,
        capabilities?: Partial<GatewayCapabilities> | GatewayCapabilities,
        runtime?: GatewayRuntimeDeps,
    ) {
        // Skip wrapping when no sink is configured (or the shared noop is
        // passed explicitly via GatewayContext defaults) so we never pay
        // redaction cost for discarded logs, and never double-wrap the
        // client's already-redacting logger when callers pass the raw sink.
        this.logger =
            logger && logger !== noopLogger
                ? createRedactingLogger(logger)
                : noopLogger;
        this.capabilities = freezeCapabilities(
            defineGatewayCapabilities(capabilities ?? {}),
        );
        this.runtime = createPaymentRuntime(runtime ?? {});
        this.fetch = this.runtime.fetch;
        this.clock = this.runtime.clock;
    }

    /**
     * Whether this gateway claims support for `capability`.
     * Backed solely by {@link capabilities} — never by method duck-typing.
     */
    supports(capability: GatewayCapabilityKey): boolean {
        return this.capabilities[capability] === true;
    }

    /**
     * Throw {@link OperationNotSupportedError} with capability metadata when
     * the gateway does not claim `capability`. Use before capability-gated ops.
     */
    protected assertCapability(
        capability: GatewayCapabilityKey,
        operation: string,
    ): void {
        if (!this.supports(capability)) {
            throw new OperationNotSupportedError(this.name, operation, {
                capability,
                claimedSupport: false,
            });
        }
    }

    /**
     * Template method that wraps any operation with before/after/error hooks
     */
    protected async executeWithHooks<T, R>(
        operation: OperationType,
        params: T,
        executor: (params: T) => Promise<R>,
        schema?: z.ZodTypeAny
    ): Promise<R> {
        // AbortSignal is not Zod-friendly (and would fail `.strict()` schemas).
        // Strip before validation, reattach after so the HTTP layer still sees it.
        const initialSignal = extractAbortSignal(params);
        const { rest: paramsForValidation } = stripAbortSignal(params);

        // Validation Layer — use parsed data so Zod defaults/transforms apply
        let validatedParams = paramsForValidation as T;
        if (schema) {
            const parsed = schema.safeParse(paramsForValidation);
            if (!parsed.success) {
                throw new InvalidRequestError(
                    `Validation failed for ${operation}`,
                    parsed.error.errors
                );
            }
            validatedParams = withAbortSignal(parsed.data as T, initialSignal);
        } else {
            validatedParams = withAbortSignal(validatedParams, initialSignal);
        }

        const ctx: HookContext<T> = {
            gateway: this.name,
            operation,
            params: validatedParams,
            timestamp: new Date(),
            metadata: {},
        };

        // Execute before hooks
        const beforeResult = await this.hooks.runBefore(ctx);
        if (!beforeResult.proceed) {
            throw new PaymentAbortedError(beforeResult.abortReason);
        }

        // Use modified params if provided by hooks; re-validate so defaults/transforms apply
        let finalParams = beforeResult.params ?? validatedParams;
        const hookSignal =
            extractAbortSignal(finalParams) ?? initialSignal;
        if (schema) {
            const { rest: finalForValidation } = stripAbortSignal(finalParams);
            const parsed = schema.safeParse(finalForValidation);
            if (!parsed.success) {
                throw new InvalidRequestError(
                    `Validation failed for ${operation}`,
                    parsed.error.errors
                );
            }
            finalParams = withAbortSignal(parsed.data as T, hookSignal);
        } else {
            finalParams = withAbortSignal(finalParams, hookSignal);
        }

        let result: R;
        try {
            // Execute the actual gateway operation
            result = await executor(finalParams);
        } catch (error) {
            // Map to standardized error
            const mappedError = this.mapError(error);

            // Error hooks are secondary: log failures but always rethrow the mapped error
            try {
                await this.hooks.runError(ctx, mappedError);
            } catch (hookError) {
                this.logger.error('onError hook failed', {
                    operation,
                    gateway: this.name,
                    hookError:
                        hookError instanceof Error
                            ? hookError.message
                            : String(hookError),
                    originalError: mappedError.message,
                });
            }
            throw mappedError;
        }

        // After hooks run only on successful executor. The gateway side-effect
        // already committed — after hooks must never convert success into a
        // payment failure (no PaymentAbortedError, no rethrow of hook errors).
        // runAfter isolates per-handler throws/proceed:false and keeps last good
        // modifiedResult; this outer catch is a residual safety net.
        //
        // Deep-detach nested identity from any rawResponse alias, then pass a
        // shallow clone (with nested identity deep-cloned again) into runAfter
        // so in-place mutation of the hook argument cannot poison freeze.
        const originalResult = detachNestedIdentityFields(result);
        const resultForHooks = shallowCloneResult(originalResult);

        let afterResult: { proceed: boolean; modifiedResult?: R };
        try {
            afterResult = await this.hooks.runAfter(
                { ...ctx, params: finalParams },
                resultForHooks,
            );
        } catch (hookError) {
            this.logger.error(
                'after hook threw; returning successful gateway result',
                {
                    operation,
                    gateway: this.name,
                    hookError:
                        hookError instanceof Error
                            ? hookError.message
                            : String(hookError),
                },
            );
            return originalResult;
        }

        if (!afterResult.proceed) {
            this.logger.warn(
                'after hook returned proceed:false; ignored because side-effect already committed',
                {
                    operation,
                    gateway: this.name,
                },
            );
        }

        const modified = (afterResult.modifiedResult ?? originalResult) as R;
        if (modified === null || typeof modified !== 'object') {
            this.logger.warn(
                'after hook modifiedResult was not a non-null object; ignored',
                {
                    operation,
                    gateway: this.name,
                },
            );
        }
        return restoreMoneyIdentityFields(originalResult, modified);
    }

    /**
     * Map gateway-specific error to SDK unified error.
     * Gateways can override this to provide specific mapping logic.
     */
    protected mapError(error: unknown): Error {
        // If it's already a PaymentError (from SDK), pass it through
        if (error instanceof PaymentError) {
            return error;
        }
        return error instanceof Error ? error : new Error(String(error));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Abstract methods to be implemented by concrete gateways
    // ═══════════════════════════════════════════════════════════════════════════

    abstract createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult>;
    abstract capturePayment(params: CaptureParams): Promise<GatewayPaymentResult>;
    abstract refundPayment(params: RefundParams): Promise<GatewayRefundResult>;
    abstract verifyWebhook(
        payload: unknown,
        signature?: string,
        headers?: Record<string, string>,
    ): boolean;
    /**
     * Parse gateway webhook → {@link WebhookEvent}. Prefer dual-writing
     * Phase 7 PaymentEvent via `attachPaymentEvent` (see built-in gateways).
     */
    abstract parseWebhookEvent(payload: unknown): WebhookEvent;
}
