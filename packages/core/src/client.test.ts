import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { PaymentClient } from './client';
import {
    GatewayNotConfiguredError,
    InvalidRequestError,
    InvalidWebhookError,
    OperationNotSupportedError,
    PaymentError,
} from './errors';
import {
    CreatePaymentParamsSchema,
    CaptureParamsSchema,
    MoyasarCreatePaymentParamsSchema,
    PayPalCreatePaymentParamsSchema,
} from './types/validation';
import { createPaymentClient } from './create-payment-client';
import { BaseGateway } from './gateways/base.gateway';
import type { GatewayAdapter } from './gateways/gateway-adapter';
import type { GatewayContext } from './gateways/gateway-context';
import type { GatewayCapabilities } from './gateways/gateway-capabilities';
import { HooksManager } from './hooks/hooks.manager';
import type {
    CreatePaymentParams,
    CaptureParams,
    RefundParams,
    GatewayPaymentResult,
    GatewayRefundResult,
} from './types/payment.types';
import type { WebhookEvent } from './types/webhook.types';

function createMockResponse(data: unknown): Response {
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(data),
        json: async () => data,
        headers: new Headers(),
    } as unknown as Response;
}

describe('PaymentClient Stripe convenience methods', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = originalFetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should route voidPayment to the selected gateway', async () => {
        let requestedUrl = '';
        globalThis.fetch = mock(async (url) => {
            requestedUrl = String(url);
            return createMockResponse({
                id: 'pi_cancel',
                object: 'payment_intent',
                status: 'canceled',
                amount: 5000,
                currency: 'usd',
                client_secret: null,
            });
        }) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test_123' },
            defaultGateway: 'stripe',
        });

        const result = await client.voidPayment({ gatewayPaymentId: 'pi_cancel' });

        expect(requestedUrl).toContain('/payment_intents/pi_cancel/cancel');
        expect(result.status).toBe('cancelled');
    });

    it('should route getPaymentStatus to the selected gateway', async () => {
        let requestedUrl = '';
        globalThis.fetch = mock(async (url) => {
            requestedUrl = String(url);
            // amount_received required for paid (STRIPE-2 fail-closed: missing settled → processing)
            return createMockResponse({
                id: 'pi_paid',
                object: 'payment_intent',
                status: 'succeeded',
                amount: 5000,
                amount_received: 5000,
                currency: 'usd',
                client_secret: null,
            });
        }) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test_123' },
            defaultGateway: 'stripe',
        });

        const status = await client.getPaymentStatus('pi_paid');

        expect(requestedUrl).toContain('/payment_intents/pi_paid');
        expect(status).toBe('paid');
    });

    it('should route createPayment to the explicit gateway', async () => {
        let requestedUrl = '';
        globalThis.fetch = mock(async (url) => {
            requestedUrl = String(url);
            return createMockResponse({
                id: 'pi_create',
                object: 'payment_intent',
                status: 'requires_payment_method',
                amount: 2500,
                currency: 'usd',
                client_secret: 'pi_create_secret',
            });
        }) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test_123' },
            moyasar: { secretKey: 'sk_test_moyasar' },
            defaultGateway: 'moyasar',
        });

        const result = await client.createPayment(
            {
                amount: 25,
                currency: 'USD',
                callbackUrl: 'https://example.com/callback',
            },
            'stripe',
        );

        expect(requestedUrl).toContain('api.stripe.com');
        expect(result.gatewayId).toBe('pi_create');
        expect(result.success).toBe(true);
    });
});

