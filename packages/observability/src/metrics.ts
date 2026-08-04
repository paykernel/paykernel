/**
 * Phase 20.3 — portable payment metrics (counters + histograms).
 *
 * Attribute values must be non-sensitive primitives only. Never pass secrets,
 * card data, tokens, raw payloads, or PII as metric labels.
 */

/** Safe metric label bag — string | number | boolean only. */
export type MetricAttributes = Record<string, string | number | boolean>;

export type Counter = {
  add(value: number, attributes?: MetricAttributes): void;
};

export type Histogram = {
  record(value: number, attributes?: MetricAttributes): void;
};

/**
 * Stable metric instrument names for dashboards and bridges.
 * Prefer these over ad-hoc strings when emitting outside this package.
 */
export const METRIC_NAMES = {
  operationOutcomes: "payments.operation.outcomes",
  providerLatencyMs: "payments.provider.latency_ms",
  rateLimits: "payments.provider.rate_limits",
  retries: "payments.operation.retries",
  webhookDuplicates: "payments.webhook.duplicates",
  payloadConflicts: "payments.webhook.payload_conflicts",
  handlerFailures: "payments.webhook.handler_failures",
  expiredLeases: "payments.store.expired_leases",
  reclaimedLeases: "payments.store.reclaimed_leases",
  reconciliationDrift: "payments.reconciliation.drift",
  indeterminateOperations: "payments.operation.indeterminate",
  adapterLatencyMs: "payments.adapter.latency_ms",
  adapterErrors: "payments.adapter.errors",
} as const;

export type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];

/**
 * Payment-domain metrics surface (20.3).
 *
 * Labels (when applicable):
 * - operationOutcomes: gateway, operationType, outcome
 * - providerLatencyMs: gateway, operationType
 * - rateLimits: gateway
 * - retries: gateway, operationType
 * - adapterLatencyMs: adapter, operation
 * - adapterErrors: adapter, errorKind
 */
export type PaymentMetrics = {
  operationOutcomes: Counter;
  providerLatencyMs: Histogram;
  rateLimits: Counter;
  retries: Counter;
  webhookDuplicates: Counter;
  payloadConflicts: Counter;
  handlerFailures: Counter;
  expiredLeases: Counter;
  reclaimedLeases: Counter;
  reconciliationDrift: Counter;
  indeterminateOperations: Counter;
  adapterLatencyMs: Histogram;
  adapterErrors: Counter;
};

/** One recorded counter/histogram sample (in-memory registry). */
export type MetricSample = {
  name: string;
  kind: "counter" | "histogram";
  value: number;
  attributes?: MetricAttributes;
};

export type MetricsSnapshot = {
  samples: readonly MetricSample[];
  /** Sum of counter values keyed by instrument name (all attributes combined). */
  counters: Readonly<Record<string, number>>;
  /** All histogram observations keyed by instrument name. */
  histograms: Readonly<Record<string, readonly number[]>>;
};

const COUNTER_KEYS = [
  "operationOutcomes",
  "rateLimits",
  "retries",
  "webhookDuplicates",
  "payloadConflicts",
  "handlerFailures",
  "expiredLeases",
  "reclaimedLeases",
  "reconciliationDrift",
  "indeterminateOperations",
  "adapterErrors",
] as const satisfies ReadonlyArray<keyof PaymentMetrics>;

const HISTOGRAM_KEYS = [
  "providerLatencyMs",
  "adapterLatencyMs",
] as const satisfies ReadonlyArray<keyof PaymentMetrics>;

export type InMemoryPaymentMetrics = PaymentMetrics & {
  /** Test / debug helper — full sample list + aggregated views. */
  snapshot(): MetricsSnapshot;
  /** Reset all recorded samples (tests). */
  reset(): void;
};

function cloneAttributes(
  attributes?: MetricAttributes,
): MetricAttributes | undefined {
  if (attributes === undefined) return undefined;
  return { ...attributes };
}

function createNoopCounter(): Counter {
  return {
    add(_value: number, _attributes?: MetricAttributes): void {
      /* no-op */
    },
  };
}

