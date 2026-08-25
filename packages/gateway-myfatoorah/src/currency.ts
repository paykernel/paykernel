/**
 * MyFatoorah V2 aliases: official samples use "KD" for KWD and "SR" for SAR
 * (including dotted variants `K.D.`/`S.R.`). Webhook `Data.Amount` is base
 * currency (e.g. KWD) and may use `KD` — normalized here and in
 * `webhook-map.ts:webhookMoneyFromAmountRecord` which prefers base → display → pay.
 * See `docs/money.md` MF-WEBHOOK-MONEY-DRIFT and `docs/status-mapping.md`.
 */
const MYFATOORAH_CURRENCY_ALIASES: Record<string, string> = {
  KD: "KWD",
  "K.D.": "KWD",
  "K.D": "KWD",
  "KD.": "KWD",
  "K.D..": "KWD",
  SR: "SAR",
  "S.R.": "SAR",
  "S.R": "SAR",
  "SR.": "SAR",
  "S.R..": "SAR",
};

const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Normalize a provider currency token to ISO 4217, or undefined when unusable. Handles `KD`/`SR` aliases and dotted variants. */
export function normalizeMyFatoorahCurrency(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length === 0) return undefined;
  const aliased = MYFATOORAH_CURRENCY_ALIASES[trimmed] ?? trimmed;
  if (aliased.length !== 3 || !CURRENCY_CODE.test(aliased)) return undefined;
  return aliased;
}
