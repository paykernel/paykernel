// file: packages/payments/src/hooks/hooks.manager.ts

import type {
    PaymentHooks,
    HookContext,
    BeforeHookResult,
    AfterHookResult,
    OperationType,
    BeforeHook,
    AfterHook,
    ErrorHook,
    WebhookReceivedHook,
    WebhookVerifiedHook,
    WebhookFailedHook,
} from './hooks.types';
import type { WebhookEvent } from '../types/webhook.types';
import type { GatewayId } from '../types/payment.types';
import { noopLogger, type Logger } from '../utils/logger';
import {
    restoreMoneyIdentityFields,
    shallowCloneResult,
} from './money-identity';

function shallowCopyJsonRoot(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.slice();
    }
    return { ...(value as Record<string, unknown>) };
}

/**
 * Isolate a verified webhook event for one `onWebhookVerified` handler (CORE-2).
 * Identity / dual-write (`event`, `provider`) are cloned so the first handler
 * cannot poison status/amount/stableType for the next. `rawPayload` is a
 * shallow root copy (PERF-6) — do not structuredClone the Stripe body.
 */
function cloneWebhookEventForHandler(event: WebhookEvent): WebhookEvent {
    const cloneNested = <T>(value: T): T => {
        try {
            return structuredClone(value);
        } catch {
            return value;
        }
    };
    return {
        ...event,
        timestamp: new Date(event.timestamp.getTime()),
        rawPayload: shallowCopyJsonRoot(event.rawPayload),
        ...(event.event !== undefined
            ? { event: cloneNested(event.event) }
            : {}),
        ...(event.provider !== undefined
            ? { provider: cloneNested(event.provider) }
            : {}),
    };
}

/**
 * Manages registration and execution of lifecycle hooks
 */
export class HooksManager {
    private hooks: PaymentHooks;
    private readonly logger: Logger;
    /**
     * Guards run after all before-hooks apply param mods and before the
     * executor (CORE-1). Used by PaymentClient to re-assert partialCapture /
     * partialRefunds so hook-injected amounts cannot bypass capability:false.
     */
    private readonly postBeforeGuards: Array<
        (ctx: HookContext) => void | Promise<void>
    > = [];

    /**
     * @param hooks - Optional hook handlers (shallow-copied so later mutation
     *   of the caller's object does not affect this manager)
     * @param logger - Optional logger for after-hook isolation diagnostics
     *   (proceed:false / throws). Defaults to a no-op.
     */
    constructor(hooks?: PaymentHooks, logger?: Logger) {
        this.hooks = { ...(hooks ?? {}) };
        this.logger = logger ?? noopLogger;
    }

    /**
     * Register a hook at runtime.
     * If a handler is already registered for the same name, both are composed
     * (previous first, then new). Before-hooks short-circuit on `proceed: false`;
     * after-hooks chain with `modifiedResult` carry-forward and do **not**
     * short-circuit on `proceed: false` (ignored; later handlers still run);
     * onWebhookVerified fails fast on first throw; onError/onWebhookReceived/
     * onWebhookFailed run both then rethrow the first error.
     */
    register<K extends keyof PaymentHooks>(
        name: K,
        handler: PaymentHooks[K]
    ): void {
        if (!handler) {
            return;
        }

        const existing = this.hooks[name];
        if (!existing) {
            (this.hooks as Record<string, unknown>)[name] = handler;
            return;
        }

        (this.hooks as Record<string, unknown>)[name] = this.composeHandlers(
            name,
            existing,
            handler
        );
    }

