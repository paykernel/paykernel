/**
 * Phase 22.4 — marketplace capability group (types only).
 *
 * Create-time splits are the only claimed first-class surface today
 * (`marketplaceSplits`, Moyasar `splits` on createPayment). Transfers,
 * payouts, connected-account onboarding, and reversals are vocabulary
 * until an adapter implements them. This is not a publishable package.
 */

import type { PayoutStatus, TransferStatus } from "./domain-status";
import type { AmountInput } from "./payment.types";
import type { ProviderReferences } from "./provider-refs";

export type { MoyasarPaymentSplit } from "./payment.types";
export type { PayoutStatus, TransferStatus } from "./domain-status";

/**
 * Generic create-time split instruction. Provider adapters map this onto
 * native payloads (Moyasar uses {@link MoyasarPaymentSplit} / `recipient_id`).
 */
export type MarketplaceSplit = {
  amount: AmountInput;
  destination: string;
  reference?: string;
  description?: string;
};

export type Transfer = {
  status: TransferStatus | string;
  amount?: number;
  currency?: string;
  references: ProviderReferences;
  rawResponse?: unknown;
};

export type Payout = {
  status: PayoutStatus | string;
  amount?: number;
  currency?: string;
  references: ProviderReferences;
  rawResponse?: unknown;
};