describe('PaymentClient resolveGateway and error types', () => {
    it('throws InvalidRequestError when no gateway and no default are set', async () => {
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123' },
        });

        try {
            await client.createPayment({
                amount: 10,
                currency: 'USD',
                callbackUrl: 'https://example.com/callback',
            });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidRequestError);
            expect(error).toBeInstanceOf(PaymentError);
            expect((error as InvalidRequestError).code).toBe('INVALID_REQUEST');
            expect((error as Error).message).toMatch(/no default gateway/i);
        }
    });

    it('throws GatewayNotConfiguredError for an unconfigured gateway name', async () => {
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123' },
            defaultGateway: 'stripe',
        });

        expect(() => client.gateway('moyasar')).toThrow(GatewayNotConfiguredError);
    });

    it('throws InvalidRequestError when defaultGateway is not among configured gateways', () => {
        expect(
            () =>
                new PaymentClient({
                    stripe: { secretKey: 'sk_test_123' },
                    defaultGateway: 'moyasar',
                }),
        ).toThrow(InvalidRequestError);
    });

    it('throws OperationNotSupportedError (not GatewayNotConfiguredError) for unsupported ops', async () => {
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123' },
            defaultGateway: 'stripe',
        });

        const gw = client.gateway('stripe');
        // Shadow prototype methods with undefined so client treats them as unsupported.
        Object.defineProperty(gw, 'voidPayment', { value: undefined, configurable: true });
        Object.defineProperty(gw, 'getPayment', { value: undefined, configurable: true });
        Object.defineProperty(gw, 'getPaymentStatus', {
            value: undefined,
            configurable: true,
        });

        try {
            await client.voidPayment({ gatewayPaymentId: 'pi_x' });
            expect.unreachable('voidPayment should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            expect(error).not.toBeInstanceOf(GatewayNotConfiguredError);
            const opErr = error as OperationNotSupportedError;
            expect(opErr.code).toBe('OPERATION_NOT_SUPPORTED');
            expect(opErr.message).toContain('voidPayment');
            // Stripe claims voids:true; method was shadowed — capability metadata present
            expect(opErr.capability).toBe('voids');
            expect(opErr.claimedSupport).toBe(true);
        }

        try {
            await client.getPayment({ gatewayPaymentId: 'pi_x' });
            expect.unreachable('getPayment should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const opErr = error as OperationNotSupportedError;
            expect(opErr.code).toBe('OPERATION_NOT_SUPPORTED');
            // getPayment is not a capability key — no capability metadata
            expect(opErr.capability).toBeUndefined();
        }

        try {
            await client.getPaymentStatus('pi_x');
            expect.unreachable('getPaymentStatus should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const opErr = error as OperationNotSupportedError;
            expect(opErr.code).toBe('OPERATION_NOT_SUPPORTED');
            expect(opErr.capability).toBeUndefined();
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 Stream C — client capability enforcement
// ═══════════════════════════════════════════════════════════════════════════════

function mockCapPaymentResult(
    gatewayId: string,
    overrides: Partial<GatewayPaymentResult> = {},
): GatewayPaymentResult {
    return {
        success: true,
        gatewayId,
        status: 'paid',
        rawResponse: {},
        amount: 10,
        ...overrides,
    };
}

/**
 * Configurable custom gateway for capability enforcement tests.
 */
class CapabilityTestGateway extends BaseGateway {
    readonly name: string;

    // Optional method assigned when implementVoid is true
    declare voidPayment?: (params: {
        gatewayPaymentId: string;
    }) => Promise<GatewayPaymentResult>;

    constructor(
        name: string,
        hooks: HooksManager,
        capabilities?: Partial<GatewayCapabilities> | GatewayCapabilities,
        opts: { implementVoid?: boolean } = {},
    ) {
        super({}, hooks, undefined, capabilities);
        this.name = name;
        if (opts.implementVoid) {
            this.voidPayment = async (params) =>
                this.executeWithHooks('voidPayment', params, async () =>
                    mockCapPaymentResult(`${name}_void`, { status: 'cancelled' }),
                );
        }
    }

    async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
        return this.executeWithHooks('createPayment', params, async (p) =>
            mockCapPaymentResult(`${this.name}_pay`, { amount: p.amount }),
        );
    }

    async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
        // Route through executeWithHooks so beforeCapture / CORE-1 post-before
        // guards run (capability re-assert after amount injection).
        return this.executeWithHooks('capturePayment', params, async (p) =>
            mockCapPaymentResult(`${this.name}_cap`, {
                amount: p.amount,
            }),
        );
    }

    async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
        return this.executeWithHooks('refundPayment', params, async (p) => ({
            success: true,
            gatewayRefundId: `${this.name}_ref`,
            status: 'completed' as const,
            rawResponse: {},
            amount: p.amount,
        }));
    }

    verifyWebhook(): boolean {
        return true;
    }

    parseWebhookEvent(payload: unknown): WebhookEvent {
        return {
            id: 'evt_cap',
            type: 'payment_paid',
            gateway: this.name,
            paymentId: undefined,
            gatewayPaymentId: 'pay_1',
            status: 'paid',
            timestamp: new Date(),
            rawPayload: payload,
        };
    }
}

function capabilityAdapter(
    name: string,
    capabilities?: Partial<GatewayCapabilities> | GatewayCapabilities,
    opts?: { implementVoid?: boolean },
): GatewayAdapter<string, CapabilityTestGateway> {
    return {
        name,
        manifest: {
            name,
            displayName: name,
        },
        create(ctx: GatewayContext) {
            return new CapabilityTestGateway(
                name,
                ctx.hooks,
                capabilities,
                opts,
            );
        },
    };
}

describe('PaymentClient capability enforcement (Phase 3)', () => {
    it('exposes supports() and capabilities via client.gateway(name)', () => {
        const client = createPaymentClient({
            gateways: {
                limited: capabilityAdapter('limited', {
                    payments: true,
                    refunds: true,
                    partialRefunds: false,
                    voids: false,
                }),
            },
            defaultGateway: 'limited',
        });

        const gw = client.gateway('limited');
        expect(gw.supports('payments')).toBe(true);
        expect(gw.supports('refunds')).toBe(true);
        expect(gw.supports('partialRefunds')).toBe(false);
        expect(gw.supports('voids')).toBe(false);
        expect(gw.capabilities.partialRefunds).toBe(false);
        expect(gw.capabilities.voids).toBe(false);
        expect(Object.isFrozen(gw.capabilities)).toBe(true);
    });

    it('voidPayment throws OperationNotSupportedError with capability voids when voids:false and no method', async () => {
        const client = createPaymentClient({
            gateways: {
                novoid: capabilityAdapter('novoid', {
                    payments: true,
                    voids: false,
                }),
            },
            defaultGateway: 'novoid',
        });

        expect(client.gateway('novoid').supports('voids')).toBe(false);
        expect(client.gateway('novoid').voidPayment).toBeUndefined();

        try {
            await client.voidPayment({ gatewayPaymentId: 'pay_1' });
            expect.unreachable('should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('voids');
            expect(err.claimedSupport).toBe(false);
            expect(err.operation).toBe('voidPayment');
            expect(err.gatewayName).toBe('novoid');
            expect(err.code).toBe('OPERATION_NOT_SUPPORTED');
            expect(err.message).toContain('voids');
        }
    });

    it('voidPayment throws with capability voids even when a method exists but voids:false (claim authoritative)', async () => {
        const client = createPaymentClient({
            gateways: {
                shadowvoid: capabilityAdapter(
                    'shadowvoid',
                    { payments: true, voids: false },
                    { implementVoid: true },
                ),
            },
            defaultGateway: 'shadowvoid',
        });

        // Method is present...
        expect(typeof client.gateway('shadowvoid').voidPayment).toBe('function');
        // ...but claim is false → client still rejects
        try {
            await client.voidPayment({ gatewayPaymentId: 'pay_1' });
            expect.unreachable('should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('voids');
            expect(err.claimedSupport).toBe(false);
        }
    });

    it('gateway().voidPayment with voids:false throws (P05-CAPS-1)', async () => {
        const client = createPaymentClient({
            gateways: {
                shadowvoid: capabilityAdapter(
                    'shadowvoid',
                    { payments: true, voids: false },
                    { implementVoid: true },
                ),
            },
            defaultGateway: 'shadowvoid',
        });

        const gw = client.gateway('shadowvoid');
        expect(typeof gw.voidPayment).toBe('function');
        expect(gw.supports('voids')).toBe(false);

        try {
            await gw.voidPayment!({ gatewayPaymentId: 'pay_1' });
            expect.unreachable('direct gateway().voidPayment should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('voids');
            expect(err.claimedSupport).toBe(false);
            expect(err.operation).toBe('voidPayment');
        }
    });

    it('createPayment with capture:false throws when authorization is not claimed (P05-CAPS-1)', async () => {
        const client = createPaymentClient({
            gateways: {
                noauth: capabilityAdapter('noauth', {
                    payments: true,
                    authorization: false,
                }),
            },
            defaultGateway: 'noauth',
        });

        try {
            await client.createPayment({
                amount: 10,
                currency: 'USD',
                callbackUrl: 'https://example.com/cb',
                capture: false,
            });
            expect.unreachable('capture:false without authorization should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('authorization');
            expect(err.claimedSupport).toBe(false);
            expect(err.operation).toBe('createPayment');
        }
    });

    it('beforeCreatePayment cannot inject capture:false to bypass authorization:false', async () => {
        const client = createPaymentClient({
            gateways: {
                noauth: capabilityAdapter('noauth', {
                    payments: true,
                    authorization: false,
                }),
            },
            defaultGateway: 'noauth',
            hooks: {
                beforeCreatePayment: async (ctx) => ({
                    proceed: true,
                    params: { ...ctx.params, capture: false },
                }),
            },
        });

        try {
            await client.createPayment({
                amount: 10,
                currency: 'USD',
                callbackUrl: 'https://example.com/cb',
            });
            expect.unreachable('hook-injected capture:false should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('authorization');
            expect(err.claimedSupport).toBe(false);
        }
    });

    it('refunds: full refund ok when refunds:true partialRefunds:false; partial amount throws partialRefunds', async () => {
        const client = createPaymentClient({
            gateways: {
                fullonly: capabilityAdapter('fullonly', {
                    payments: true,
                    refunds: true,
                    partialRefunds: false,
                }),
            },
            defaultGateway: 'fullonly',
        });

        expect(client.gateway('fullonly').supports('refunds')).toBe(true);
        expect(client.gateway('fullonly').supports('partialRefunds')).toBe(false);

        // Full refund (no amount) allowed
        const full = await client.refundPayment({ gatewayPaymentId: 'pay_1' });
        expect(full.success).toBe(true);
        expect(full.gatewayRefundId).toBe('fullonly_ref');

        // Partial amount blocked
        try {
            await client.refundPayment({ gatewayPaymentId: 'pay_1', amount: 5 });
            expect.unreachable('partial refund should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('partialRefunds');
            expect(err.claimedSupport).toBe(false);
            expect(err.operation).toBe('refundPayment');
        }
    });

    it('refundPayment throws with capability refunds when refunds:false', async () => {
        const client = createPaymentClient({
            gateways: {
                norefund: capabilityAdapter('norefund', {
                    payments: true,
                    refunds: false,
                    partialRefunds: false,
                }),
            },
            defaultGateway: 'norefund',
        });

        try {
            await client.refundPayment({ gatewayPaymentId: 'pay_1' });
            expect.unreachable('should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('refunds');
            expect(err.claimedSupport).toBe(false);
        }
    });

    it('createPayment throws with capability payments when payments:false', async () => {
        const client = createPaymentClient({
            gateways: {
                nopay: capabilityAdapter('nopay', {
                    payments: false,
                }),
            },
            defaultGateway: 'nopay',
        });

        try {
            await client.createPayment({
                amount: 10,
                currency: 'USD',
                callbackUrl: 'https://example.com/cb',
            });
            expect.unreachable('should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('payments');
            expect(err.claimedSupport).toBe(false);
            expect(err.operation).toBe('createPayment');
        }
    });

    it('capturePayment full capture ok when partialCapture:false; amount throws partialCapture', async () => {
        const client = createPaymentClient({
            gateways: {
                fullcap: capabilityAdapter('fullcap', {
                    payments: true,
                    authorization: true,
                    partialCapture: false,
                }),
            },
            defaultGateway: 'fullcap',
        });

        const full = await client.capturePayment({ gatewayPaymentId: 'pay_1' });
        expect(full.gatewayId).toBe('fullcap_cap');

        try {
            await client.capturePayment({ gatewayPaymentId: 'pay_1', amount: 3 });
            expect.unreachable('partial capture should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('partialCapture');
            expect(err.claimedSupport).toBe(false);
            expect(err.operation).toBe('capturePayment');
        }
    });

    it('CORE-1: beforeCapture amount injection cannot bypass partialCapture:false', async () => {
        const client = createPaymentClient({
            gateways: {
                fullcap: capabilityAdapter('fullcap', {
                    payments: true,
                    authorization: true,
                    partialCapture: false,
                }),
            },
            defaultGateway: 'fullcap',
            hooks: {
                beforeCapture: async (ctx) => ({
                    proceed: true,
                    params: { ...ctx.params, amount: 7 },
                }),
            },
        });

        // Entry params have no amount (would pass the client entry gate), but
        // beforeCapture injects amount — post-before guard must re-assert.
        try {
            await client.capturePayment({ gatewayPaymentId: 'pay_1' });
            expect.unreachable('hook-injected partial capture should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('partialCapture');
            expect(err.claimedSupport).toBe(false);
        }
    });

    it('CORE-1: beforeRefund amount injection cannot bypass partialRefunds:false', async () => {
        const client = createPaymentClient({
            gateways: {
                fullonly: capabilityAdapter('fullonly', {
                    payments: true,
                    refunds: true,
                    partialRefunds: false,
                }),
            },
            defaultGateway: 'fullonly',
            hooks: {
                beforeRefund: async (ctx) => ({
                    proceed: true,
                    params: { ...ctx.params, amount: 2 },
                }),
            },
        });

        try {
            await client.refundPayment({ gatewayPaymentId: 'pay_1' });
            expect.unreachable('hook-injected partial refund should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('partialRefunds');
            expect(err.claimedSupport).toBe(false);
        }
    });

    it('createAll attaches fail-closed capabilities when adapter instance lacks a surface (P05-CAPS-2)', async () => {
        // Pre-Phase-3 style object: no capabilities / supports.
        // Registry createAll must attach DEFAULT_GATEWAY_CAPABILITIES + supports().
        const legacyGw = {
            name: 'legacy',
            async createPayment() {
                return mockCapPaymentResult('legacy_pay');
            },
            async capturePayment() {
                return mockCapPaymentResult('legacy_cap');
            },
            async refundPayment() {
                return {
                    success: true,
                    gatewayRefundId: 'legacy_ref',
                    status: 'completed' as const,
                    rawResponse: {},
                };
            },
            verifyWebhook() {
                return true;
            },
            parseWebhookEvent(payload: unknown): WebhookEvent {
                return {
                    id: 'evt_l',
                    type: 'payment_paid',
                    gateway: 'legacy',
                    paymentId: undefined,
                    gatewayPaymentId: 'pay_l',
                    status: 'paid',
                    timestamp: new Date(),
                    rawPayload: payload,
                };
            },
        };

        const adapter: GatewayAdapter<'legacy', typeof legacyGw> = {
            name: 'legacy',
            manifest: { name: 'legacy' },
            create: () => legacyGw,
        };

        const client = createPaymentClient({
            gateways: { legacy: adapter },
            defaultGateway: 'legacy',
        });

        const gw = client.gateway('legacy');
        expect(typeof gw.supports).toBe('function');
        expect(gw.capabilities).toBeDefined();
        expect(gw.supports('payments')).toBe(false);
        expect(gw.supports('voids')).toBe(false);
        expect(gw.capabilities.payments).toBe(false);

        try {
            await client.createPayment({
                amount: 10,
                currency: 'USD',
                callbackUrl: 'https://example.com/cb',
            });
            expect.unreachable('fail-closed payments:false should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('payments');
            expect(err.claimedSupport).toBe(false);
        }

        try {
            await client.voidPayment({ gatewayPaymentId: 'pay_l' });
            expect.unreachable('fail-closed voids:false should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(OperationNotSupportedError);
            const err = error as OperationNotSupportedError;
            expect(err.capability).toBe('voids');
            expect(err.operation).toBe('voidPayment');
        }
    });
});

describe('PaymentClient after-hook post-success isolation', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = originalFetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('returns success when after-hook returns proceed:false (side-effect already committed)', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_abort',
                object: 'payment_intent',
                status: 'canceled',
                amount: 1000,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        let onErrorCalled = false;
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async () => ({ proceed: false }),
                onError: async () => {
                    onErrorCalled = true;
                },
            },
        });

        const result = await client.voidPayment({ gatewayPaymentId: 'pi_abort' });
        expect(result.gatewayId).toBe('pi_abort');
        expect(result.status).toBe('cancelled');
        expect(onErrorCalled).toBe(false);
    });

    it('returns success when after-hook throws (does not convert analytics failure into payment failure)', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_after_throw',
                object: 'payment_intent',
                status: 'canceled',
                amount: 1000,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        let onErrorCalled = false;
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async () => {
                    throw new Error('analytics down');
                },
                onError: async () => {
                    onErrorCalled = true;
                },
            },
        });

        const result = await client.voidPayment({ gatewayPaymentId: 'pi_after_throw' });
        expect(result.gatewayId).toBe('pi_after_throw');
        expect(result.status).toBe('cancelled');
        expect(onErrorCalled).toBe(false);
    });

    it('composed after-hooks continue after proceed:false (no short-circuit)', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_compose_proceed',
                object: 'payment_intent',
                status: 'canceled',
                amount: 1000,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const order: string[] = [];
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => {
                    order.push('first');
                    return {
                        proceed: false,
                        modifiedResult: {
                            ...result,
                            rawResponse: { ...(result.rawResponse as object), tagged: 'first' },
                        },
                    };
                },
            },
        });

        client.addHook('afterVoid', async (_ctx, result) => {
            order.push('second');
            return {
                proceed: true,
                modifiedResult: {
                    ...result,
                    rawResponse: {
                        ...(result.rawResponse as object),
                        tagged: 'second',
                    },
                },
            };
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_compose_proceed',
        });
        expect(order).toEqual(['first', 'second']);
        expect(result.gatewayId).toBe('pi_compose_proceed');
        expect((result.rawResponse as { tagged?: string }).tagged).toBe('second');
    });

    it('after-hook throw keeps earlier modifiedResult and continues chain', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_after_keep',
                object: 'payment_intent',
                status: 'canceled',
                amount: 1000,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const order: string[] = [];
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => {
                    order.push('specific');
                    return {
                        proceed: true,
                        modifiedResult: {
                            ...result,
                            rawResponse: {
                                ...(result.rawResponse as object),
                                fromSpecific: true,
                            },
                        },
                    };
                },
                onAfter: async () => {
                    order.push('global-throw');
                    throw new Error('global after boom');
                },
            },
        });

        const result = await client.voidPayment({ gatewayPaymentId: 'pi_after_keep' });
        expect(order).toEqual(['specific', 'global-throw']);
        expect(result.gatewayId).toBe('pi_after_keep');
        expect((result.rawResponse as { fromSpecific?: boolean }).fromSpecific).toBe(
            true,
        );
    });

    it('restores money identity fields if after-hook tries to change them', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_money_guard',
                object: 'payment_intent',
                status: 'canceled',
                amount: 2500,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => ({
                    proceed: true,
                    modifiedResult: {
                        ...result,
                        success: false,
                        status: 'paid' as const,
                        amount: 0.01,
                        gatewayId: 'forged_id',
                        // Phase 6: cannot forge paid outcome / references via modifiedResult
                        outcome: 'succeeded' as const,
                        references: {
                            providerObjectId: 'forged_ref',
                            normalizedStatus: 'paid',
                            gateway: 'stripe',
                        },
                        reconciliationRequired: false,
                        rawResponse: { annotated: true },
                    },
                }),
            },
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_money_guard',
        });
        // Money identity restored from original gateway result
        expect(result.success).toBe(true);
        expect(result.status).toBe('cancelled');
        expect(result.amount).toBe(25);
        expect(result.gatewayId).toBe('pi_money_guard');
        // Void dual-writes outcome succeeded + cancelled status (not paid)
        expect(result.outcome).toBe('succeeded');
        expect(result.references?.providerObjectId).toBe('pi_money_guard');
        expect(result.references?.normalizedStatus).toBe('cancelled');
        expect(result.reconciliationRequired).toBeUndefined();
        // Additive non-money field allowed
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot forge paid outcome from requires_action via after-hook modifiedResult', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_3ds_guard',
                object: 'payment_intent',
                status: 'requires_action',
                amount: 5000,
                currency: 'usd',
                client_secret: 'pi_3ds_guard_secret',
                next_action: {
                    type: 'redirect_to_url',
                    redirect_to_url: {
                        url: 'https://hooks.stripe.com/3ds',
                        return_url: 'https://example.com/return',
                    },
                },
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterCreatePayment: async (_ctx, result) => ({
                    proceed: true,
                    modifiedResult: {
                        ...result,
                        success: true,
                        status: 'paid' as const,
                        outcome: 'succeeded' as const,
                        gatewayId: 'forged_paid',
                        amount: 0.01,
                        references: {
                            providerObjectId: 'forged_paid',
                            normalizedStatus: 'paid',
                            gateway: 'stripe',
                        },
                        reconciliationRequired: false,
                        rawResponse: { annotated: true },
                    },
                }),
            },
        });

        const result = await client.createPayment({
            amount: 50,
            currency: 'USD',
            callbackUrl: 'https://example.com/return',
        });

        // Gateway 3DS shape preserved — hooks cannot flip to fake paid
        expect(result.outcome).toBe('requires_action');
        expect(result.outcome).not.toBe('succeeded');
        expect(result.status).toBe('pending');
        expect(result.gatewayId).toBe('pi_3ds_guard');
        expect(result.references?.providerObjectId).toBe('pi_3ds_guard');
        expect(result.references?.normalizedStatus).toBe('pending');
        expect(result.success).toBe(true); // API ok dual-write, not "paid"
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot replace nextAction with forged redirect via after-hook on requires_action create', async () => {
        const gatewayNextAction = {
            type: 'redirect_to_url',
            redirect_to_url: {
                url: 'https://hooks.stripe.com/3ds/real',
                return_url: 'https://example.com/return',
            },
        };
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_next_action_guard',
                object: 'payment_intent',
                status: 'requires_action',
                amount: 5000,
                currency: 'usd',
                client_secret: 'pi_next_action_guard_secret',
                next_action: gatewayNextAction,
            }),
        ) as unknown as typeof fetch;

        const forgedNextAction = {
            type: 'redirect',
            url: 'https://evil.example/phish',
        };

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterCreatePayment: async (_ctx, result) => ({
                    proceed: true,
                    modifiedResult: {
                        ...result,
                        nextAction: forgedNextAction,
                        // rawResponse remains additive (not identity-frozen)
                        rawResponse: { annotated: true, nextActionTampered: true },
                    },
                }),
            },
        });

        const result = await client.createPayment({
            amount: 50,
            currency: 'USD',
            callbackUrl: 'https://example.com/return',
        });

        expect(result.outcome).toBe('requires_action');
        expect(result.nextAction).toEqual(gatewayNextAction);
        expect(result.nextAction).not.toEqual(forgedNextAction);
        // Additive non-identity field allowed
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
        expect(
            (result.rawResponse as { nextActionTampered?: boolean }).nextActionTampered,
        ).toBe(true);
    });

    it('cannot invent nextAction via after-hook when gateway omitted it', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_no_next_action',
                object: 'payment_intent',
                status: 'canceled',
                amount: 2000,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => ({
                    proceed: true,
                    modifiedResult: {
                        ...result,
                        nextAction: {
                            type: 'redirect',
                            url: 'https://evil.example/forged',
                        },
                        rawResponse: { annotated: true },
                    },
                }),
            },
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_no_next_action',
        });

        expect(result.gatewayId).toBe('pi_no_next_action');
        expect(result.nextAction).toBeUndefined();
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot rewrite nested nextAction.redirectUrl via after-hook in-place mutation', async () => {
        const gatewayNextAction = {
            type: 'redirect',
            redirectUrl: 'https://hooks.stripe.com/3ds/real',
        };
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_nested_next_action',
                object: 'payment_intent',
                status: 'requires_action',
                amount: 5000,
                currency: 'usd',
                client_secret: 'pi_nested_next_action_secret',
                // Stripe passthrough: gateway maps next_action → nextAction as-is
                next_action: gatewayNextAction,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterCreatePayment: async (_ctx, result) => {
                    const na = result.nextAction as
                        | { redirectUrl?: string; type?: string }
                        | undefined;
                    if (na && typeof na === 'object') {
                        na.redirectUrl = 'https://evil.example/phish';
                        na.type = 'forged';
                    }
                    return {
                        proceed: true,
                        modifiedResult: {
                            ...result,
                            rawResponse: { annotated: true },
                        },
                    };
                },
            },
        });

        const result = await client.createPayment({
            amount: 50,
            currency: 'USD',
            callbackUrl: 'https://example.com/return',
        });

        expect(result.outcome).toBe('requires_action');
        expect(result.nextAction).toEqual(gatewayNextAction);
        expect(
            (result.nextAction as { redirectUrl?: string } | undefined)?.redirectUrl,
        ).toBe('https://hooks.stripe.com/3ds/real');
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot rewrite nested nextAction.redirect_to_url.url via after-hook (deep graph)', async () => {
        // CORE-1: Stripe multi-level next_action graph — one-level clone is not enough.
        const gatewayNextAction = {
            type: 'redirect_to_url',
            redirect_to_url: {
                url: 'https://hooks.stripe.com/3ds/real',
                return_url: 'https://example.com/return',
            },
        };
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_deep_next_action',
                object: 'payment_intent',
                status: 'requires_action',
                amount: 5000,
                currency: 'usd',
                client_secret: 'pi_deep_next_action_secret',
                next_action: gatewayNextAction,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterCreatePayment: async (_ctx, result) => {
                    const na = result.nextAction as
                        | {
                              type?: string;
                              redirect_to_url?: { url?: string; return_url?: string };
                          }
                        | undefined;
                    if (na?.redirect_to_url && typeof na.redirect_to_url === 'object') {
                        na.redirect_to_url.url = 'https://evil.example/phish';
                        na.redirect_to_url.return_url = 'https://evil.example/return';
                    }
                    // rawResponse alias path: Stripe shares next_action into intent.
                    // Mutating through rawResponse must not poison freeze either.
                    const raw = result.rawResponse as
                        | { next_action?: { redirect_to_url?: { url?: string } } }
                        | undefined;
                    if (raw?.next_action?.redirect_to_url) {
                        raw.next_action.redirect_to_url.url =
                            'https://evil.example/via-raw';
                    }
                    return {
                        proceed: true,
                        modifiedResult: {
                            ...result,
                            nextAction: {
                                type: 'redirect_to_url',
                                redirect_to_url: {
                                    url: 'https://evil.example/replaced',
                                    return_url: 'https://evil.example/return',
                                },
                            },
                            rawResponse: { annotated: true },
                        },
                    };
                },
            },
        });

        const result = await client.createPayment({
            amount: 50,
            currency: 'USD',
            callbackUrl: 'https://example.com/return',
        });

        expect(result.outcome).toBe('requires_action');
        expect(result.nextAction).toEqual(gatewayNextAction);
        expect(
            (
                result.nextAction as
                    | { redirect_to_url?: { url?: string } }
                    | undefined
            )?.redirect_to_url?.url,
        ).toBe('https://hooks.stripe.com/3ds/real');
        // Additive non-identity field still allowed
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot replace top-level redirectUrl via after-hook (customer redirect identity)', async () => {
        // CORE-2: merchants branch on result.redirectUrl for browser redirects.
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_redirect_url_guard',
                object: 'payment_intent',
                status: 'requires_action',
                amount: 5000,
                currency: 'usd',
                client_secret: 'pi_redirect_url_guard_secret',
                next_action: {
                    type: 'redirect_to_url',
                    redirect_to_url: {
                        url: 'https://hooks.stripe.com/3ds/real',
                        return_url: 'https://example.com/return',
                    },
                },
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterCreatePayment: async (_ctx, result) => {
                    (result as { redirectUrl?: string }).redirectUrl =
                        'https://evil.example/inplace';
                    return {
                        proceed: true,
                        modifiedResult: {
                            ...result,
                            redirectUrl: 'https://evil.example/phish',
                            rawResponse: { annotated: true },
                        },
                    };
                },
            },
        });

        const result = await client.createPayment({
            amount: 50,
            currency: 'USD',
            callbackUrl: 'https://example.com/return',
        });

        expect(result.outcome).toBe('requires_action');
        expect(result.redirectUrl).toBe('https://hooks.stripe.com/3ds/real');
        expect(result.redirectUrl).not.toBe('https://evil.example/phish');
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot invent top-level redirectUrl via after-hook when gateway omitted it', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_no_redirect',
                object: 'payment_intent',
                status: 'canceled',
                amount: 2000,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => ({
                    proceed: true,
                    modifiedResult: {
                        ...result,
                        redirectUrl: 'https://evil.example/forged-redirect',
                        rawResponse: { annotated: true },
                    },
                }),
            },
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_no_redirect',
        });

        expect(result.gatewayId).toBe('pi_no_redirect');
        // Stripe void mapping may leave redirectUrl undefined as a present key —
        // either absent or undefined is fine; forged phishing URL must not stick.
        expect(result.redirectUrl).toBeUndefined();
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot invent gatewayObjectId via after-hook when gateway omitted it', async () => {
        // CORE-3: secondary provider object id must not be forged for recon/routing.
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_no_goid',
                object: 'payment_intent',
                status: 'canceled',
                amount: 1500,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => ({
                    proceed: true,
                    modifiedResult: {
                        ...result,
                        gatewayObjectId: 'forged_gateway_object',
                        rawResponse: { annotated: true },
                    },
                }),
            },
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_no_goid',
        });

        expect(result.gatewayId).toBe('pi_no_goid');
        expect(result.gatewayObjectId).toBeUndefined();
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot rewrite gatewayObjectId via after-hook when gateway set it', async () => {
        // CORE-3 restore path: custom gateway that dual-writes gatewayObjectId.
        class FreezeIdGateway extends BaseGateway {
            readonly name = 'freezeid';

            constructor(hooks: HooksManager) {
                super({}, hooks, undefined, {
                    payments: true,
                    immediateCapture: true,
                    authorization: false,
                    partialCapture: false,
                    refunds: true,
                    partialRefunds: false,
                    voids: false,
                });
            }

            async createPayment(
                params: CreatePaymentParams,
            ): Promise<GatewayPaymentResult> {
                return this.executeWithHooks('createPayment', params, async () => ({
                    success: true,
                    outcome: 'requires_action' as const,
                    gatewayId: 'intent_real',
                    gatewayObjectId: 'obj_real_secondary',
                    status: 'pending' as const,
                    redirectUrl: 'https://provider.example/approve',
                    amount: params.amount,
                    nextAction: {
                        type: 'redirect_to_url',
                        redirect_to_url: {
                            url: 'https://provider.example/approve',
                            return_url: 'https://merchant.example/return',
                        },
                    },
                    rawResponse: {
                        next_action: {
                            type: 'redirect_to_url',
                            redirect_to_url: {
                                url: 'https://provider.example/approve',
                            },
                        },
                    },
                }));
            }

            async capturePayment(): Promise<GatewayPaymentResult> {
                throw new OperationNotSupportedError('capture', this.name);
            }

            async refundPayment(): Promise<GatewayRefundResult> {
                throw new OperationNotSupportedError('refund', this.name);
            }

            verifyWebhook(): boolean {
                return true;
            }

            parseWebhookEvent(payload: unknown): WebhookEvent {
                return {
                    id: 'evt_freeze',
                    type: 'payment_paid',
                    gateway: this.name,
                    paymentId: undefined,
                    gatewayPaymentId: 'intent_real',
                    status: 'paid',
                    timestamp: new Date(),
                    rawPayload: payload,
                };
            }
        }

        const client = createPaymentClient({
            gateways: {
                freezeid: {
                    name: 'freezeid',
                    manifest: { name: 'freezeid', displayName: 'Freeze ID Test' },
                    create(ctx: GatewayContext) {
                        return new FreezeIdGateway(ctx.hooks);
                    },
                },
            },
            defaultGateway: 'freezeid',
            hooks: {
                afterCreatePayment: async (_ctx, result) => {
                    (result as { gatewayObjectId?: string }).gatewayObjectId =
                        'forged_inplace';
                    (result as { redirectUrl?: string }).redirectUrl =
                        'https://evil.example/inplace';
                    const na = result.nextAction as
                        | { redirect_to_url?: { url?: string } }
                        | undefined;
                    if (na?.redirect_to_url) {
                        na.redirect_to_url.url = 'https://evil.example/nested';
                    }
                    return {
                        proceed: true,
                        modifiedResult: {
                            ...result,
                            gatewayObjectId: 'forged_object_id',
                            redirectUrl: 'https://evil.example/phish',
                            nextAction: {
                                type: 'redirect_to_url',
                                redirect_to_url: {
                                    url: 'https://evil.example/replaced',
                                },
                            },
                            rawResponse: { annotated: true },
                        },
                    };
                },
            },
        });

        const result = await client.createPayment({
            amount: 25,
            currency: 'USD',
            callbackUrl: 'https://merchant.example/return',
        });

        expect(result.gatewayId).toBe('intent_real');
        expect(result.gatewayObjectId).toBe('obj_real_secondary');
        expect(result.redirectUrl).toBe('https://provider.example/approve');
        expect(result.nextAction).toEqual({
            type: 'redirect_to_url',
            redirect_to_url: {
                url: 'https://provider.example/approve',
                return_url: 'https://merchant.example/return',
            },
        });
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot rewrite nested references.providerObjectId via after-hook in-place mutation', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_nested_refs',
                object: 'payment_intent',
                status: 'canceled',
                amount: 1500,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => {
                    if (result.references && typeof result.references === 'object') {
                        (
                            result.references as { providerObjectId?: string }
                        ).providerObjectId = 'forged_provider_object';
                        (
                            result.references as { normalizedStatus?: string }
                        ).normalizedStatus = 'paid';
                    }
                    return {
                        proceed: true,
                        modifiedResult: {
                            ...result,
                            rawResponse: { annotated: true },
                        },
                    };
                },
            },
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_nested_refs',
        });

        expect(result.gatewayId).toBe('pi_nested_refs');
        expect(result.references?.providerObjectId).toBe('pi_nested_refs');
        expect(result.references?.normalizedStatus).toBe('cancelled');
        expect(result.status).toBe('cancelled');
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot rewrite nested decline identity via after-hook in-place or replace', async () => {
        // CORE-1 (audit): decline is nested identity — shallow restore is not enough.
        // Hooks must not forge hard-fail vs soft-retry or customer-facing decline codes.
        const gatewayDecline = {
            code: 'card_declined',
            message: 'Your card was declined',
            providerCode: 'generic_decline',
            softDecline: false,
            raw: { network_status: 'declined_by_network' },
        };

        class DeclineFreezeGateway extends BaseGateway {
            readonly name = 'declinefreeze';

            constructor(hooks: HooksManager) {
                super({}, hooks, undefined, {
                    payments: true,
                    immediateCapture: true,
                    authorization: false,
                    partialCapture: false,
                    refunds: false,
                    partialRefunds: false,
                    voids: false,
                });
            }

            async createPayment(
                params: CreatePaymentParams,
            ): Promise<GatewayPaymentResult> {
                return this.executeWithHooks('createPayment', params, async () => ({
                    success: false,
                    outcome: 'declined' as const,
                    gatewayId: 'pi_declined_real',
                    status: 'failed' as const,
                    amount: params.amount,
                    decline: gatewayDecline,
                    rawResponse: { last_payment_error: { decline_code: 'generic_decline' } },
                }));
            }

            async capturePayment(): Promise<GatewayPaymentResult> {
                throw new OperationNotSupportedError('capture', this.name);
            }

            async refundPayment(): Promise<GatewayRefundResult> {
                throw new OperationNotSupportedError('refund', this.name);
            }

            verifyWebhook(): boolean {
                return true;
            }

            parseWebhookEvent(payload: unknown): WebhookEvent {
                return {
                    id: 'evt_decline_freeze',
                    type: 'payment_failed',
                    gateway: this.name,
                    paymentId: undefined,
                    gatewayPaymentId: 'pi_declined_real',
                    status: 'failed',
                    timestamp: new Date(),
                    rawPayload: payload,
                };
            }
        }

        const client = createPaymentClient({
            gateways: {
                declinefreeze: {
                    name: 'declinefreeze',
                    manifest: {
                        name: 'declinefreeze',
                        displayName: 'Decline Freeze Test',
                    },
                    create(ctx: GatewayContext) {
                        return new DeclineFreezeGateway(ctx.hooks);
                    },
                },
            },
            defaultGateway: 'declinefreeze',
            hooks: {
                afterCreatePayment: async (_ctx, result) => {
                    const d = result.decline as
                        | {
                              code?: string;
                              message?: string;
                              softDecline?: boolean;
                              raw?: { network_status?: string };
                          }
                        | undefined;
                    if (d && typeof d === 'object') {
                        d.code = 'insufficient_funds';
                        d.message = 'forged soft message';
                        d.softDecline = true;
                        if (d.raw && typeof d.raw === 'object') {
                            d.raw.network_status = 'forged_approved_for_retry';
                        }
                    }
                    return {
                        proceed: true,
                        modifiedResult: {
                            ...result,
                            decline: {
                                code: 'replaced_soft',
                                message: 'replaced entirely',
                                softDecline: true,
                                raw: { network_status: 'replaced' },
                            },
                            rawResponse: { annotated: true },
                        },
                    };
                },
            },
        });

        const result = await client.createPayment({
            amount: 10,
            currency: 'USD',
        });

        expect(result.outcome).toBe('declined');
        expect(result.success).toBe(false);
        expect(result.decline).toEqual(gatewayDecline);
        expect(result.decline?.code).toBe('card_declined');
        expect(result.decline?.softDecline).toBe(false);
        expect(
            (result.decline?.raw as { network_status?: string } | undefined)
                ?.network_status,
        ).toBe('declined_by_network');
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('cannot invent decline via after-hook when gateway omitted it', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_no_decline',
                object: 'payment_intent',
                status: 'canceled',
                amount: 2000,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => ({
                    proceed: true,
                    modifiedResult: {
                        ...result,
                        decline: {
                            code: 'forged_decline',
                            message: 'hook invented decline',
                            softDecline: false,
                        },
                        rawResponse: { annotated: true },
                    },
                }),
            },
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_no_decline',
        });

        expect(result.gatewayId).toBe('pi_no_decline');
        expect(result.outcome).toBe('succeeded');
        expect(result.decline).toBeUndefined();
        expect((result.rawResponse as { annotated?: boolean }).annotated).toBe(true);
    });

    it('restores money identity fields when after-hook mutates result in place', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_inplace_guard',
                object: 'payment_intent',
                status: 'canceled',
                amount: 1500,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async (_ctx, result) => {
                    // In-place mutation of the hook argument must not poison freeze
                    (result as { success: boolean }).success = false;
                    (result as { status: string }).status = 'paid';
                    (result as { gatewayId: string }).gatewayId = 'forged_inplace';
                    (result as { amount?: number }).amount = 0.01;
                    // Phase 6: outcome / references / reconciliation must not forge paid
                    (result as { outcome?: string }).outcome = 'succeeded';
                    (result as { reconciliationRequired?: boolean }).reconciliationRequired =
                        false;
                    (result as { references?: { providerObjectId: string } }).references = {
                        providerObjectId: 'forged_ref',
                    };
                    return { proceed: true, modifiedResult: result };
                },
            },
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_inplace_guard',
        });
        expect(result.success).toBe(true);
        expect(result.status).toBe('cancelled');
        expect(result.gatewayId).toBe('pi_inplace_guard');
        expect(result.amount).toBe(15);
        // Outcome dual-written by gateway (void → succeeded op, cancelled status)
        expect(result.outcome).toBe('succeeded');
        expect(result.references?.providerObjectId).toBe('pi_inplace_guard');
        expect(result.reconciliationRequired).toBeUndefined();
    });

    it('ignores null modifiedResult from after-hook and returns original gateway result', async () => {
        globalThis.fetch = mock(async () =>
            createMockResponse({
                id: 'pi_null_mod',
                object: 'payment_intent',
                status: 'canceled',
                amount: 2000,
                currency: 'usd',
                client_secret: null,
            }),
        ) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                afterVoid: async () => ({
                    proceed: true,
                    // Force a non-object modifiedResult
                    modifiedResult: null as unknown as never,
                }),
            },
        });

        const result = await client.voidPayment({
            gatewayPaymentId: 'pi_null_mod',
        });
        expect(result.success).toBe(true);
        expect(result.status).toBe('cancelled');
        expect(result.gatewayId).toBe('pi_null_mod');
        expect(result.amount).toBe(20);
    });
});