function createNoopHistogram(): Histogram {
  return {
    record(_value: number, _attributes?: MetricAttributes): void {
      /* no-op */
    },
  };
}

/** No-op metrics for production defaults and disabled instrumentation. */
export function createNoopPaymentMetrics(): PaymentMetrics {
  return {
    operationOutcomes: createNoopCounter(),
    providerLatencyMs: createNoopHistogram(),
    rateLimits: createNoopCounter(),
    retries: createNoopCounter(),
    webhookDuplicates: createNoopCounter(),
    payloadConflicts: createNoopCounter(),
    handlerFailures: createNoopCounter(),
    expiredLeases: createNoopCounter(),
    reclaimedLeases: createNoopCounter(),
    reconciliationDrift: createNoopCounter(),
    indeterminateOperations: createNoopCounter(),
    adapterLatencyMs: createNoopHistogram(),
    adapterErrors: createNoopCounter(),
  };
}

/**
 * In-memory metrics registry for tests and local sink adapters.
 * Not a production time-series backend — use as a bridge target or test double.
 */
export function createInMemoryPaymentMetrics(): InMemoryPaymentMetrics {
  const samples: MetricSample[] = [];

  function counter(name: string): Counter {
    return {
      add(value: number, attributes?: MetricAttributes): void {
        const sample: MetricSample = {
          name,
          kind: "counter",
          value,
        };
        const attrs = cloneAttributes(attributes);
        if (attrs !== undefined) {
          sample.attributes = attrs;
        }
        samples.push(sample);
      },
    };
  }

  function histogram(name: string): Histogram {
    return {
      record(value: number, attributes?: MetricAttributes): void {
        const sample: MetricSample = {
          name,
          kind: "histogram",
          value,
        };
        const attrs = cloneAttributes(attributes);
        if (attrs !== undefined) {
          sample.attributes = attrs;
        }
        samples.push(sample);
      },
    };
  }

  const metrics: InMemoryPaymentMetrics = {
    operationOutcomes: counter(METRIC_NAMES.operationOutcomes),
    providerLatencyMs: histogram(METRIC_NAMES.providerLatencyMs),
    rateLimits: counter(METRIC_NAMES.rateLimits),
    retries: counter(METRIC_NAMES.retries),
    webhookDuplicates: counter(METRIC_NAMES.webhookDuplicates),
    payloadConflicts: counter(METRIC_NAMES.payloadConflicts),
    handlerFailures: counter(METRIC_NAMES.handlerFailures),
    expiredLeases: counter(METRIC_NAMES.expiredLeases),
    reclaimedLeases: counter(METRIC_NAMES.reclaimedLeases),
    reconciliationDrift: counter(METRIC_NAMES.reconciliationDrift),
    indeterminateOperations: counter(METRIC_NAMES.indeterminateOperations),
    adapterLatencyMs: histogram(METRIC_NAMES.adapterLatencyMs),
    adapterErrors: counter(METRIC_NAMES.adapterErrors),
    snapshot(): MetricsSnapshot {
      const counters: Record<string, number> = {};
      const histograms: Record<string, number[]> = {};
      for (const s of samples) {
        if (s.kind === "counter") {
          counters[s.name] = (counters[s.name] ?? 0) + s.value;
        } else {
          const list = histograms[s.name] ?? [];
          list.push(s.value);
          histograms[s.name] = list;
        }
      }
      return {
        samples: samples.map((s) => {
          const copy: MetricSample = {
            name: s.name,
            kind: s.kind,
            value: s.value,
          };
          if (s.attributes !== undefined) {
            copy.attributes = { ...s.attributes };
          }
          return copy;
        }),
        counters,
        histograms,
      };
    },
    reset(): void {
      samples.length = 0;
    },
  };

  return metrics;
}

/** All PaymentMetrics instrument property names (for exhaustiveness tests). */
export const PAYMENT_METRICS_KEYS = [
  ...COUNTER_KEYS,
  ...HISTOGRAM_KEYS,
] as const;