    /**
     * Compose two handlers for the same hook slot without breaking single-handler types.
     */
    private composeHandlers<K extends keyof PaymentHooks>(
        name: K,
        previous: NonNullable<PaymentHooks[K]>,
        next: NonNullable<PaymentHooks[K]>
    ): PaymentHooks[K] {
        // Before-style hooks (global + operation-specific)
        if (
            name === 'onBefore' ||
            name === 'beforeCreatePayment' ||
            name === 'beforeAuthorize' ||
            name === 'beforeCapture' ||
            name === 'beforeRefund' ||
            name === 'beforeVoid'
        ) {
            const prev = previous as BeforeHook;
            const nxt = next as BeforeHook;
            const composed: BeforeHook = async (ctx) => {
                const first = await prev(ctx);
                if (!first.proceed) {
                    return first;
                }
                if (first.params !== undefined) {
                    ctx.params = first.params;
                }
                return nxt(ctx);
            };
            return composed as PaymentHooks[K];
        }

        // After-style hooks: never short-circuit on proceed:false (ignored) or
        // throw (isolated). Always continue the chain with last good result so
        // analytics/side-channel handlers cannot drop later after-hooks.
        // Throws and proceed:false are logged then ignored.
        if (
            name === 'onAfter' ||
            name === 'afterCreatePayment' ||
            name === 'afterAuthorize' ||
            name === 'afterCapture' ||
            name === 'afterRefund' ||
            name === 'afterVoid'
        ) {
            const prev = previous as AfterHook;
            const nxt = next as AfterHook;
            const logger = this.logger;
            const composed: AfterHook = async (ctx, result) => {
                // CORE-2: later handlers must see frozen money/identity, not a
                // previous hook's forged paid/status/amount. Additive fields
                // on modifiedResult are kept.
                const freezeOriginal = shallowCloneResult(result);
                let carried = result;
                // Only surface modifiedResult when a handler actually set one so
                // executeWithHooks can preserve original result identity (e.g.
                // Paymob idempotent cache returns) when no after-hook mutates.
                let didModify = false;
                try {
                    const first = await prev(ctx, result);
                    if (!first.proceed) {
                        logger.warn(
                            'after hook returned proceed:false; ignored (composition continues)',
                            {
                                operation: ctx.operation,
                                gateway: ctx.gateway,
                                hook: name,
                                phase: 'previous',
                            },
                        );
                    }
                    if (first.modifiedResult !== undefined) {
                        carried = restoreMoneyIdentityFields(
                            freezeOriginal,
                            first.modifiedResult,
                        );
                        didModify = true;
                    } else {
                        carried = restoreMoneyIdentityFields(
                            freezeOriginal,
                            carried,
                        );
                    }
                } catch (e) {
                    logger.error(
                        'after hook threw; isolated (composition continues)',
                        {
                            operation: ctx.operation,
                            gateway: ctx.gateway,
                            hook: name,
                            phase: 'previous',
                            hookError:
                                e instanceof Error ? e.message : String(e),
                        },
                    );
                    carried = restoreMoneyIdentityFields(
                        freezeOriginal,
                        carried,
                    );
                }
                try {
                    const second = await nxt(ctx, carried);
                    if (!second.proceed) {
                        logger.warn(
                            'after hook returned proceed:false; ignored (composition continues)',
                            {
                                operation: ctx.operation,
                                gateway: ctx.gateway,
                                hook: name,
                                phase: 'next',
                            },
                        );
                    }
                    if (second.modifiedResult !== undefined) {
                        carried = restoreMoneyIdentityFields(
                            freezeOriginal,
                            second.modifiedResult,
                        );
                        didModify = true;
                    }
                } catch (e) {
                    logger.error(
                        'after hook threw; isolated (composition continues)',
                        {
                            operation: ctx.operation,
                            gateway: ctx.gateway,
                            hook: name,
                            phase: 'next',
                            hookError:
                                e instanceof Error ? e.message : String(e),
                        },
                    );
                }
                return didModify
                    ? { proceed: true, modifiedResult: carried }
                    : { proceed: true };
            };
            return composed as PaymentHooks[K];
        }

        if (name === 'onError') {
            const prev = previous as ErrorHook;
            const nxt = next as ErrorHook;
            // Both handlers always run; first failure is rethrown after both complete
            // so outer isolation can still preserve the primary payment error.
            const composed: ErrorHook = async (ctx, error) => {
                let firstError: unknown;
                try {
                    await prev(ctx, error);
                } catch (e) {
                    firstError = e;
                }
                try {
                    await nxt(ctx, error);
                } catch (e) {
                    if (firstError === undefined) {
                        firstError = e;
                    }
                }
                if (firstError !== undefined) {
                    throw firstError;
                }
            };
            return composed as PaymentHooks[K];
        }

        if (name === 'onWebhookReceived') {
            const prev = previous as WebhookReceivedHook;
            const nxt = next as WebhookReceivedHook;
            const composed: WebhookReceivedHook = async (gateway, payload) => {
                let firstError: unknown;
                try {
                    await prev(gateway, payload);
                } catch (e) {
                    firstError = e;
                }
                try {
                    await nxt(gateway, payload);
                } catch (e) {
                    if (firstError === undefined) {
                        firstError = e;
                    }
                }
                if (firstError !== undefined) {
                    throw firstError;
                }
            };
            return composed as PaymentHooks[K];
        }

        if (name === 'onWebhookVerified') {
            const prev = previous as WebhookVerifiedHook;
            const nxt = next as WebhookVerifiedHook;
            // Fail-fast: if the first handler throws, do not run the next.
            // Avoids double fulfillment when a primary handler fails mid-way
            // (caller gets 5xx / provider retry; secondary must not also fulfill).
            // CORE-2: each handler receives an isolated clone so the first cannot
            // poison status/amount/stableType/nested event for the second.
            const composed: WebhookVerifiedHook = async (event) => {
                await prev(cloneWebhookEventForHandler(event));
                await nxt(cloneWebhookEventForHandler(event));
            };
            return composed as PaymentHooks[K];
        }

        if (name === 'onWebhookFailed') {
            const prev = previous as WebhookFailedHook;
            const nxt = next as WebhookFailedHook;
            const composed: WebhookFailedHook = async (payload, error) => {
                let firstError: unknown;
                try {
                    await prev(payload, error);
                } catch (e) {
                    firstError = e;
                }
                try {
                    await nxt(payload, error);
                } catch (e) {
                    if (firstError === undefined) {
                        firstError = e;
                    }
                }
                if (firstError !== undefined) {
                    throw firstError;
                }
            };
            return composed as PaymentHooks[K];
        }

        // Fallback: replace (should be unreachable for known keys)
        return next;
    }