describe('PaymentClient webhook error isolation', () => {
    it('rethrows InvalidWebhookError even when onWebhookFailed throws', async () => {
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                onWebhookFailed: async () => {
                    throw new Error('hook secondary failure');
                },
            },
        });

        // Stripe verifyWebhook will fail without a valid signature
        try {
            await client.handleWebhook(
                'stripe',
                { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } },
                'invalid_sig',
            );
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidWebhookError);
            expect((error as Error).message).not.toMatch(/hook secondary/);
        }
    });

    it('continues verification when onWebhookReceived throws', async () => {
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test' },
            defaultGateway: 'stripe',
            hooks: {
                onWebhookReceived: async () => {
                    throw new Error('received-hook boom');
                },
            },
        });

        // Still fails closed on invalid signature — proves we reached verify after the hook threw
        try {
            await client.handleWebhook(
                'stripe',
                { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } },
                'invalid_sig',
            );
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidWebhookError);
            expect((error as Error).message).not.toMatch(/received-hook/);
        }
    });

    it('does not call onWebhookFailed for parse failures after successful verify', async () => {
        let onWebhookFailedCalled = false;
        const client = new PaymentClient({
            moyasar: {
                secretKey: 'sk_test_moyasar',
                webhookSecret: 'whsec_moyasar_test',
            },
            defaultGateway: 'moyasar',
            hooks: {
                onWebhookFailed: async () => {
                    onWebhookFailedCalled = true;
                },
            },
        });

        // secret_token matches → verify succeeds; missing data.id → parse throws.
        // WEBHOOKS-1: parse-after-verify is InvalidRequestError (not forgery).
        // card_auth_* is no longer a parse throw (NEW-MOYASAR-2).
        try {
            await client.handleWebhook('moyasar', {
                id: 'evt_malformed',
                type: 'payment_paid',
                created_at: '2024-01-01T00:00:00Z',
                secret_token: 'whsec_moyasar_test',
                data: {
                    status: 'paid',
                    amount: 100,
                    currency: 'SAR',
                },
            });
            expect.unreachable('should have thrown on parse');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidRequestError);
            expect(error).not.toBeInstanceOf(InvalidWebhookError);
            expect((error as Error).message).toMatch(/payload fields|missing data/i);
        }
        expect(onWebhookFailedCalled).toBe(false);
    });

    it('calls onWebhookFailed when verification fails', async () => {
        let onWebhookFailedCalled = false;
        const client = new PaymentClient({
            moyasar: {
                secretKey: 'sk_test_moyasar',
                webhookSecret: 'whsec_moyasar_test',
            },
            defaultGateway: 'moyasar',
            hooks: {
                onWebhookFailed: async () => {
                    onWebhookFailedCalled = true;
                },
            },
        });

        try {
            await client.handleWebhook('moyasar', {
                id: 'evt_bad',
                type: 'payment_paid',
                secret_token: 'wrong_token',
                data: { id: 'pay_1', status: 'paid', amount: 100, currency: 'SAR' },
            });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidWebhookError);
        }
        expect(onWebhookFailedCalled).toBe(true);
    });

    it('composed onWebhookVerified is fail-fast: second handler not run if first throws', async () => {
        let firstCalled = false;
        let secondCalled = false;
        const client = new PaymentClient({
            moyasar: {
                secretKey: 'sk_test_moyasar',
                webhookSecret: 'whsec_moyasar_test',
            },
            defaultGateway: 'moyasar',
            hooks: {
                onWebhookVerified: async () => {
                    firstCalled = true;
                    throw new Error('primary fulfillment failed');
                },
            },
        });

        client.addHook('onWebhookVerified', async () => {
            secondCalled = true;
        });

        try {
            await client.handleWebhook('moyasar', {
                id: 'evt_paid',
                type: 'payment_paid',
                created_at: '2024-01-01T00:00:00Z',
                secret_token: 'whsec_moyasar_test',
                data: {
                    id: 'pay_compose_1',
                    status: 'paid',
                    amount: 100,
                    currency: 'SAR',
                },
            });
            expect.unreachable('should have rethrown first handler error');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe('primary fulfillment failed');
        }
        expect(firstCalled).toBe(true);
        expect(secondCalled).toBe(false);
    });

    it('CORE-2: onWebhookVerified cannot rewrite verified status/amount/ids/stableType', async () => {
        const client = new PaymentClient({
            moyasar: {
                secretKey: 'sk_test_moyasar',
                webhookSecret: 'whsec_moyasar_test',
            },
            defaultGateway: 'moyasar',
            hooks: {
                onWebhookVerified: async (event) => {
                    event.status = 'failed';
                    event.amount = 1;
                    event.gatewayPaymentId = 'forged_pay';
                    event.stableType = 'payment.failed';
                    if (event.event && 'type' in event.event) {
                        (event.event as { type: string }).type = 'payment.failed';
                    }
                },
            },
        });

        const event = await client.handleWebhook('moyasar', {
            id: 'evt_paid_core2',
            type: 'payment_paid',
            created_at: '2024-01-01T00:00:00Z',
            secret_token: 'whsec_moyasar_test',
            data: {
                id: 'pay_core2',
                status: 'paid',
                amount: 5000,
                captured: 5000,
                currency: 'SAR',
            },
        });

        expect(event.status).toBe('paid');
        expect(event.gatewayPaymentId).toBe('pay_core2');
        expect(event.amount).toBe(50);
        expect(event.stableType).toBe('payment.succeeded');
        expect(event.event?.type).toBe('payment.succeeded');
    });
});

