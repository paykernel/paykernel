/**
 * Money / payment-identity fields that after-hooks must not alter.
 * After-hooks may still add/merge non-critical fields (metadata, rawResponse,
 * etc.); these keys are restored from the original gateway result whenever they
 * were present on that original object.
 *
 * Includes fee / capturedAmount / refundedAmount / refundedAt / clientSecret so
 * after-hooks cannot forge settlement totals, refund timestamps, or client
 * secrets. Top-level `redirectUrl` and `gatewayObjectId` are frozen so hooks
 * cannot phishing-redirect customers or forge secondary provider object IDs.
 * `nextAction`, `references`, and `decline` are deep-cloned (including nested
 * redirect graphs such as `redirect_to_url.url` and nested decline
 * `code`/`message`/`softDecline`) so hooks cannot forge/strip 3DS / redirect /
 * OTP action payloads, hard-fail vs soft-retry decline identity, or provider
 * identity refs (`rawResponse` remains additive and is intentionally not listed
 * / not deep-cloned). Dates (`refundedAt`) are cloned so in-place `setTime`
 * cannot poison the freeze snapshot.
 */
const MONEY_IDENTITY_KEYS = [
    'success',
    'outcome',
    'status',
    'amount',
    'currency',
    'gatewayId',
    'gatewayObjectId',
    'captureId',
    'authorizationId',
    'orderId',
    'totalRefunded',
    'refundId',
    'gatewayRefundId',
    'refundedAt',
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
    // CORE-3: Checkout / session identity (phishing-rewrite surface)
    'url',
    'sessionId',
    'paymentIntentId',
    'paymentStatus',
    'session',
    'customer',
    'paymentMethod',
    'paymentMethods',
    'dispute',
    'disputes',
    'paymentLink',
] as const;

/**
 * Nested money/identity object keys that must be fully detached (deep-cloned)
 * from the hook-visible clone and freeze snapshot so nested rewrites
 * (`nextAction.redirectUrl`, `nextAction.redirect_to_url.url`,
 * `references.providerObjectId`, `decline.code` / `decline.softDecline`,
 * `disputes[0].amount`, `paymentMethods[0].id`) cannot poison freeze —
 * including when the gateway aliases `nextAction` into `rawResponse`
 * (e.g. Stripe). Arrays of identity objects (`disputes`, `paymentMethods`)
 * are deep-cloned by `deepClonePlain`.
 */
const NESTED_IDENTITY_KEYS = [
    'nextAction',
    'references',
    'decline',
    'session',
    'customer',
    'paymentMethod',
    'paymentMethods',
    'dispute',
    'disputes',
    'paymentLink',
] as const;

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

/** Detach a Date so in-place `setTime` cannot poison the freeze snapshot. */
function cloneDateIfNeeded(value: unknown): unknown {
    return value instanceof Date ? new Date(value.getTime()) : value;
}

/**
 * Deep-detach nested identity fields on the committed gateway result so the
 * freeze snapshot is independent of any `rawResponse` alias (Stripe sets
 * `nextAction = intent.next_action` and `rawResponse = intent`).
 */
export function detachNestedIdentityFields<R>(result: R): R {
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
export function restoreMoneyIdentityFields<R>(original: R, modified: R): R {
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
            } else {
                const restored = cloneDateIfNeeded(origVal);
                if (out[key] !== restored) {
                    out[key] = restored;
                    touched = true;
                }
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
 * Top-level `Date` values (`refundedAt`) are cloned (NEW-CORE-7).
 * `rawResponse` is intentionally not deep-cloned.
 */
export function shallowCloneResult<R>(result: R): R {
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
    for (const key of Object.keys(clone)) {
        clone[key] = cloneDateIfNeeded(clone[key]);
    }
    return clone as R;
}