    /**
     * Run before hooks for an operation
     */
    async runBefore<T>(ctx: HookContext<T>): Promise<BeforeHookResult<T>> {
        // Run global onBefore hook first
        if (this.hooks.onBefore) {
            const globalResult = await this.hooks.onBefore(ctx as HookContext);
            if (!globalResult.proceed) {
                return globalResult as BeforeHookResult<T>;
            }
            // Apply any param modifications from global hook
            if (globalResult.params !== undefined) {
                ctx.params = globalResult.params as T;
            }
        }

        // Run operation-specific before hook
        const specificHook = this.getSpecificBeforeHook<T>(ctx.operation);
        if (specificHook) {
            const result = await specificHook(ctx);
            if (!result.proceed) {
                return result;
            }
            // Apply any param modifications
            if (result.params !== undefined) {
                ctx.params = result.params;
            }
        }

        // CORE-1: post-before guards see final params (including hook-injected
        // amount) and may throw to block capability:false partial money ops.
        for (const guard of this.postBeforeGuards) {
            await guard(ctx as HookContext);
        }

        return { proceed: true, params: ctx.params };
    }

    /**
     * Run after hooks for an operation.
     *
     * After hooks cannot abort a committed money operation:
     * - `proceed: false` is ignored (warn-logged); later after-handlers still
     *   run with the last good `modifiedResult`.
     * - Throws from individual after-handlers are isolated (error-logged) so
     *   earlier `modifiedResult` values are kept and later handlers still run.
     * - Always returns `{ proceed: true }`. Includes `modifiedResult` only when
     *   a handler explicitly set one (so callers can preserve original result
     *   identity when no after-hook transforms the payload). Gateway layer may
     *   still warn if a caller path surfaces `proceed: false`, and has an outer
     *   safety net for unexpected throws.
     */
    async runAfter<T, R>(
        ctx: HookContext<T>,
        result: R
    ): Promise<AfterHookResult<R>> {
        // CORE-2: freeze money/identity for later handlers, not only on the
        // client return path. Specific after-hooks must not show onAfter (or
        // composed peers) a forged paid/status/amount.
        const freezeOriginal = shallowCloneResult(result);
        let finalResult = result;
        let didModify = false;

        // Run operation-specific after hook first
        const specificHook = this.getSpecificAfterHook<T, R>(ctx.operation);
        if (specificHook) {
            try {
                const hookResult = await specificHook(ctx, finalResult);
                if (!hookResult.proceed) {
                    this.logger.warn(
                        'after hook returned proceed:false; ignored because side-effect already committed',
                        {
                            operation: ctx.operation,
                            gateway: ctx.gateway,
                            hook: 'specific',
                        },
                    );
                }
                if (hookResult.modifiedResult !== undefined) {
                    finalResult = restoreMoneyIdentityFields(
                        freezeOriginal,
                        hookResult.modifiedResult as R,
                    );
                    didModify = true;
                } else {
                    finalResult = restoreMoneyIdentityFields(
                        freezeOriginal,
                        finalResult,
                    );
                }
            } catch (e) {
                this.logger.error(
                    'after hook threw; isolated (keeping last good result)',
                    {
                        operation: ctx.operation,
                        gateway: ctx.gateway,
                        hook: 'specific',
                        hookError: e instanceof Error ? e.message : String(e),
                    },
                );
                finalResult = restoreMoneyIdentityFields(
                    freezeOriginal,
                    finalResult,
                );
            }
        }

        // Run global onAfter hook
        if (this.hooks.onAfter) {
            try {
                const globalResult = await this.hooks.onAfter(
                    ctx as HookContext,
                    finalResult,
                );
                if (!globalResult.proceed) {
                    this.logger.warn(
                        'after hook returned proceed:false; ignored because side-effect already committed',
                        {
                            operation: ctx.operation,
                            gateway: ctx.gateway,
                            hook: 'onAfter',
                        },
                    );
                }
                if (globalResult.modifiedResult !== undefined) {
                    finalResult = restoreMoneyIdentityFields(
                        freezeOriginal,
                        globalResult.modifiedResult as R,
                    );
                    didModify = true;
                }
            } catch (e) {
                this.logger.error(
                    'after hook threw; isolated (keeping last good result)',
                    {
                        operation: ctx.operation,
                        gateway: ctx.gateway,
                        hook: 'onAfter',
                        hookError: e instanceof Error ? e.message : String(e),
                    },
                );
            }
        }

        return didModify
            ? { proceed: true, modifiedResult: finalResult }
            : { proceed: true };
    }