describe('PaymentClient construct-time credential validation', () => {
    it('throws InvalidRequestError when stripe.secretKey is empty', () => {
        expect(
            () =>
                new PaymentClient({
                    stripe: { secretKey: '' },
                }),
        ).toThrow(InvalidRequestError);

        try {
            new PaymentClient({ stripe: { secretKey: '   ' } });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidRequestError);
            expect((error as Error).message).toMatch(/stripe\.secretKey/i);
        }
    });

    it('throws InvalidRequestError when moyasar.secretKey is empty', () => {
        expect(
            () =>
                new PaymentClient({
                    moyasar: { secretKey: '' },
                }),
        ).toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError when paypal credentials are empty', () => {
        expect(
            () =>
                new PaymentClient({
                    paypal: { clientId: '', clientSecret: 'secret' },
                }),
        ).toThrow(InvalidRequestError);

        expect(
            () =>
                new PaymentClient({
                    paypal: { clientId: 'id', clientSecret: '  ' },
                }),
        ).toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError when paymob has neither secretKey nor apiKey', () => {
        expect(
            () =>
                new PaymentClient({
                    paymob: { publicKey: 'pk_test' },
                }),
        ).toThrow(InvalidRequestError);

        try {
            new PaymentClient({ paymob: { secretKey: '  ', apiKey: '' } });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidRequestError);
            expect((error as Error).message).toMatch(/paymob/i);
        }
    });

    it('allows paymob with only apiKey (legacy) or only secretKey', () => {
        expect(
            () =>
                new PaymentClient({
                    paymob: { apiKey: 'legacy_api_key' },
                }),
        ).not.toThrow();

        expect(
            () =>
                new PaymentClient({
                    paymob: { secretKey: 'sk_test_paymob' },
                }),
        ).not.toThrow();
    });
});

