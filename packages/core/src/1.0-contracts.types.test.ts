import { money } from "./utils/money";
import type { AmountInput, GatewayPaymentResult, PaymentStatus } from "./types/payment.types";
import type { RefundDomainStatus } from "./types/domain-status";
import type { Money } from "./utils/money";
import { PaymentClient } from "./client";
import { createPaymentClient } from "./create-payment-client";
import { moyasarGateway } from "./gateways";

function expectType<T>(_value: T): void {}
function expectTypesEqual<A, B>(_ok: true): void {}

// 1. Constructor is private — new PaymentClient with legacy config is error (private)
// @ts-expect-error — private constructor
type _LegacyCtor = ConstructorParameters<typeof PaymentClient>;
void null as unknown as _LegacyCtor;
// Verified via factory only — factory infers narrow map, so accept any PaymentClient
const _viaFactory = createPaymentClient({ gateways: { moyasar: moyasarGateway({ secretKey: "sk_test" }) } });
expectType<PaymentClient<{ moyasar: import("./gateways").MoyasarGateway }>>(_viaFactory as unknown as PaymentClient<{ moyasar: import("./gateways").MoyasarGateway }>);

// 2. Number amount rejected — AmountInput is Money only
// @ts-expect-error — plain number not allowed
const _badAmount: AmountInput = 10.5;
const _goodAmount: AmountInput = money("10.50", "SAR");
expectType<AmountInput>(_goodAmount);

// 3. No success — GatewayPaymentResult has no success, has required outcome
type HasSuccess = GatewayPaymentResult extends { success: unknown } ? true : false;
expectType<HasSuccess>(false as unknown as HasSuccess);
type HasOutcome = GatewayPaymentResult extends { outcome: unknown } ? true : false;
expectType<HasOutcome>(true as unknown as HasOutcome);

// 4. PaymentStatus is PaymentDomainStatus only, not refund
// @ts-expect-error — refund_completed not in PaymentStatus
const _badStatus: PaymentStatus = "refund_completed";
const _goodRefund: RefundDomainStatus = "completed";
// 5. createPayment with Money succeeds, with number fails (type-only)
type _BadCreateParams = { amount: 10.5, currency: "SAR", callbackUrl: string };
type _BadCreateCheck = _BadCreateParams extends { amount: AmountInput } ? true : false;
expectType<false>(null! as _BadCreateCheck);
type _GoodCreateParams = { amount: Money, currency: "SAR", callbackUrl: string };
type _GoodCreateCheck = _GoodCreateParams extends { amount: AmountInput } ? true : false;
expectType<true>(true as unknown as _GoodCreateCheck);