    /**
     * Run error hook
     */
    async runError(ctx: HookContext, error: Error): Promise<void> {
        if (this.hooks.onError) {
            await this.hooks.onError(ctx, error);
        }
    }

    /**
     * Run webhook received hook
     */
    async runWebhookReceived(
        gateway: GatewayId,
        payload: unknown
    ): Promise<void> {
        if (this.hooks.onWebhookReceived) {
            await this.hooks.onWebhookReceived(gateway, payload);
        }
    }

    /**
     * Run webhook verified hook
     */
    async runWebhookVerified(event: WebhookEvent): Promise<void> {
        if (this.hooks.onWebhookVerified) {
            await this.hooks.onWebhookVerified(event);
        }
    }

    /**
     * Run webhook failed hook
     */
    async runWebhookFailed(payload: unknown, error: Error): Promise<void> {
        if (this.hooks.onWebhookFailed) {
            await this.hooks.onWebhookFailed(payload, error);
        }
    }

    /**
     * Register a guard that runs after all before-hooks (global + operation-specific)
     * have applied param modifications, immediately before the executor.
     * Used by PaymentClient to re-assert partialCapture/partialRefunds (CORE-1).
     * Guards may throw (e.g. OperationNotSupportedError); throws abort the operation.
     */
    registerPostBeforeGuard(
        guard: (ctx: HookContext) => void | Promise<void>,
    ): void {
        this.postBeforeGuards.push(guard);
    }

    /**
     * Get operation-specific before hook
     */
    private getSpecificBeforeHook<T>(
        operation: OperationType
    ): ((ctx: HookContext<T>) => Promise<BeforeHookResult<T>> | BeforeHookResult<T>) | undefined {
        switch (operation) {
            case 'createPayment':
                return this.hooks.beforeCreatePayment as typeof this.getSpecificBeforeHook<T> extends never ? never : ReturnType<typeof this.getSpecificBeforeHook<T>>;
            case 'authorizePayment':
                return this.hooks.beforeAuthorize as ReturnType<typeof this.getSpecificBeforeHook<T>>;
            case 'capturePayment':
                return this.hooks.beforeCapture as ReturnType<typeof this.getSpecificBeforeHook<T>>;
            case 'refundPayment':
                return this.hooks.beforeRefund as ReturnType<typeof this.getSpecificBeforeHook<T>>;
            case 'voidPayment':
                return this.hooks.beforeVoid as ReturnType<typeof this.getSpecificBeforeHook<T>>;
            default:
                return undefined;
        }
    }

    /**
     * Get operation-specific after hook
     */
    private getSpecificAfterHook<T, R>(
        operation: OperationType
    ): ((ctx: HookContext<T>, result: R) => Promise<AfterHookResult<R>> | AfterHookResult<R>) | undefined {
        switch (operation) {
            case 'createPayment':
                return this.hooks.afterCreatePayment as ReturnType<typeof this.getSpecificAfterHook<T, R>>;
            case 'authorizePayment':
                return this.hooks.afterAuthorize as ReturnType<typeof this.getSpecificAfterHook<T, R>>;
            case 'capturePayment':
                return this.hooks.afterCapture as ReturnType<typeof this.getSpecificAfterHook<T, R>>;
            case 'refundPayment':
                return this.hooks.afterRefund as ReturnType<typeof this.getSpecificAfterHook<T, R>>;
            case 'voidPayment':
                return this.hooks.afterVoid as ReturnType<typeof this.getSpecificAfterHook<T, R>>;
            default:
                return undefined;
        }
    }
}