describe('PayPalCreatePaymentParamsSchema', () => {
    it('accepts returnUrl + cancelUrl without callbackUrl', () => {
        const parsed = PayPalCreatePaymentParamsSchema.safeParse({
            amount: 10,
            currency: 'USD',
            returnUrl: 'https://example.com/return',
            cancelUrl: 'https://example.com/cancel',
        });
        expect(parsed.success).toBe(true);
    });

    it('accepts callbackUrl alone (covers success + cancel fallback)', () => {
        const parsed = PayPalCreatePaymentParamsSchema.safeParse({
            amount: 10,
            currency: 'USD',
            callbackUrl: 'https://example.com/callback',
        });
        expect(parsed.success).toBe(true);
    });

    it('rejects when neither callbackUrl nor returnUrl is set', () => {
        const parsed = PayPalCreatePaymentParamsSchema.safeParse({
            amount: 10,
            currency: 'USD',
            cancelUrl: 'https://example.com/cancel',
        });
        expect(parsed.success).toBe(false);
    });
});

describe('idempotencyKey and Moyasar source schema guards', () => {
    it('rejects empty-string idempotencyKey on create/capture schemas', () => {
        const create = CreatePaymentParamsSchema.safeParse({
            amount: 10,
            currency: 'USD',
            callbackUrl: 'https://example.com/callback',
            idempotencyKey: '',
        });
        expect(create.success).toBe(false);

        const capture = CaptureParamsSchema.safeParse({
            gatewayPaymentId: 'pay_1',
            idempotencyKey: '',
        });
        expect(capture.success).toBe(false);
    });

    it('accepts omitted idempotencyKey', () => {
        const create = CreatePaymentParamsSchema.safeParse({
            amount: 10,
            currency: 'USD',
            callbackUrl: 'https://example.com/callback',
        });
        expect(create.success).toBe(true);
    });

    it('MoyasarCreatePaymentParamsSchema rejects raw creditcard source', () => {
        const parsed = MoyasarCreatePaymentParamsSchema.safeParse({
            amount: 10,
            currency: 'SAR',
            callbackUrl: 'https://example.com/callback',
            moyasarSource: {
                type: 'creditcard',
                name: 'John Doe',
                number: '4111111111111111',
                month: 12,
                year: 2030,
                cvc: '123',
            },
        });
        expect(parsed.success).toBe(false);
    });

    it('MoyasarCreatePaymentParamsSchema accepts token source', () => {
        const parsed = MoyasarCreatePaymentParamsSchema.safeParse({
            amount: 10,
            currency: 'SAR',
            callbackUrl: 'https://example.com/callback',
            moyasarSource: {
                type: 'token',
                token: 'token_abc',
            },
        });
        expect(parsed.success).toBe(true);
    });
});

describe('PaymentClient amount validation (finite)', () => {
    it('rejects Infinity/NaN amounts via createPayment validation path', async () => {
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123' },
            defaultGateway: 'stripe',
        });

        for (const amount of [Infinity, -Infinity, NaN]) {
            try {
                await client.createPayment({
                    amount,
                    currency: 'USD',
                    callbackUrl: 'https://example.com/callback',
                });
                expect.unreachable(`should reject amount=${amount}`);
            } catch (error) {
                expect(error).toBeInstanceOf(InvalidRequestError);
                expect((error as InvalidRequestError).code).toBe('INVALID_REQUEST');
            }
        }
    });

    it('rejects Infinity/NaN checkout session amounts', async () => {
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123' },
            defaultGateway: 'stripe',
        });
        const gw = client.gateway('stripe') as {
            createCheckoutSession: (params: {
                amount?: number;
                currency?: string;
                successUrl: string;
            }) => Promise<unknown>;
        };

        for (const amount of [Infinity, -Infinity, NaN]) {
            try {
                await gw.createCheckoutSession({
                    amount,
                    currency: 'USD',
                    successUrl: 'https://example.com/success',
                });
                expect.unreachable(`should reject checkout amount=${amount}`);
            } catch (error) {
                expect(error).toBeInstanceOf(InvalidRequestError);
            }
        }
    });

    it('rejects Infinity/NaN Moyasar split amounts', async () => {
        const client = new PaymentClient({
            moyasar: { secretKey: 'sk_test_moyasar' },
            defaultGateway: 'moyasar',
        });

        for (const amount of [Infinity, -Infinity, NaN]) {
            try {
                await client.createPayment({
                    amount: 10,
                    currency: 'SAR',
                    callbackUrl: 'https://example.com/callback',
                    moyasarSource: {
                        type: 'token',
                        token: 'token_test_abc',
                    },
                    // gateway-specific field accepted via passthrough / Moyasar schema
                    splits: [
                        {
                            amount,
                            recipient_id: '11111111-1111-1111-1111-111111111111',
                        },
                    ],
                } as never);
                expect.unreachable(`should reject split amount=${amount}`);
            } catch (error) {
                expect(error).toBeInstanceOf(InvalidRequestError);
            }
        }
    });

    it('rejects non-http(s) callback and checkout URLs (javascript:, data:, file:)', async () => {
        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123' },
            defaultGateway: 'stripe',
        });

        for (const url of [
            'javascript:alert(1)',
            'data:text/html,hi',
            'file:///etc/passwd',
        ]) {
            try {
                await client.createPayment({
                    amount: 10,
                    currency: 'USD',
                    callbackUrl: url,
                });
                expect.unreachable(`should reject callbackUrl=${url}`);
            } catch (error) {
                expect(error).toBeInstanceOf(InvalidRequestError);
            }
        }

        const gw = client.gateway('stripe') as {
            createCheckoutSession: (params: {
                amount: number;
                currency: string;
                successUrl: string;
                cancelUrl?: string;
            }) => Promise<unknown>;
        };

        try {
            await gw.createCheckoutSession({
                amount: 10,
                currency: 'USD',
                successUrl: 'javascript:alert(1)',
            });
            expect.unreachable('should reject javascript: successUrl');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidRequestError);
        }

        try {
            await gw.createCheckoutSession({
                amount: 10,
                currency: 'USD',
                successUrl: 'https://example.com/ok',
                cancelUrl: 'javascript:void(0)',
            });
            expect.unreachable('should reject javascript: cancelUrl');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidRequestError);
        }
    });
});

describe('PaymentClient PayPal webhooks', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = originalFetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should verify PayPal webhooks asynchronously when headers are passed', async () => {
        let verifyCalled = false;
        globalThis.fetch = mock(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : (input as Request).url;

            if (url.includes('oauth2/token')) {
                return createMockResponse({
                    access_token: 'test_token',
                    expires_in: 3600,
                });
            }

            if (url.includes('verify-webhook-signature')) {
                verifyCalled = true;
                return createMockResponse({ verification_status: 'SUCCESS' });
            }

            throw new Error(`Unexpected URL: ${url}`);
        }) as unknown as typeof fetch;

        const client = new PaymentClient({
            paypal: {
                clientId: 'paypal_client',
                clientSecret: 'paypal_secret',
                webhookId: 'WH123',
                sandbox: true,
            },
            defaultGateway: 'paypal',
        });

        const payload = {
            id: 'WH-event-123',
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            create_time: '2024-06-15T14:30:00Z',
            resource_type: 'capture',
            resource: {
                id: 'CAPTURE-123',
                status: 'COMPLETED',
                final_capture: true,
                amount: {
                    currency_code: 'USD',
                    value: '10.00',
                },
            },
        };

        // Fresh transmission_time — gateway rejects headers older than 15 minutes.
        const event = await client.handleWebhook('paypal', payload, {
            'PAYPAL-TRANSMISSION-ID': 'trans-123',
            'PAYPAL-TRANSMISSION-TIME': new Date().toISOString(),
            'PAYPAL-TRANSMISSION-SIG': 'signature',
            'PAYPAL-CERT-URL': 'https://api.paypal.com/cert',
            'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
        });

        expect(verifyCalled).toBe(true);
        expect(event.gateway).toBe('paypal');
        expect(event.gatewayPaymentId).toBe('CAPTURE-123');
        // Built-in gateway dual-write
        expect(event.event?.type).toBe('capture.completed');
        expect(event.stableType).toBe('capture.completed');
        expect(event.provider?.eventType).toBe('PAYMENT.CAPTURE.COMPLETED');
    });

    it('Phase 7: safety-net attaches PaymentEvent when custom gateway omits dual-write', async () => {
        const client = createPaymentClient({
            gateways: {
                custom: {
                    name: 'custom',
                    manifest: {
                        name: 'custom',
                        displayName: 'Custom',
                        version: '0.0.1',
                    },
                    create(ctx) {
                        return {
                            name: 'custom',
                            capabilities: {
                                createPayment: true,
                                capturePayment: false,
                                refundPayment: false,
                                voidPayment: false,
                                getPayment: false,
                                getPaymentStatus: false,
                                webhooks: true,
                                createCheckoutSession: false,
                            },
                            supports(cap: string) {
                                return cap === 'webhooks' || cap === 'createPayment';
                            },
                            async createPayment() {
                                throw new Error('unused');
                            },
                            async capturePayment() {
                                throw new Error('unused');
                            },
                            async refundPayment() {
                                throw new Error('unused');
                            },
                            verifyWebhook() {
                                return true;
                            },
                            parseWebhookEvent(payload: unknown) {
                                return {
                                    id: 'evt_custom_safety',
                                    type: 'payment_paid',
                                    gateway: 'custom',
                                    paymentId: 'pay_internal',
                                    gatewayPaymentId: 'gw_1',
                                    status: 'paid' as const,
                                    timestamp: new Date('2024-01-01T00:00:00.000Z'),
                                    rawPayload: payload,
                                };
                            },
                        };
                    },
                },
            },
            defaultGateway: 'custom',
        });

        let verifiedType: string | undefined;
        client.addHook('onWebhookVerified', async (event) => {
            verifiedType = event.event?.type;
        });

        const event = await client.handleWebhook('custom', {
            hello: true,
            signature: 'valid',
        });

        // Custom parse did not attach — client safety-net dual-writes
        expect(event.type).toBe('payment_paid'); // legacy preserved
        expect(event.event).toBeDefined();
        expect(event.event?.schemaVersion).toBe('1');
        // custom gateway → provider.unmapped (no native map) unless type already stable
        expect(event.event?.type).toBe('provider.unmapped');
        expect(event.provider?.eventType).toBe('payment_paid');
        expect(event.payloadHash).toBeDefined();
        // Hook sees dual-written event
        expect(verifiedType).toBe('provider.unmapped');
    });

    it('Phase 7: Moyasar handleWebhook dual-write preserves redaction + stable type', async () => {
        const client = new PaymentClient({
            moyasar: {
                secretKey: 'sk_test_moyasar',
                webhookSecret: 'whsec_moyasar_test',
            },
            defaultGateway: 'moyasar',
        });

        const event = await client.handleWebhook('moyasar', {
            id: 'wh_client_p7',
            type: 'payment_paid',
            created_at: '2024-01-01T00:00:00Z',
            secret_token: 'whsec_moyasar_test',
            live: false,
            data: {
                id: 'pay_moyasar_1',
                status: 'paid',
                amount: 10000,
                captured: 10000,
                currency: 'SAR',
                metadata: { paymentId: 'internal_1' },
            },
        });

        expect(event.type).toBe('payment_paid');
        expect(event.stableType).toBe('payment.succeeded');
        expect(event.event?.type).toBe('payment.succeeded');
        expect(event.provider?.eventType).toBe('payment_paid');
        expect(
            (event.rawPayload as Record<string, unknown>).secret_token,
        ).toBeUndefined();
        expect(event.payloadHash).toBeDefined();
    });
});

function createWebhookOnlyClient(
    name: 'custom' | 'stripe',
    parseWebhookEvent: (payload: unknown) => WebhookEvent,
    opts?: { verifyWebhook?: () => boolean | Promise<boolean> },
) {
    return createPaymentClient({
        gateways: {
            [name]: {
                name,
                manifest: {
                    name,
                    displayName: 'Webhook-only test gateway',
                    version: '0.0.1',
                },
                create() {
                    return {
                        name,
                        capabilities: {
                            createPayment: true,
                            capturePayment: false,
                            refundPayment: false,
                            voidPayment: false,
                            getPayment: false,
                            getPaymentStatus: false,
                            webhooks: true,
                            createCheckoutSession: false,
                        },
                        supports(cap: string) {
                            return cap === 'webhooks' || cap === 'createPayment';
                        },
                        async createPayment() {
                            throw new Error('unused');
                        },
                        async capturePayment() {
                            throw new Error('unused');
                        },
                        async refundPayment() {
                            throw new Error('unused');
                        },
                        verifyWebhook() {
                            return opts?.verifyWebhook
                                ? opts.verifyWebhook()
                                : true;
                        },
                        parseWebhookEvent,
                    };
                },
            },
        },
        defaultGateway: name,
    });
}

describe('PaymentClient handleWebhook safety-net (P610-SAFE-1)', () => {
    it('rebuilds dual-write when event.event fails isPaymentEvent', async () => {
        const client = createWebhookOnlyClient('custom', (payload) => ({
            id: 'evt_invalid_dual',
            type: 'payment_paid',
            gateway: 'custom',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'gw_1',
            status: 'paid',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
            // Present but not a v1 PaymentEvent — safety-net must rebuild.
            event: { type: 'payment.succeeded' } as WebhookEvent['event'],
        }));

        const event = await client.handleWebhook('custom', { hello: true });

        expect(event.event).toBeDefined();
        expect(event.event?.schemaVersion).toBe('1');
        expect(event.event?.type).toBe('provider.unmapped');
        expect(event.event).not.toEqual({ type: 'payment.succeeded' });
        expect(event.provider?.eventType).toBe('payment_paid');
        expect(event.payloadHash).toBeDefined();
    });

    it('rebuilds dual-write when event.event.schemaVersion !== 1', async () => {
        const client = createWebhookOnlyClient('custom', (payload) => ({
            id: 'evt_schema_v2',
            type: 'payment_paid',
            gateway: 'custom',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'gw_1',
            status: 'paid',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
            schemaVersion: '2' as unknown as '1',
            event: {
                schemaVersion: '2',
                type: 'payment.succeeded',
                provider: {
                    gateway: 'custom',
                    eventId: 'evt_schema_v2',
                    eventType: 'payment_paid',
                    occurredAt: '2024-01-01T00:00:00.000Z',
                    receivedAt: '2024-01-01T00:00:00.000Z',
                },
            } as unknown as WebhookEvent['event'],
        }));

        const event = await client.handleWebhook('custom', { hello: true });

        expect(event.schemaVersion).toBe('1');
        expect(event.event?.schemaVersion).toBe('1');
        expect(event.event?.type).toBe('provider.unmapped');
        expect(event.event?.type).not.toBe('payment.succeeded');
    });

    it('does not overwrite a valid schemaVersion-1 PaymentEvent', async () => {
        const client = createWebhookOnlyClient('custom', (payload) => ({
            id: 'evt_valid_dual',
            type: 'payment_paid',
            gateway: 'custom',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'gw_1',
            status: 'paid',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
            schemaVersion: '1',
            stableType: 'payment.succeeded',
            event: {
                schemaVersion: '1',
                type: 'payment.succeeded',
                payment: {
                    status: 'paid',
                    references: { gatewayPaymentId: 'gw_1' },
                },
                provider: {
                    gateway: 'custom',
                    eventId: 'evt_valid_dual',
                    eventType: 'payment_paid',
                    occurredAt: '2024-01-01T00:00:00.000Z',
                    receivedAt: '2024-01-01T00:00:00.000Z',
                },
            },
            provider: {
                gateway: 'custom',
                eventId: 'evt_valid_dual',
                eventType: 'payment_paid',
                occurredAt: '2024-01-01T00:00:00.000Z',
                receivedAt: '2024-01-01T00:00:00.000Z',
            },
        }));

        const event = await client.handleWebhook('custom', { hello: true });

        expect(event.event?.schemaVersion).toBe('1');
        expect(event.event?.type).toBe('payment.succeeded');
        expect(event.stableType).toBe('payment.succeeded');
    });

    it('P610-SAFE-1: incomplete-money stripe-like rebuild demotes payment.succeeded', async () => {
        const client = createWebhookOnlyClient('stripe', (payload) => ({
            id: 'evt_pi_incomplete',
            type: 'payment_intent.succeeded',
            gateway: 'stripe',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'pi_incomplete',
            status: 'processing',
            amount: 100,
            currency: 'USD',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
        }));

        let verifiedType: string | undefined;
        client.addHook('onWebhookVerified', async (hookEvent) => {
            verifiedType = hookEvent.event?.type;
        });

        const event = await client.handleWebhook('stripe', { hello: true });

        expect(event.type).toBe('payment_intent.succeeded');
        expect(event.status).toBe('processing');
        expect(event.event?.schemaVersion).toBe('1');
        expect(event.stableType).toBe('payment.processing');
        expect(event.event?.type).toBe('payment.processing');
        expect(event.stableType).not.toBe('payment.succeeded');
        expect(event.event?.type).not.toBe('payment.succeeded');
        expect(verifiedType).toBe('payment.processing');
    });

    it('P610-SAFE-1: incomplete-refund stripe-like rebuild demotes refund.completed', async () => {
        const client = createWebhookOnlyClient('stripe', (payload) => ({
            id: 'evt_refund_incomplete',
            type: 'refund.completed',
            gateway: 'stripe',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'pi_refund',
            status: 'refund_completed',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
        }));

        const event = await client.handleWebhook('stripe', { hello: true });

        expect(event.status).toBe('refund_completed');
        expect(event.event?.schemaVersion).toBe('1');
        expect(event.stableType).toBe('refund.pending');
        expect(event.event?.type).toBe('refund.pending');
        expect(event.stableType).not.toBe('refund.completed');
        expect(event.event?.type).not.toBe('refund.completed');
    });

    it('CORE-3: awaits a Promise returned from sync verifyWebhook', async () => {
        let resolved = false;
        const client = createWebhookOnlyClient(
            'custom',
            (payload) => ({
                id: 'evt_async_verify',
                type: 'payment_paid',
                gateway: 'custom',
                paymentId: 'pay_internal',
                gatewayPaymentId: 'gw_1',
                status: 'paid',
                timestamp: new Date('2024-01-01T00:00:00.000Z'),
                rawPayload: payload,
            }),
            {
                verifyWebhook: () =>
                    Promise.resolve().then(() => {
                        resolved = true;
                        return true;
                    }),
            },
        );

        const event = await client.handleWebhook('custom', { hello: true });
        expect(resolved).toBe(true);
        expect(event.id).toBe('evt_async_verify');
    });

    it('CORE-3: a false Promise from verifyWebhook is not treated as verified', async () => {
        const client = createWebhookOnlyClient(
            'custom',
            () => {
                throw new Error('parse must not run');
            },
            {
                verifyWebhook: () => Promise.resolve(false),
            },
        );

        await expect(client.handleWebhook('custom', { hello: true })).rejects.toBeInstanceOf(
            InvalidWebhookError,
        );
    });

    it('CORE-3: a rejected Promise from verifyWebhook is not treated as verified', async () => {
        const client = createWebhookOnlyClient(
            'custom',
            () => {
                throw new Error('parse must not run');
            },
            {
                verifyWebhook: () => Promise.reject(new Error('verify transport failed')),
            },
        );

        await expect(client.handleWebhook('custom', { hello: true })).rejects.toThrow(
            'verify transport failed',
        );
    });

    it.each([
        {
            gateway: 'stripe' as const,
            nativeType: 'payment_intent.succeeded',
            status: 'processing',
            expectedType: 'payment.processing',
        },
        {
            gateway: 'custom' as const,
            nativeType: 'payment_paid',
            status: 'authorized',
            expectedType: 'payment.authorized',
        },
        {
            gateway: 'custom' as const,
            nativeType: 'payment_paid',
            status: 'refunded',
            expectedType: 'payment.processing',
        },
        {
            gateway: 'custom' as const,
            nativeType: 'payment_paid',
            status: 'partially_refunded',
            expectedType: 'payment.processing',
        },
        {
            gateway: 'custom' as const,
            nativeType: 'payment_paid',
            status: 'pending',
            expectedType: 'payment.processing',
        },
        {
            gateway: 'custom' as const,
            nativeType: 'payment_paid',
            status: 'failed',
            expectedType: 'payment.failed',
        },
        {
            gateway: 'custom' as const,
            nativeType: 'payment_paid',
            status: 'cancelled',
            expectedType: 'payment.cancelled',
        },
        {
            gateway: 'custom' as const,
            nativeType: 'payment_paid',
            status: 'reversed',
            expectedType: 'payment.cancelled',
        },
    ])(
        'CORE-HW-1 / NEW-CORE-3: rematches complete v1 payment.succeeded + $status → $expectedType',
        async ({ gateway, nativeType, status, expectedType }) => {
            const eventId = `evt_full_v1_${status}`;
            const client = createWebhookOnlyClient(gateway, (payload) => ({
                id: eventId,
                type: nativeType,
                gateway,
                paymentId: 'pay_internal',
                gatewayPaymentId: 'gw_full',
                status,
                amount: 50,
                currency: 'USD',
                timestamp: new Date('2024-01-01T00:00:00.000Z'),
                rawPayload: payload,
                schemaVersion: '1',
                stableType: 'payment.succeeded',
                event: {
                    schemaVersion: '1',
                    type: 'payment.succeeded',
                    payment: {
                        status: 'paid',
                        amount: 50,
                        currency: 'USD',
                        references: { gatewayPaymentId: 'gw_full' },
                    },
                    provider: {
                        gateway,
                        eventId,
                        eventType: nativeType,
                        occurredAt: '2024-01-01T00:00:00.000Z',
                        receivedAt: '2024-01-01T00:00:00.000Z',
                    },
                },
                provider: {
                    gateway,
                    eventId,
                    eventType: nativeType,
                    occurredAt: '2024-01-01T00:00:00.000Z',
                    receivedAt: '2024-01-01T00:00:00.000Z',
                },
            }));

            const event = await client.handleWebhook(gateway, { hello: true });

            expect(event.status).toBe(status);
            expect(event.event?.type).toBe(expectedType);
            expect(event.stableType).toBe(expectedType);
            expect(event.event?.type).not.toBe('payment.succeeded');
            expect(
                event.event && 'payment' in event.event
                    ? event.event.payment?.status
                    : undefined,
            ).toBe(status);
        },
    );

    it('NEW-CORE-2: rematch payment.succeeded + processing overwrites nested payment.status', async () => {
        const client = createWebhookOnlyClient('stripe', (payload) => ({
            id: 'evt_nested_paid_lie',
            type: 'payment_intent.succeeded',
            gateway: 'stripe',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'pi_nested',
            status: 'processing',
            amount: 50,
            currency: 'USD',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
            schemaVersion: '1',
            stableType: 'payment.succeeded',
            event: {
                schemaVersion: '1',
                type: 'payment.succeeded',
                payment: {
                    status: 'paid',
                    amount: 50,
                    currency: 'USD',
                    references: { gatewayPaymentId: 'pi_nested' },
                },
                provider: {
                    gateway: 'stripe',
                    eventId: 'evt_nested_paid_lie',
                    eventType: 'payment_intent.succeeded',
                    occurredAt: '2024-01-01T00:00:00.000Z',
                    receivedAt: '2024-01-01T00:00:00.000Z',
                },
            },
            provider: {
                gateway: 'stripe',
                eventId: 'evt_nested_paid_lie',
                eventType: 'payment_intent.succeeded',
                occurredAt: '2024-01-01T00:00:00.000Z',
                receivedAt: '2024-01-01T00:00:00.000Z',
            },
        }));

        const event = await client.handleWebhook('stripe', { hello: true });

        expect(event.event?.type).toBe('payment.processing');
        expect(event.stableType).toBe('payment.processing');
        expect(event.status).toBe('processing');
        expect(
            event.event && 'payment' in event.event
                ? event.event.payment?.status
                : undefined,
        ).toBe('processing');
        expect(
            event.event && 'payment' in event.event
                ? event.event.payment?.status
                : undefined,
        ).not.toBe('paid');
    });

    it('NEW-CORE-3: rematch payment.succeeded + failed is not type-only succeeded', async () => {
        const client = createWebhookOnlyClient('custom', (payload) => ({
            id: 'evt_failed_type_lie',
            type: 'payment_paid',
            gateway: 'custom',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'gw_failed',
            status: 'failed',
            amount: 50,
            currency: 'USD',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
            schemaVersion: '1',
            stableType: 'payment.succeeded',
            event: {
                schemaVersion: '1',
                type: 'payment.succeeded',
                payment: {
                    status: 'paid',
                    amount: 50,
                    currency: 'USD',
                    references: { gatewayPaymentId: 'gw_failed' },
                },
                provider: {
                    gateway: 'custom',
                    eventId: 'evt_failed_type_lie',
                    eventType: 'payment_paid',
                    occurredAt: '2024-01-01T00:00:00.000Z',
                    receivedAt: '2024-01-01T00:00:00.000Z',
                },
            },
        }));

        const event = await client.handleWebhook('custom', { hello: true });

        expect(event.event?.type).toBe('payment.failed');
        expect(event.stableType).toBe('payment.failed');
        expect(event.event?.type).not.toBe('payment.succeeded');
        expect(event.status).toBe('failed');
        expect(
            event.event && 'payment' in event.event
                ? event.event.payment?.status
                : undefined,
        ).toBe('failed');
    });

    it('NEW-CORE-8: rematch capture.completed + partially_captured is not type-only completed', async () => {
        const client = createWebhookOnlyClient('custom', (payload) => ({
            id: 'evt_cap_partial',
            type: 'payment_captured',
            gateway: 'custom',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'gw_cap',
            status: 'partially_captured',
            amount: 50,
            currency: 'USD',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
            schemaVersion: '1',
            stableType: 'capture.completed',
            event: {
                schemaVersion: '1',
                type: 'capture.completed',
                capture: {
                    status: 'completed',
                    amount: 50,
                    currency: 'USD',
                    references: { gatewayPaymentId: 'gw_cap' },
                },
                payment: {
                    status: 'paid',
                    amount: 50,
                    currency: 'USD',
                    references: { gatewayPaymentId: 'gw_cap' },
                },
                provider: {
                    gateway: 'custom',
                    eventId: 'evt_cap_partial',
                    eventType: 'payment_captured',
                    occurredAt: '2024-01-01T00:00:00.000Z',
                    receivedAt: '2024-01-01T00:00:00.000Z',
                },
            },
            provider: {
                gateway: 'custom',
                eventId: 'evt_cap_partial',
                eventType: 'payment_captured',
                occurredAt: '2024-01-01T00:00:00.000Z',
                receivedAt: '2024-01-01T00:00:00.000Z',
            },
        }));

        const event = await client.handleWebhook('custom', { hello: true });

        expect(event.status).toBe('partially_captured');
        expect(event.event?.type).toBe('payment.processing');
        expect(event.stableType).toBe('payment.processing');
        expect(event.event?.type).not.toBe('capture.completed');
        expect(event.stableType).not.toBe('capture.completed');
        expect(
            event.event && 'payment' in event.event
                ? event.event.payment?.status
                : undefined,
        ).toBe('partially_captured');
    });

    it('NEW-CORE-8: rematch refund.completed + processing is not type-only completed', async () => {
        const client = createWebhookOnlyClient('custom', (payload) => ({
            id: 'evt_ref_processing',
            type: 'payment_refunded',
            gateway: 'custom',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'gw_ref',
            status: 'processing',
            amount: 25,
            currency: 'USD',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
            schemaVersion: '1',
            stableType: 'refund.completed',
            event: {
                schemaVersion: '1',
                type: 'refund.completed',
                refund: {
                    status: 'completed',
                    amount: 25,
                    currency: 'USD',
                    references: { gatewayPaymentId: 'gw_ref' },
                },
                provider: {
                    gateway: 'custom',
                    eventId: 'evt_ref_processing',
                    eventType: 'payment_refunded',
                    occurredAt: '2024-01-01T00:00:00.000Z',
                    receivedAt: '2024-01-01T00:00:00.000Z',
                },
            },
            provider: {
                gateway: 'custom',
                eventId: 'evt_ref_processing',
                eventType: 'payment_refunded',
                occurredAt: '2024-01-01T00:00:00.000Z',
                receivedAt: '2024-01-01T00:00:00.000Z',
            },
        }));

        const event = await client.handleWebhook('custom', { hello: true });

        expect(event.status).toBe('processing');
        expect(event.event?.type === 'refund.pending' || event.event?.type === 'payment.processing').toBe(true);
        expect(event.stableType === 'refund.pending' || event.stableType === 'payment.processing').toBe(true);
        expect(event.event?.type).not.toBe('refund.completed');
        expect(event.stableType).not.toBe('refund.completed');
    });

    it('CORE-4: thin 3-field PaymentEvent is rebuilt and demoted', async () => {
        const client = createWebhookOnlyClient('stripe', (payload) => ({
            id: 'evt_thin_dual',
            type: 'payment_intent.succeeded',
            gateway: 'stripe',
            paymentId: 'pay_internal',
            gatewayPaymentId: 'pi_thin',
            status: 'processing',
            amount: 100,
            currency: 'USD',
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            rawPayload: payload,
            event: {
                schemaVersion: '1',
                type: 'payment.succeeded',
                provider: {},
            } as WebhookEvent['event'],
        }));

        const event = await client.handleWebhook('stripe', { hello: true });

        expect(event.event?.schemaVersion).toBe('1');
        expect(event.event?.type).not.toBe('payment.succeeded');
        expect(event.event?.type).toBe('payment.processing');
        expect(event.stableType).toBe('payment.processing');
    });
});
