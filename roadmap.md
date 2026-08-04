# `@paykernel/core` Implementation Roadmap

**Document status:** final reviewed implementation plan  
**Primary executor:** Codex  
**Target:** production-grade `1.0.0` architecture  
**Last architectural review:** 2026-08-02

---

## 1. Document Purpose

This document defines the staged implementation plan for evolving `@paykernel/core` from a closed multi-gateway wrapper into a type-safe, extensible payment orchestration toolkit for TypeScript and modern server runtimes.

The roadmap is deliberately ordered. Codex must establish stable contracts, conformance tests, money safety, runtime portability, and durable processing semantics before adding more payment providers or higher-level features.

Codex must implement one phase at a time, keep the repository buildable after every coherent change, and avoid combining unrelated breaking changes in one pull request or commit.

---

## 2. Product Direction

### 2.1 Target Positioning

> A type-safe payment orchestration toolkit for TypeScript, built for MENA payment gateways and modern server runtimes.

The project should prioritize:

- Payment correctness and money safety.
- Extensible gateway plugins without modifying the core package.
- Strong normalized contracts without hiding provider-specific capabilities.
- Verified, typed, idempotent webhook processing.
- Recovery from timeouts, missing webhooks, duplicated events, and state drift.
- Node.js, Bun, Deno, and Cloudflare Workers compatibility.
- MENA-first provider coverage.
- Low dependency count and framework independence.
- Explicit consistency and atomicity guarantees.
- Excellent testing utilities for SDK contributors and application developers.
- Storage adapters that can be selected according to the deployment model.

### 2.2 Non-Goals

The following concerns must remain outside the core payment SDK:

- Subscription plans, entitlements, usage limits, proration, and billing schedules.
- Full merchant-of-record abstractions.
- Application-specific order fulfillment.
- A required database, ORM, queue, or scheduler.
- Storing raw card details or handling PCI-sensitive card data directly.
- Automatically retrying or routing an indeterminate payment to another gateway.
- Pretending that all providers expose equivalent payment semantics.
- Promising exactly-once delivery or execution across distributed systems.

Subscription lifecycle logic belongs in `@abshahin/subscriptions`, which may depend on stable payment interfaces exposed by this project.

---

## 3. Architectural Review Decisions

The following decisions supersede earlier broad or ambiguous proposals.

### 3.1 Do Not Publish One Generic `adapter-cloudflare` Package

Cloudflare D1 and SQLite-backed Durable Objects have different coordination, routing, storage, and deployment models. They must be separate packages:

```text
@paykernel/store-d1
@paykernel/store-durable-objects
```

### 3.2 Do Not Treat Every SQLite Product as the Same Runtime

The project should share schema and behavior where possible, but expose distinct bindings for:

- Bun native SQLite via `bun:sqlite`.
- Node built-in SQLite via `node:sqlite`.
- `better-sqlite3`.
- Turso remote/serverless clients.
- Legacy/battle-tested libSQL clients.
- Cloudflare D1.
- SQLite-backed Durable Objects.

D1 and Durable Objects must not be hidden behind the local SQLite adapter because their remote execution and consistency semantics differ materially.

### 3.3 Prefer Atomic Single-Statement Claims

For webhook inbox and idempotency records, prefer one conditional write statement that claims or renews a lease atomically. Use a multi-statement transaction only when a single statement cannot express the invariant.

This reduces race conditions and makes implementations portable across PostgreSQL, SQLite, D1, Turso, and other relational engines.

### 3.4 Separate Contracts from Driver Bindings

Domain packages define contracts. Adapter packages implement them.

Examples:

- `core` owns payment mutation idempotency contracts.
- `webhooks` owns webhook inbox contracts.
- `reconciliation` owns reconciliation persistence contracts.
- storage packages implement one or more contracts explicitly.

Do not create a vague universal repository interface that hides required atomicity.

### 3.5 Each Adapter Must Declare Its Guarantees

Every adapter must publish a manifest containing at least:

- supported store contracts.
- atomic claim strategy.
- consistency model.
- transaction behavior.
- supported runtimes.
- retention support.
- cleanup support.
- known deployment limitations.
- whether it is safe for multi-process or multi-region use.

### 3.6 Redis Is Not Automatically the Best Audit Store

Redis is excellent for atomic claims, leases, rate limits, and idempotency. It may be unsuitable as the only long-term audit store unless persistence, retention, and operational policies are configured deliberately.

Applications may use Redis for coordination and PostgreSQL, D1, or Turso for durable history.

### 3.7 Local SQLite Is a Single-Host Default

Bun SQLite, Node SQLite, and `better-sqlite3` are suitable for:

- local development.
- tests.
- desktop or embedded deployments.
- a single persistent server or container with durable disk.
- low-to-moderate write concurrency.

They must not be advertised as a shared distributed lock across multiple hosts or ephemeral serverless instances.

### 3.8 Redis Is Optional Infrastructure

The SDK must not require Redis for webhook inboxes, idempotency, or reconciliation.

PostgreSQL, D1, Turso, Durable Objects, and correctly deployed local SQLite adapters may satisfy the required contracts without Redis. Redis should be selected only when at least one of the following is true:

- the application already operates Redis or Valkey.
- very low-latency distributed claims and leases are valuable.
- high write concurrency makes database-backed coordination undesirable.
- native TTLs, atomic scripts, counters, or sorted-set scheduling materially simplify operations.
- a coordination store is intentionally separated from a durable relational audit store.

The default recommendation must remain: do not introduce Redis solely because this SDK supports it.

---

## 4. Mandatory Engineering Rules

Codex must follow these rules throughout the roadmap:

1. **Tests are the source of truth.** Every behavior change must be covered by unit, contract, integration, fault-injection, or type-level tests.
2. **No unsafe mutation retries.** A mutation may only be retried when the provider offers native idempotency or the SDK has an atomic deduplication mechanism.
3. **Never convert an uncertain outcome into a failure.** Timeouts and connection loss after request submission may produce an `indeterminate` result requiring reconciliation.
4. **Do not hide provider differences.** Normalize common behavior, but expose capabilities and provider-specific extensions explicitly.
5. **No secret leakage.** Logging, thrown errors, fixtures, snapshots, stored inbox errors, and telemetry must redact secrets and sensitive personal data.
6. **No framework coupling in core packages.** Framework integrations must live in optional packages.
7. **No Node-only assumptions in portable packages.** Use Web APIs or injectable runtime abstractions where possible.
8. **Keep backward compatibility during the `0.x` migration where practical.** Add deprecations before removal. Reserve major contract cleanup for `1.0.0`.
9. **Every phase must end with passing typecheck, tests, build, package validation, and documentation updates.**
10. **Do not add a new gateway before the plugin and conformance architecture is complete.**
11. **Atomicity must be implemented by the storage engine, not by process-local JavaScript checks.** A `get()` followed by `set()` is not an atomic claim.
12. **No `await` inside synchronous SQLite transactions.** Bun SQLite, Node SQLite, and `better-sqlite3` transaction callbacks must remain synchronous.
13. **Use prepared statements.** Do not interpolate values into SQL strings.
14. **Do not store raw provider payloads by default.** Persist normalized envelopes or hashes unless the application opts into encrypted raw storage.
15. **Store timestamps and identifiers portably.** Avoid database-specific numeric behavior that can lose 64-bit precision in JavaScript.
16. **Every adapter must pass the same conformance suite.** Driver-specific tests are additional, not replacements.
17. **Every adapter must document crash boundaries.** Specifically document what happens if a process crashes before or after an external side effect and before completion persistence.
18. **Do not acknowledge failed webhook work silently.** The selected acknowledgment and retry policy must be explicit.
19. **Never make schema migrations execute automatically in production without an explicit application decision.**

---

## 5. Proposed Repository Structure

Convert the repository into a Bun workspace monorepo while keeping the current public package name stable.

```text
payments-sdk/
├── apps/
│   └── docs/                                # Optional documentation site
├── packages/
│   ├── core/                                # @paykernel/core
│   ├── testkit/                             # @paykernel/testkit
│   ├── webhooks/                            # @paykernel/webhooks
│   ├── reconciliation/                      # @paykernel/reconciliation
│   ├── observability/                       # Optional telemetry package
│   │
│   ├── adapter-postgres/                    # PostgreSQL stores and driver bindings
│   ├── adapter-redis/                       # Redis, Valkey, Bun Redis, and Upstash bindings
│   ├── adapter-sqlite/                      # Local SQLite bindings
│   ├── adapter-turso/                       # Turso serverless/libSQL bindings
│   ├── adapter-cloudflare-d1/               # D1-specific implementation
│   ├── adapter-cloudflare-do/               # SQLite-backed Durable Object implementation
│   │
│   ├── gateway-stripe/                      # Extract only after plugin API stabilizes
│   ├── gateway-moyasar/
│   ├── gateway-paypal/
│   └── gateway-paymob/
│
├── internal/
│   ├── sql-store/                           # Private shared SQL statements/schema helpers
│   ├── adapter-conformance/                 # Private adapter test harness utilities
│   └── test-fixtures/
│
├── examples/
│   ├── bun-hono-postgres/
│   ├── bun-hono-redis/
│   ├── bun-hono-sqlite/
│   ├── node-express-postgres/
│   ├── node-better-sqlite3/
│   ├── turso-hono/
│   ├── cloudflare-d1/
│   ├── cloudflare-durable-object/
│   └── deno/
│
├── package.json
├── bun.lock
└── tsconfig.base.json
```

### 5.1 Package Boundary Rules

- `core` must not depend on adapters, ORMs, framework packages, or provider browser SDKs.
- `testkit` may depend on `core`, `webhooks`, and `reconciliation` for conformance helpers.
- `webhooks` may depend on stable event types from `core`.
- `reconciliation` may depend on normalized payment snapshot contracts from `core`.
- adapter packages may depend on the contracts they implement.
- driver dependencies must be optional peer dependencies or isolated subpath exports.
- importing `@paykernel/store-sqlite` must not import `bun:sqlite`, `node:sqlite`, or native modules automatically.
- Cloudflare packages must not leak Workers-only imports into Node, Bun, or Deno bundles.
- private `internal/*` workspaces must not be published.

---

# Phase 0 — Baseline, Audit, and Safety Net

## Objective

Create a verified baseline before architectural changes. Preserve current behavior and document existing public contracts.

## Tasks

### 0.1 Capture the Current Public API

- Generate and commit an API report for exported types and runtime symbols.
- Record current package entry points and declaration output.
- Add type-level tests for important public usage patterns.
- Add regression tests for all current gateway operations.
- Record current bundle size and package contents.

### 0.2 Establish Coverage Boundaries

Add meaningful coverage thresholds for:

- client orchestration.
- hook execution and isolation.
- retry and idempotency utilities.
- currency conversion.
- error mapping.
- webhook verification and normalization.
- every built-in gateway.
- security-sensitive branches.

Do not chase 100% line coverage blindly. Require meaningful branch coverage for payment state transitions and failure paths.

### 0.3 Add Package Validation

Add CI commands for:

- `bun run typecheck`.
- `bun test`.
- `bun run build`.
- package inspection through `npm pack`.
- `publint`.
- `@arethetypeswrong/cli`.
- installing the packed tarball into temporary consumer projects.
- importing the package in Node and Bun.

### 0.4 Document Existing Behavioral Contracts

Document:

- operations safe to retry.
- IDs required for capture, void, and refund per provider.
- webhooks requiring raw request bodies.
- terminal and non-terminal statuses.
- after-hooks that cannot roll back provider-side effects.
- outcomes that may be indeterminate.
- current runtime assumptions.

## Acceptance Criteria

- Existing tests pass without behavior changes.
- A public API baseline exists.
- CI validates the packed package.
- Current provider behavior is documented sufficiently to detect regressions.

---

# Phase 1 — Workspace and Package Boundaries

## Objective

Prepare the project for optional packages without changing public runtime behavior.

## Tasks

### 1.1 Convert to Bun Workspaces

- Move the current SDK into `packages/core`.
- Keep the package name `@paykernel/core`.
- Preserve root development commands through forwarding scripts.
- Introduce shared TypeScript, formatting, and lint configuration.
- Configure workspace dependency versioning.

### 1.2 Enforce Dependency Rules

Add automated checks preventing:

- `core` importing adapter packages.
- portable packages importing Node-only modules accidentally.
- adapter root entries importing optional peer drivers.
- circular package dependencies.

### 1.3 Add Changesets and Provenance

- Configure Changesets for independent package versioning.
- Generate release notes.
- Add npm provenance.
- Add prerelease channels.

## Acceptance Criteria

- Existing import paths continue to work.
- The packed core package contains only intended files.
- Workspace dependency boundaries are documented and enforced.

---

# Phase 2 — Open Gateway Plugin Architecture

## Objective

Remove gateway hardcoding from `PaymentClient` and allow third-party gateways without modifying core.

## Target API

```ts
const payments = createPaymentClient({
  gateways: {
    stripe: stripeGateway({ secretKey: env.STRIPE_SECRET_KEY }),
    moyasar: moyasarGateway({ secretKey: env.MOYASAR_SECRET_KEY }),
    custom: customGateway({ apiKey: env.CUSTOM_API_KEY }),
  },
  defaultGateway: "moyasar",
});

payments.gateway("stripe");
payments.gateway("custom");
```

## Tasks

### 2.1 Replace the Closed Gateway Name Union

Replace fixed gateway-name unions in extensibility-sensitive contracts with generic names inferred from the registry.

Retain:

```ts
type BuiltInGatewayName = "moyasar" | "paypal" | "paymob" | "stripe";
```

### 2.2 Introduce `GatewayAdapter`

```ts
interface GatewayAdapter<
  TName extends string,
  TGateway extends PaymentGateway,
> {
  readonly name: TName;
  readonly manifest: GatewayManifest;
  create(context: GatewayContext): TGateway;
}
```

`GatewayContext` should expose only shared dependencies:

- hooks manager.
- redacting logger.
- fetch implementation.
- clock.
- crypto provider.
- UUID source.
- optional telemetry sink.

### 2.3 Make the Registry Type-Safe

Required behavior:

- `client.gateway("stripe")` returns the concrete Stripe gateway type.
- unknown names fail at compile time.
- dynamic runtime registration remains possible through an explicitly less-typed API.

### 2.4 Add an Immutable Registry Builder

The primary client registry must be immutable after client creation. Payment requests must never observe a gateway being replaced or removed while work is in flight.

```ts
const registry = createGatewayRegistry()
  .register(stripeGateway({ secretKey: env.STRIPE_SECRET_KEY }))
  .register(moyasarGateway({ secretKey: env.MOYASAR_SECRET_KEY }));

const client = createPaymentClient({
  registry: registry.build(),
  defaultGateway: "moyasar",
});

client.hasGateway("stripe");
client.configuredGateways();
```

Requirements:

- reject duplicate names during registry construction unless an explicit builder replacement method is used.
- freeze the built registry and gateway manifest set.
- do not expose `unregisterGateway()` on an active client.
- support genuinely dynamic plugins only through a separate string-keyed API with explicit loss of static type inference.
- create a new client instance to apply gateway configuration changes safely.

### 2.5 Preserve Legacy Configuration Temporarily

Support the current constructor configuration during `0.x` through a deprecated compatibility layer.

## Acceptance Criteria

- A third-party gateway participates in payment operations, webhooks, hooks, logging, and error normalization without editing core.
- Gateway names are inferred from the registry.
- current built-in configuration remains usable during migration.
- duplicate registration, immutable registry behavior, and concurrent usage are tested.

---

# Phase 3 — Gateway Capabilities Model

## Objective

Make provider support explicit instead of relying on optional methods and runtime surprises.

## Target Model

```ts
const capabilities = {
  payments: true,
  authorization: true,
  partialCapture: true,
  refunds: true,
  partialRefunds: true,
  voids: true,
  hostedCheckout: true,
  tokenization: false,
  customers: false,
  paymentMethods: false,
  marketplaceSplits: false,
  disputes: false,
} as const;
```

## Tasks

### 3.1 Define Stable Capability Keys

Cover:

- payment creation.
- immediate capture.
- authorization.
- full and partial capture.
- full and partial refund.
- void.
- hosted checkout.
- setup/tokenization.
- customers.
- stored payment methods.
- marketplace splits and transfers.
- disputes.
- payment links.
- provider-native recurring billing as an extension only.

### 3.2 Add Capability Queries

```ts
if (gateway.supports("partialRefunds")) {
  // Narrow the operation contract where practical.
}
```

### 3.3 Generate Provider Documentation

Generate provider comparison tables from manifests.

### 3.4 Validate Adapter Claims

The conformance suite must verify every claimed capability.

## Acceptance Criteria

- consumers can inspect support before invocation.
- unsupported operations fail consistently with capability metadata.
- capability documentation is generated from code.

---

# Phase 4 — Test Kit, Fault Injection, and Mock Gateway

## Objective

Make gateway and storage contributions safe, and make application-level payment testing easy.

## Package

```text
@paykernel/testkit
```

## Tasks

### 4.1 Build a Gateway Conformance Suite

```ts
runGatewayConformanceSuite({
  name: "example",
  createGateway,
  capabilities,
  fixtures,
});
```

Test:

- amount conversion.
- status normalization.
- decline and provider-error mapping.
- network failure and timeout behavior.
- safe retry behavior.
- idempotency behavior.
- webhook verification and malformed webhook rejection.
- event normalization.
- partial capture and refund.
- logging redaction.
- request cancellation.
- indeterminate outcomes.

### 4.2 Add a Scriptable Mock Gateway

```ts
const mock = mockGateway({
  createPayment: [
    { outcome: "requires_action" },
    { outcome: "succeeded" },
  ],
});
```

Support:

- deterministic scripted outcomes.
- latency and timeout simulation.
- duplicate and out-of-order webhook generation.
- provider-side success followed by client-side timeout.
- partial captures and refunds.
- request history assertions.
- webhook signature helpers.

### 4.3 Build a Storage Conformance Harness

```ts
runWebhookInboxStoreConformanceSuite({ createStore });
runIdempotencyStoreConformanceSuite({ createStore });
runReconciliationStoreConformanceSuite({ createStore });
```

The harness must support:

- real concurrency where the driver supports it.
- deterministic fake-clock lease expiry.
- process-crash boundary simulation.
- duplicate key conflicts.
- payload hash conflicts.
- cleanup and retention tests.
- transaction rollback tests.

### 4.4 Add Fixture Safety Utilities

- remove secrets and personal data.
- reject committed fixtures matching secret patterns.
- version fixture schemas.

### 4.5 Add a Test-Only In-Memory Store

Provide a deterministic in-memory implementation inside `@paykernel/testkit` for unit tests and local examples. It must support fake time, lease tokens, conflicts, and crash simulation, and it must be clearly marked as non-production and non-distributed.

## Acceptance Criteria

- custom gateways and stores can be validated through shared suites.
- applications can test complex payment behavior without real providers.
- all built-in gateways pass applicable conformance tests.

---

# Phase 5 — Safe Money Model

## Objective

Remove JavaScript floating-point ambiguity before `1.0.0`.

## Target API

```ts
const amount = money("10.50", "SAR");
```

```ts
type Money<TCurrency extends string = string> = {
  readonly amount: DecimalString;
  readonly currency: TCurrency;
};
```

Internally convert validated decimal strings to integer minor units using `bigint`.

## Tasks

### 5.1 Introduce Money Primitives

Add:

- `Money`.
- `DecimalString`.
- `MinorAmount`.
- currency exponent lookup.
- provider exponent overrides.
- parsing and formatting utilities.

### 5.2 Validate Precision Strictly

Reject excess precision unless an explicit rounding policy is supplied. Do not silently round by default.

### 5.3 Migrate Amount Fields

During `0.x`:

- accept deprecated numeric overloads.
- validate conversion strictly.
- document migration warnings.

At `1.0.0`:

- use `Money` in mutations and normalized results.
- expose exact minor-unit values where useful.

### 5.4 Test Currency Edge Cases

Cover zero-, two-, and three-decimal currencies, large values, invalid precision, exponent overrides, and intentional negative marketplace adjustments.

## Acceptance Criteria

- no financial calculation relies on binary floating point.
- JSON serialization remains straightforward.
- every gateway uses shared conversion primitives.

---

# Phase 6 — Typed Provider Inputs and Operation Results

## Objective

Separate common contracts from provider-specific fields and make outcomes unambiguous.

## Tasks

### 6.1 Split Common and Provider-Specific Inputs

```ts
type CommonPaymentInput = {
  amount: Money;
  orderId?: string;
  description?: string;
  metadata?: PaymentMetadata;
};
```

Provider adapters expose their own typed extensions.

### 6.2 Replace `success: boolean`

```ts
type PaymentOperationResult =
  | { outcome: "succeeded"; payment: Payment }
  | {
      outcome: "requires_action";
      payment: Payment;
      action: PaymentAction;
    }
  | { outcome: "declined"; failure: PaymentDecline }
  | { outcome: "failed"; error: PaymentError }
  | {
      outcome: "indeterminate";
      providerRequestId?: string;
      reconciliationRequired: true;
    };
```

### 6.3 Separate Domain Statuses

Create separate status unions for payments, authorizations, captures, refunds, setup/tokenization, disputes, transfers, and payouts.

### 6.4 Standardize Provider References

Expose:

- internal reference.
- provider object ID.
- provider request ID.
- parent and related IDs.
- provider-native status.
- normalized status.

## Acceptance Criteria

- pending or requires-action results cannot be mistaken for paid results.
- indeterminate outcomes are explicit.
- provider-specific fields do not pollute common inputs.

---

# Phase 7 — Typed and Versioned Webhook Events

## Objective

Replace free-form event types with stable discriminated events.

## Target Model

```ts
type PaymentEvent =
  | {
      schemaVersion: "1";
      type: "payment.succeeded";
      payment: Payment;
      provider: ProviderEventMetadata;
    }
  | {
      schemaVersion: "1";
      type: "payment.failed";
      payment: Payment;
      failure: PaymentFailure;
      provider: ProviderEventMetadata;
    }
  | {
      schemaVersion: "1";
      type: "refund.completed";
      refund: Refund;
      provider: ProviderEventMetadata;
    };
```

## Tasks

### 7.1 Define Stable Event Names

Use consistent names such as:

- `payment.created`.
- `payment.processing`.
- `payment.authorized`.
- `payment.succeeded`.
- `payment.failed`.
- `payment.cancelled`.
- `capture.completed`.
- `refund.pending`.
- `refund.completed`.
- `refund.failed`.
- `payment_method.setup_completed`.
- `dispute.opened`.
- `dispute.updated`.
- `dispute.closed`.

### 7.2 Preserve Provider Metadata

```ts
type ProviderEventMetadata = {
  gateway: string;
  eventId: string;
  eventType: string;
  apiVersion?: string;
  livemode?: boolean;
  occurredAt: string;
  receivedAt: string;
  requestId?: string;
};
```

### 7.3 Define a Persistable Event Envelope

Create a storage-safe envelope separate from request-local data:

```ts
type PersistedPaymentEventEnvelope = {
  schemaVersion: "1";
  event: PaymentEvent;
  payloadHash: string;
  storedAt: string;
};
```

Exclude raw payloads, secrets, headers, and signatures by default.

### 7.4 Make Raw Payload Retention Explicit

Allow opt-in request-local access and optional encrypted persistence through an application-supplied codec.

### 7.5 Version the Schema

- start with `schemaVersion: "1"`.
- document compatibility rules.
- never silently change an event's meaning.

## Acceptance Criteria

- handlers receive discriminated events.
- provider metadata remains available.
- a stable, sanitized event envelope can be persisted by inbox adapters.

---

# Phase 8 — Runtime Portability

## Objective

Support Node.js, Bun, Deno, and Cloudflare Workers without duplicating payment logic.

## Tasks

### 8.1 Inject Runtime Dependencies

```ts
interface PaymentRuntime {
  fetch: typeof globalThis.fetch;
  crypto: CryptoProvider;
  clock: Clock;
  randomUUID(): string;
}
```

### 8.2 Prefer Web APIs

Prefer Web Crypto, `fetch`, `Headers`, `AbortController`, and web streams. Keep narrowly scoped fallbacks only when unavoidable.

### 8.3 Add `AbortSignal`

Every network operation must accept cancellation through its operation context.

### 8.4 Add Runtime Test Matrix

Test:

- minimum supported Node version.
- supported Node LTS versions.
- minimum and latest Bun.
- Deno smoke tests.
- Cloudflare Workers smoke tests.

### 8.5 Validate Published Exports

Avoid shipping Node imports into Worker or Deno entry points.

## Acceptance Criteria

- core imports successfully in supported runtimes.
- webhook verification works across runtimes.
- provider HTTP operations do not require Node globals.

---

# Phase 9 — Store Contracts and Adapter Manifests

## Objective

Define the exact storage semantics before implementing any database adapter.

## 9.1 Store Contracts

Define separate interfaces rather than one universal store.

### Payment Mutation Idempotency

Every state-changing method after `reserve()` must require the active reservation token so a stale caller cannot complete or overwrite a newer reservation.

```ts
interface IdempotencyStore {
  reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation>;
  renew(input: RenewIdempotencyReservationInput): Promise<RenewReservationResult>;
  complete(input: CompleteIdempotencyInput): Promise<void>;
  markIndeterminate(input: MarkIndeterminateInput): Promise<void>;
  get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined>;
  deleteExpired(input: CleanupInput): Promise<CleanupResult>;
}
```

### Webhook Inbox

```ts
interface WebhookInboxStore {
  claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult>;
  renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult>;
  complete(input: CompleteWebhookInput): Promise<void>;
  fail(input: FailWebhookInput): Promise<void>;
  get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined>;
  listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]>;
  deleteExpired(input: CleanupInput): Promise<CleanupResult>;
}
```

### Reconciliation Persistence

```ts
interface ReconciliationStore {
  schedule(input: ScheduleReconciliationInput): Promise<ScheduleResult>;
  claim(input: ClaimReconciliationInput): Promise<ClaimResult>;
  renew(input: RenewReconciliationLeaseInput): Promise<RenewReconciliationLeaseResult>;
  complete(input: CompleteReconciliationInput): Promise<void>;
  fail(input: FailReconciliationInput): Promise<void>;
  markManualReview(input: MarkManualReviewInput): Promise<void>;
  get(key: ReconciliationKey): Promise<ReconciliationRecord | undefined>;
  listDue(input: ListDueInput): Promise<ReconciliationRecord[]>;
  deleteExpired(input: CleanupInput): Promise<CleanupResult>;
}
```

## 9.2 Lease Semantics

All claimable records must define:

- unique key.
- state.
- lease owner.
- lease token or fencing token.
- lease expiry.
- attempts.
- timestamps.
- version or generation number where needed.

Completion, failure, and renewal must require the current lease token. A stale worker must not complete work after a newer worker has reclaimed the lease.

## 9.3 Fencing Tokens

Use monotonically increasing generations or unguessable lease tokens to reject stale workers.

## 9.4 Storage Error Taxonomy

Normalize:

- unavailable.
- conflict.
- lease lost.
- timeout.
- serialization failure.
- invalid schema.
- unsupported feature.
- corrupted record.

## 9.5 Adapter Manifest

```ts
interface StorageAdapterManifest {
  name: string;
  contracts: {
    idempotency: boolean;
    webhookInbox: boolean;
    reconciliation: boolean;
  };
  consistency: {
    claims: "strong";
    readAfterWrite: "strong" | "session" | "eventual";
    staleReadsPossible: boolean;
  };
  coordinationScope: "single-process" | "single-host" | "multi-host" | "multi-region";
  durability: "durable" | "configuration-dependent" | "ephemeral";
  supportsTransactions: boolean;
  supportsLeases: boolean;
  supportsRetentionCleanup: boolean;
  notes: readonly string[];
}
```

## Acceptance Criteria

- contracts specify atomicity and stale-worker behavior precisely.
- implementations cannot claim correctness with non-atomic `get`/`set` logic.
- adapter guarantees are machine-readable and documented.
- an indeterminate idempotency record blocks mutation replay until reconciliation or an explicit operator decision.
- long-running idempotency and reconciliation work can renew leases without allowing stale completion.

---

# Phase 10 — Webhook Inbox Engine

## Objective

Provide a storage-agnostic mechanism for claiming, deduplicating, retrying, and auditing webhook processing.

## Package

```text
@paykernel/webhooks
```

## 10.1 Processing Model

1. receive the raw request.
2. verify signature/authenticity.
3. normalize the event.
4. calculate a stable payload hash.
5. derive the key from gateway and provider event ID.
6. atomically claim the event.
7. reject or report a conflicting duplicate payload.
8. run the application handler.
9. mark the record complete using the lease token.
10. on failure, record a sanitized error and next retry decision.

## 10.2 Inbox Record

Store:

- event key.
- gateway.
- provider event ID and type.
- schema version.
- normalized event envelope, when configured.
- payload hash.
- state.
- attempt count.
- lease owner and token.
- lease expiry.
- first and last received timestamps.
- next attempt timestamp.
- completion timestamp.
- sanitized last error.

Do not persist raw signatures, authorization headers, secret tokens, or unredacted provider payloads.

## 10.3 Processing Modes

### Inline Mode

The request waits for the handler. On handler failure, the application normally returns a retryable HTTP error to the provider.

### Durable Retry Mode

The inbox stores a persistable normalized event envelope and schedules internal retries. The HTTP request may be acknowledged after durable claim/persistence according to application policy.

Codex must not mix these modes implicitly. The selected mode and acknowledgment behavior must be explicit.

## 10.4 Acknowledgment Policy

Expose outcomes rather than hardcoding HTTP responses:

```ts
type WebhookProcessingOutcome =
  | { outcome: "processed" }
  | { outcome: "duplicate_completed" }
  | { outcome: "already_processing"; retryAfterMs?: number }
  | { outcome: "scheduled_for_retry" }
  | { outcome: "handler_failed"; retryable: boolean }
  | { outcome: "payload_conflict" }
  | { outcome: "invalid_webhook" };
```

Framework packages map these outcomes according to provider and application policy.

## 10.5 Lease Renewal

Long handlers must be able to renew their lease. Renewal must fail when the lease token is stale.

## 10.6 Crash Boundaries

Document and test:

- crash before claim.
- crash after claim and before handler.
- crash during handler.
- crash after external application side effect and before inbox completion.
- crash after completion.

The application handler must still be idempotent because no inbox can atomically commit an arbitrary external side effect and its own completion record unless both share the same transaction boundary.

## Acceptance Criteria

- concurrent duplicate deliveries do not execute the same handler concurrently.
- completed events do not execute again.
- expired leases can be reclaimed.
- stale workers cannot complete reclaimed work.
- conflicting payloads are reported.
- inline and durable retry modes are explicit.

---

# Phase 11 — Relational Adapter Foundation

## Objective

Implement shared relational schemas and algorithms without pretending all SQL engines or drivers are identical.

## 11.1 Private Shared SQL Layer

Create a private workspace containing:

- canonical table and column definitions.
- normalized row codecs.
- query templates where syntax is portable.
- schema version constants.
- migration test fixtures.
- shared record validation.

Do not publish a general SQL abstraction as public API in the first version.

## 11.2 Canonical Schema

Recommended logical tables:

```text
payment_idempotency
payment_webhook_inbox
payment_reconciliation_jobs
payment_storage_migrations
```

Common requirements:

- unique primary keys.
- state check constraints where supported.
- indexes for due retries and expired leases.
- payload hashes stored as text or binary consistently.
- timestamps stored as ISO 8601 text or database-native timestamps according to adapter policy.
- sanitized error fields with a strict maximum size.
- optional tenant/namespace key.

## 11.3 Schema Namespace Configuration

Allow validated configuration for:

- table prefix.
- SQL schema in PostgreSQL.
- tenant namespace column.

Never interpolate an unvalidated arbitrary table name.

## 11.4 Migration Policy

Each relational adapter must export:

- raw migration files.
- migration metadata.
- an explicit `migrate()` helper for development or user-invoked startup flows.
- a schema verification helper.

Do not run migrations automatically on package import or production construction.

## 11.5 Atomic Claim Algorithm

Prefer a single conditional write that:

- inserts a new record when absent.
- reclaims only expired or retryable records.
- increments generation/attempt safely.
- returns the resulting lease token and state.

Each dialect must prove equivalent behavior through conformance tests.

## Acceptance Criteria

- relational adapters share behavior and schema intent without unsafe driver abstraction.
- migrations are explicit and versioned.
- atomic claims are validated under contention.

---

# Phase 12 — PostgreSQL Adapter

## Package

```text
@paykernel/store-postgres
```

## Objective

Provide the strongest general-purpose durable store for production systems already using PostgreSQL.

## Driver Bindings

Recommended subpath exports:

```text
@paykernel/store-postgres/bun-sql
@paykernel/store-postgres/postgres-js
@paykernel/store-postgres/pg
@paykernel/store-postgres/drizzle
```

A generic narrow executor may be exported only if it preserves transaction and error semantics.

## Tasks

### 12.1 Implement Store Factories

```ts
createPostgresIdempotencyStore(...);
createPostgresWebhookInboxStore(...);
createPostgresReconciliationStore(...);
```

### 12.2 Use PostgreSQL Strengths

Use as appropriate:

- unique constraints.
- `INSERT ... ON CONFLICT`.
- conditional `UPDATE ... RETURNING`.
- `TIMESTAMPTZ`.
- transactions.
- row locking or advisory locks only when necessary.
- `SKIP LOCKED` for batch reconciliation workers when appropriate.

Do not use advisory locks as the only durable record of work.

### 12.3 Support Bun SQL and Drizzle

Provide native examples using Bun SQL and optional Drizzle schema exports without making Drizzle mandatory.

### 12.4 Integration Tests

Use a real PostgreSQL service in CI and test:

- many concurrent claims.
- transaction rollback.
- stale lease rejection.
- database restart or connection drop simulations where practical.
- migration upgrades.

## Acceptance Criteria

- safe for multi-process deployments.
- audit history and retry scheduling are durable.
- all driver bindings pass the same store conformance suites.

---

# Phase 13 — Redis, Valkey, Bun Redis, and Upstash Adapter

## Package

```text
@paykernel/store-redis
```

## Driver Bindings

```text
@paykernel/store-redis/bun
@paykernel/store-redis/upstash
@paykernel/store-redis/ioredis
@paykernel/store-redis/node-redis
```

## Objective

Provide optional low-latency atomic idempotency, leases, and inbox coordination for distributed applications.

Redis must not become a mandatory dependency or the default recommendation. Applications using PostgreSQL, D1, Turso, Durable Objects, or a suitable SQLite deployment may run the full payment safety model without Redis.

## 13.1 Bun Native Redis/Valkey Binding

Implement a dedicated binding around `Bun.RedisClient` and `Bun.redis`.

Requirements:

- isolate all `bun` imports behind the `/bun` subpath.
- accept an injected `RedisClient` instance as the preferred configuration.
- optionally create a client from an explicit URL.
- support both `REDIS_URL` and `VALKEY_URL` only in convenience constructors, not in portable core code.
- use raw `send()` commands for Lua scripts and commands without first-class Bun methods.
- validate the supported Redis/Valkey server version during integration tests.
- disable or carefully control offline command queuing for correctness-critical operations where replay after reconnect could create ambiguous behavior.
- document that Bun's native client currently does not support Redis Cluster or Sentinel.
- document that `MULTI`/`EXEC` requires raw commands; prefer one atomic Lua script for each store transition where practical.
- do not use experimental Pub/Sub as the correctness mechanism for webhook delivery or retries.

Add a real integration-test matrix against:

- Redis 7.2 or newer.
- Valkey where protocol compatibility is claimed.
- TLS-enabled Redis where CI infrastructure permits.

## 13.2 Implement Atomic Scripts

Use Lua scripts or equivalent atomic server-side primitives for:

- reserve/claim.
- lease renewal.
- completion with lease-token validation.
- failure and retry scheduling.
- payload conflict detection.
- monotonically advancing fencing generations when required.

Do not implement claim as separate `GET` and `SET` calls.

Scripts must return explicit tagged results rather than relying on ambiguous integer conventions in adapter code.

## 13.3 Shared Redis Command Port

Define a small internal command port used by all bindings:

```ts
interface RedisCommandPort {
  send(command: string, args: readonly string[]): Promise<unknown>;
}
```

Do not normalize every client API into a large generic Redis abstraction. The port exists only to execute the small, audited command/script surface required by the payment stores.

Each driver binding must translate:

- connection errors.
- timeouts.
- script loading/execution errors.
- authentication failures.
- stale lease outcomes.
- unsupported topology errors.

into the shared storage error taxonomy.

## 13.4 Key Design

Define:

- stable key prefixes.
- tenant namespaces.
- hash tags where Redis Cluster co-location is required by cluster-capable bindings.
- configurable retention TTL.
- separate sorted sets for due jobs where needed.
- schema/version suffixes for future migration.
- maximum record and error payload sizes.

The Bun binding must reject cluster-specific configuration because the native Bun client does not currently support Redis Cluster.

## 13.5 Persistence Caveats

Document that correctness across Redis or Valkey restarts depends on the service's persistence, replication, failover, and acknowledgement configuration. Do not describe an ephemeral cache configuration as a durable audit store.

The adapter manifest must distinguish:

- coordination-safe during normal service operation.
- durable across process restart.
- durable across Redis service restart.
- suitable as the only audit store.

## 13.6 Hybrid Examples

Add examples using:

- Bun Redis for claim and lease coordination with Bun SQL/PostgreSQL for long-term audit history.
- Upstash Redis for coordination with D1 or Turso for durable history.
- a Redis-only deployment with explicit persistence warnings.
- a no-Redis deployment proving PostgreSQL or D1 can satisfy all required contracts independently.

## 13.7 Tests

Test every binding with the shared conformance suite plus driver-specific tests for:

- concurrent claims.
- Lua script atomicity.
- lease expiration.
- stale completion.
- client reconnect boundaries.
- offline queue behavior.
- Redis Cluster-compatible key layout for cluster-capable bindings.
- Bun binding rejection/documentation of unsupported Cluster and Sentinel topologies.
- TTL cleanup.
- service restart behavior under the selected persistence configuration.
- parity between Bun, Upstash, ioredis, and node-redis result mapping.

## Acceptance Criteria

- Bun native Redis/Valkey is a first-class supported binding.
- Upstash and standard Redis clients share equivalent contract behavior.
- atomicity does not depend on client-side sequencing.
- persistence and topology limitations are explicit.
- applications can use the SDK without installing or operating Redis.
- no Redis driver is imported from the package root.

---

# Phase 14 — Local SQLite Adapter Family

## Package

```text
@paykernel/store-sqlite
```

## Objective

Provide a high-quality local/embedded implementation for Bun, Node, tests, desktop applications, and single-host deployments.

## Subpath Exports

```text
@paykernel/store-sqlite/bun
@paykernel/store-sqlite/node
@paykernel/store-sqlite/better-sqlite3
```

The root package must contain only shared types and must not import a driver.

## 14.1 Bun SQLite Binding

Support `bun:sqlite` as the first-class Bun implementation.

Requirements:

- use prepared statements.
- use synchronous transaction callbacks.
- prefer `BEGIN IMMEDIATE` semantics for contested write claims where appropriate.
- configure or document `busy_timeout`.
- recommend WAL mode for persistent single-host applications.
- expose an in-memory test helper.

Target API:

```ts
import { Database } from "bun:sqlite";
import { createBunSqliteStores } from "@paykernel/store-sqlite/bun";

const db = new Database("payments.db");
const stores = createBunSqliteStores({ db });
```

## 14.2 Node Built-in SQLite Binding

Support `node:sqlite` through a dedicated subpath.

Requirements:

- isolate all `node:sqlite` imports.
- document the minimum Node version and module stability status.
- use `DatabaseSync` prepared statements.
- support BigInt reads where needed.
- publish the exact supported Node-version matrix and the module stability level for each supported line. Keep this optional subpath isolated from the core runtime baseline.

## 14.3 `better-sqlite3` Binding

Provide a stable Node binding for applications preferring the mature synchronous driver.

Requirements:

- use `.transaction()` or explicit immediate transactions safely.
- do not use async transaction callbacks.
- support WAL and busy-timeout recommendations.
- use safe integer mode or strings where 64-bit precision matters.

## 14.4 SQLite Claim Semantics

Use one of the following only after conformance verification:

- `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING`.
- `BEGIN IMMEDIATE` plus conditional statements in one synchronous transaction.

Do not rely on an unprotected read followed by write.

## 14.5 Deployment Limits

Document clearly:

- one database file must have one durable filesystem authority.
- do not share the file over unsupported network filesystems.
- ephemeral serverless filesystems lose state.
- horizontal scaling across hosts requires D1, Turso, PostgreSQL, Redis, or another shared service.

## 14.6 Tests

Run the same logical suite against:

- Bun SQLite in-memory and file-backed modes.
- Node SQLite where supported.
- `better-sqlite3`.

Add lock contention, busy timeout, WAL, restart, and migration tests.

## Acceptance Criteria

- Bun SQLite is a production-capable single-host adapter.
- each subpath imports only its driver.
- no local SQLite adapter is misrepresented as distributed coordination.

---

# Phase 15 — Turso and libSQL Adapter

## Package

```text
@paykernel/store-turso
```

## Objective

Support globally accessible SQLite-compatible storage without conflating it with a local file database.

## Recommended Subpaths

```text
@paykernel/store-turso/serverless
@paykernel/store-turso/libsql
```

Optional future subpath:

```text
@paykernel/store-turso/sync
```

Do not implement the sync subpath until local-first conflict and primary-write behavior are tested explicitly.

## 15.1 Turso Serverless Binding

Support the current fetch-based Turso serverless client where its transaction and statement capabilities satisfy the store contracts.

Prefer atomic single-statement claims to reduce dependence on interactive transaction behavior.

## 15.2 libSQL Binding

Support `@libsql/client` for existing applications and ORM compatibility.

Requirements:

- use write transactions or transactional batches when multiple statements are unavoidable.
- support remote URLs and local file URLs only through appropriate runtime entry points.
- document that legacy embedded replica behavior differs from true local-first sync.

## 15.3 Concurrency and Consistency

Test:

- concurrent remote claims.
- transaction rollback.
- read-after-write behavior.
- timeout and reconnect behavior.
- lease expiry.
- multiple application instances.

## 15.4 Drizzle Compatibility

Provide optional Drizzle schema exports or examples, but execute correctness-critical claim statements through a tested adapter path rather than assuming every ORM query builder can express the required conditional atomic write safely.

## Acceptance Criteria

- Turso remote deployments can act as a shared durable inbox and reconciliation store.
- libSQL compatibility remains available.
- sync or embedded-replica modes are not advertised beyond tested guarantees.

---

# Phase 16 — Cloudflare D1 Adapter

## Package

```text
@paykernel/store-d1
```

## Objective

Provide a D1-native store for Workers and Pages applications using SQLite semantics through the D1 API.

## Tasks

### 16.1 Accept a D1 Binding

```ts
const stores = createD1PaymentStores({
  db: env.PAYMENTS_DB,
});
```

Do not require REST API access for normal Worker operation.

### 16.2 Use D1-Native Execution

- use prepared statements.
- prefer single-statement atomic claims.
- use `batch()` only for operations requiring multiple statements and verify rollback semantics.
- use sessions when sequential consistency or primary-first reads are required.
- avoid assumptions copied from local synchronous SQLite drivers.

### 16.3 Schema and Migrations

Provide D1-compatible SQL migration files and Wrangler examples.

Do not include unsupported transaction wrappers in migration files intended for D1 execution.

### 16.4 Numeric Portability

Store identifiers, lease tokens, hashes, and exact financial values as text or explicitly encoded values where JavaScript integer precision could be a concern.

### 16.5 Read Replication Awareness

Correctness-critical claims are writes and must use the primary. Reads immediately following writes must use a consistency strategy appropriate to D1 sessions when read replication is enabled.

### 16.6 Testing

Use the Cloudflare local runtime and test:

- duplicate concurrent deliveries.
- atomic claims.
- D1 batch rollback.
- primary/session behavior where testable.
- migrations.
- Worker restarts.

## Acceptance Criteria

- safe for distributed Worker deployments.
- no local SQLite driver assumptions leak into the D1 implementation.
- D1-specific guarantees and limits are documented.

---

# Phase 17 — Cloudflare SQLite-Backed Durable Object Adapter

## Package

```text
@paykernel/store-durable-objects
```

## Objective

Use Durable Objects for strongly coordinated payment idempotency, webhook claiming, and retry scheduling where per-key serialization is beneficial.

## Architecture

Provide:

1. one or more Durable Object classes.
2. a Worker-side client implementing store contracts.
3. a deterministic sharding strategy.

## 17.1 SQLite-Backed Durable Objects Only

Use the SQLite storage backend for every new Durable Object class. Do not build new functionality on the legacy non-SQLite storage backend.

## 17.2 Sharding Strategy

Support strategies such as:

- one object per event or idempotency key.
- hash-partitioned objects.
- one object per tenant for moderate workloads.

Do not choose one universal default without contention and cost tests. Benchmark one-object-per-key, tenant-scoped, and bounded hash-partitioned strategies. Never route all payment work through one global Durable Object, and document the ordering guarantees of the selected strategy.

## 17.3 Transactions and Serialization

Use Durable Object storage transactions or synchronous SQLite transaction APIs according to runtime requirements.

Do not hold a transaction open across provider network calls.

Correct pattern:

1. claim atomically.
2. commit claim.
3. perform external work outside the transaction.
4. complete with lease-token validation.

## 17.4 Alarms for Durable Retry

Optionally support Durable Object alarms for retryable webhook and reconciliation records.

The alarm scheduler must:

- be optional.
- use bounded retries.
- apply backoff and jitter.
- avoid one alarm per excessive record when a partitioned queue is more efficient.

## 17.5 Tests

Test:

- concurrent requests to the same key.
- different partitions.
- object eviction/restart.
- alarm retry.
- stale lease completion.
- SQLite transaction rollback.

## Acceptance Criteria

- strong per-partition coordination is preserved.
- external payment calls never occur inside storage transactions.
- sharding and hot-key risks are documented.

---

# Phase 18 — Adapter Capability Matrix and Selection Guide

## Objective

Make the correct adapter choice obvious to users and Codex.

## Initial Matrix

| Adapter | Distributed | Durable audit | Atomic claim | Best use | Important limitation |
|---|---:|---:|---:|---|---|
| PostgreSQL | Yes | Yes | Yes | General production default | Requires managed/self-hosted database |
| Redis/Valkey via Bun, ioredis, or node-redis | Yes, except Bun Cluster/Sentinel limitations | Configuration-dependent | Yes | Low-latency coordination, TTLs, scripts | Optional infrastructure; persistence depends on service settings |
| Upstash Redis | Yes | Configuration-dependent | Yes | Serverless coordination and idempotency | HTTP/network model and persistence policy must be tested |
| Bun SQLite | No, single host | Yes with durable disk | Yes | Bun apps, local or single server | Not cross-host coordination |
| Node SQLite | No, single host | Yes with durable disk | Yes | Node local/single server | Availability and stability vary by supported Node line; optional subpath only |
| better-sqlite3 | No, single host | Yes with durable disk | Yes | Mature Node SQLite deployments | Native dependency; synchronous |
| Turso serverless | Yes | Yes | Yes after conformance | Shared remote SQLite-compatible store | Remote/client transaction semantics differ |
| libSQL | Yes or embedded | Yes | Yes after conformance | Existing Turso/libSQL projects | Embedded replica semantics require care |
| Cloudflare D1 | Yes | Yes | Yes | Worker-native relational store | D1 API and consistency semantics are distinct |
| Cloudflare Durable Objects | Yes, partitioned | Yes | Yes | Strong per-key coordination and retries | Requires sharding and DO operational model |

## Recommended Defaults

- Existing PostgreSQL application: PostgreSQL adapter.
- Cloudflare application already using D1: D1 adapter.
- Cloudflare application needing strong per-key coordination: Durable Object adapter.
- Bun single-server application: Bun SQLite adapter.
- Globally deployed app wanting remote SQLite compatibility: Turso adapter.
- Existing Redis or Valkey deployment needing fast coordination: use the matching Redis binding, optionally paired with SQL audit storage.
- Bun application already using Redis or Valkey: prefer the native `/bun` binding unless Cluster or Sentinel is required.
- No existing Redis and moderate workload: prefer the primary relational/D1/DO adapter and avoid adding infrastructure.

## Acceptance Criteria

- documentation includes a decision tree and capability matrix.
- no adapter is marketed beyond its tested deployment guarantees.

---

# Phase 19 — Reconciliation Primitives and Durable Scheduling

## Package

```text
@paykernel/reconciliation
```

## Objective

Provide recovery building blocks for operations with unknown final state and local/provider state drift.

## Reconciliation Is Required When

- create, capture, refund, or void times out after possible submission.
- a webhook never arrives.
- a webhook arrives late or out of order.
- an operation is performed from the provider dashboard.
- local state says `pending` while the provider says `paid`.
- local captured or refunded totals differ from provider totals.

## 19.1 Reconciliation Target

```ts
type ReconciliationTarget = {
  gateway: string;
  localReference?: string;
  gatewayPaymentId?: string;
  idempotencyKey?: string;
  providerRequestId?: string;
  expected?: LocalPaymentSnapshot;
};
```

## 19.2 Provider Snapshot

```ts
type ProviderPaymentSnapshot = {
  gatewayPaymentId: string;
  status: PaymentStatus;
  amount: Money;
  capturedAmount?: Money;
  refundedAmount?: Money;
  updatedAt?: string;
  providerStatus: string;
  relatedIds?: Record<string, string>;
};
```

## 19.3 Result Types

```ts
type ReconciliationResult =
  | { outcome: "consistent"; provider: ProviderPaymentSnapshot }
  | {
      outcome: "drift_detected";
      provider: ProviderPaymentSnapshot;
      differences: ReconciliationDifference[];
    }
  | { outcome: "provider_not_found"; retryable: boolean }
  | { outcome: "temporarily_unavailable"; retryAfterMs?: number }
  | { outcome: "ambiguous_match"; matches: ProviderPaymentSnapshot[] }
  | { outcome: "manual_review_required"; reason: string };
```

## 19.4 Safe Lookup Order

When supported:

1. provider payment ID.
2. provider idempotency key.
3. merchant order/reference ID.
4. provider request ID.

Multiple matches must never be resolved silently.

## 19.5 Policy Helpers

Provide decisions, not automatic business mutations:

- safe to update local pending state to paid after verified lookup.
- safe to mark failed only after a definitive response.
- manual review required for ambiguous matches.
- never create a replacement payment while the original is indeterminate.

## 19.6 Durable Scheduling

Applications may use `ReconciliationStore` adapters to schedule and claim due checks.

```ts
await scheduler.schedule({
  target,
  runAt,
  reason: "indeterminate_create",
});
```

Support:

- exponential backoff with jitter.
- maximum attempts.
- manual review state.
- dead-letter inspection.
- per-provider concurrency limits.

Do not require a specific queue. Store adapters or Cloudflare alarms may power scheduling.

## 19.7 Batch Primitives

```ts
for await (const result of reconciler.reconcileMany(targets, {
  concurrency: 5,
})) {
  // Persist or alert in application code.
}
```

## Acceptance Criteria

- indeterminate operations can be checked safely.
- differences are machine-readable.
- durable scheduling works through supported stores without a mandatory queue.
- reconciliation never creates duplicate charges.

---

# Phase 20 — Observability and Operational Diagnostics

## Objective

Make production payment behavior observable without coupling to one vendor.

## Tasks

### 20.1 Structured Operation Context

Carry:

- operation ID.
- gateway.
- operation type.
- tenant or namespace.
- internal reference.
- provider object ID.
- provider request ID.
- attempt number.
- duration.
- normalized outcome.
- retry and reconciliation flags.
- inbox event key where applicable.

### 20.2 Optional OpenTelemetry Integration

Suggested spans:

- `payment.create`.
- `payment.capture`.
- `payment.refund`.
- `payment.void`.
- `payment.webhook.verify`.
- `payment.webhook.claim`.
- `payment.webhook.process`.
- `payment.reconcile`.
- `payment.store.claim`.

### 20.3 Metrics

Expose counters and histograms for:

- operation outcomes.
- provider latency.
- rate limits.
- retries.
- webhook duplicates.
- payload conflicts.
- handler failures.
- expired/reclaimed leases.
- reconciliation drift.
- indeterminate operations.
- adapter latency and errors.

### 20.4 Redaction

Telemetry must pass through the same redaction model as logs.

## Acceptance Criteria

- provider request IDs support operational debugging.
- core has no mandatory OpenTelemetry dependency.
- sensitive values are never emitted by default.

---

# Phase 21 — Safe Routing Policies

## Objective

Choose gateways using explicit rules while preventing unsafe fallback.

## Target API

```ts
const router = createPaymentRouter({
  rules: [
    route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
    route({ currency: "USD" }).to("stripe"),
  ],
  fallback: "stripe",
});
```

## Tasks

### 21.1 Routing Inputs

Allow:

- currency.
- country.
- payment method.
- amount range.
- tenant configuration.
- capability requirements.
- merchant preference.
- application-supplied health signal.
- application-supplied cost signal.

### 21.2 Separate Selection from Execution

```ts
const decision = router.select(input);
await payments.createPayment(input, decision.gateway);
```

### 21.3 Restrict Fallbacks

Fallback is allowed only when the request was not submitted or a definitive pre-submission failure occurred.

Never automatically fallback after timeout, connection reset, provider 5xx with uncertain submission state, or an indeterminate result.

## Acceptance Criteria

- decisions are deterministic and testable.
- unsafe fallback is structurally prevented or requires an explicit expert override.
- selected provider remains visible in results and telemetry.

---

# Phase 22 — Higher-Level Payment Capabilities

## Objective

Expand only after plugin architecture, money safety, webhook handling, adapters, and reconciliation are stable.

## Priority

### 22.1 Customers and Stored Payment Methods

- provider customers.
- attach/list/detach tokenized payment methods.
- off-session attempts.
- no raw card storage.

### 22.2 Hosted Checkout

Replace `unknown` results with capability-specific typed contracts.

### 22.3 Disputes and Chargebacks

- normalized dispute events.
- evidence deadlines.
- provider status and dashboard links.
- evidence submission only where a stable contract is practical.

### 22.4 Marketplace Operations

Treat connected accounts, splits, transfers, payouts, and reversals as a separate capability group or package.

### 22.5 Payment Links

Add a small capability-gated abstraction.

## Acceptance Criteria

- every feature is capability-gated.
- provider-specific details remain accessible.
- no subscription-domain logic enters core.

---

# Phase 23 — Additional Gateway Packages

## Objective

Expand coverage through completed plugin and conformance systems.

## Suggested MENA Order

Select based on real product demand, merchant access, official API quality, and sandbox availability:

- Tap Payments.
- MyFatoorah.
- HyperPay.
- Amazon Payment Services.
- Checkout.com.
- Adyen only for demonstrated enterprise demand.

Do not implement all at once.

## Contribution Requirements

Every gateway must include:

- adapter manifest.
- capabilities.
- conformance suite.
- provider-specific tests.
- sanitized webhook fixtures.
- documentation for IDs, currencies, idempotency, webhook requirements, and status mapping.
- runtime compatibility declaration.
- production checklist.

## Acceptance Criteria

- adding a gateway does not modify core client internals.
- the gateway passes applicable conformance tests.
- unsupported capabilities are explicit.

---

# Phase 24 — Framework Integrations

## Objective

Provide optional convenience packages without coupling core to frameworks.

## Candidate Packages

```text
@paykernel/integration-hono
@paykernel/integration-elysia
@paykernel/integration-express
@paykernel/integration-cloudflare-workers
```

## Features

- raw-body-safe webhook handlers.
- normalized header extraction.
- standard HTTP outcome mapping.
- inbox integration.
- request context and correlation IDs.
- typed environment binding helpers.
- optional durable retry acknowledgment policies.

Framework packages must remain thin and must not duplicate payment logic.

## Acceptance Criteria

- core remains framework-agnostic.
- integrations preserve raw-body requirements.
- each integration has executable examples.

---

# Phase 25 — `1.0.0` Migration and Stability

## Objective

Finalize the stable public contract and remove deprecated APIs.

## Tasks

### 25.1 Publish Migration Guides

Cover:

- legacy client configuration to gateway registry.
- numeric amounts to `Money`.
- success boolean to discriminated outcomes.
- old webhook events to versioned events.
- combined statuses to domain-specific statuses.
- provider fields in common params to provider input types.
- legacy idempotency stores to lease-aware contracts.

### 25.2 Define Stability Guarantees

Document:

- semantic versioning.
- event schema compatibility.
- store schema compatibility.
- supported runtime policy.
- provider API version policy.
- adapter driver support policy.
- minimum deprecation period.

### 25.3 API and Schema Compatibility Checks

CI must detect undocumented public API or persisted-schema breaking changes.

### 25.4 Release Candidates

Validate release candidates in at least:

- a Bun server application.
- a Cloudflare Worker application.
- a PostgreSQL-backed application.
- one SQLite or Turso-backed application.

## Acceptance Criteria

- deprecated APIs are removed intentionally.
- production-like applications validate the release candidate.
- API, event, and store schema compatibility policies are committed.

---

## 26. Adapter Implementation Priority

Implement adapters in this order unless measured production demand justifies a documented change.

### Priority A — Required Before the Stable Inbox Release

1. PostgreSQL with Bun SQL and one mainstream Node binding.
2. Bun SQLite, including in-memory and durable single-host coverage.
3. Cloudflare D1.

These three adapters prove the contracts across a conventional relational database, a synchronous embedded runtime, and a distributed edge database. Redis is not required to release the inbox engine.

### Priority B — Production Expansion

4. Turso serverless and `@libsql/client` compatibility.
5. SQLite-backed Durable Objects.
6. Redis/Valkey with the Bun native binding, Upstash, and one standard Node binding.
7. `better-sqlite3`.
8. Node built-in SQLite.
9. Additional PostgreSQL and Redis driver bindings.

### Priority C — Only After Demonstrated Demand

- MySQL-compatible adapter.
- DynamoDB adapter.
- database-specific ORM convenience packages.
- Turso Sync/local-first adapter.
- hybrid coordination/audit composite helpers.

Do not delay stable store contracts to implement every possible database. Do not add Redis merely to satisfy the roadmap; add it when its latency, TTL, or coordination characteristics justify the operational cost.

---

## 27. Suggested Release Sequence

| Release | Scope |
|---|---|
| `0.9.x` | Workspace migration, gateway registry, capabilities, gateway test kit |
| `0.10.x` | Safe Money primitives, typed results, typed/versioned events, runtime portability |
| `0.11.x` | Store contracts, adapter manifests, storage conformance suites, webhook inbox engine |
| `0.12.x` | PostgreSQL, Bun SQLite, and Cloudflare D1 adapters |
| `0.13.x` | Turso/libSQL, SQLite-backed Durable Objects, Redis/Valkey including Bun Redis and Upstash, `better-sqlite3`, and Node SQLite |
| `0.14.x` | Reconciliation package, durable scheduling, and operational diagnostics |
| `1.0.0-rc.x` | Migration validation, schema compatibility, failure-injection tests, and real-application validation |
| `1.0.0` | Stable core, events, store contracts, and primary adapters (PostgreSQL, Bun SQLite, and D1); independently versioned optional adapters may stabilize separately |
| `1.1.x` | Safe routing policies and optional OpenTelemetry integration |
| `1.2.x` | Customers, stored payment methods, and hosted checkout improvements |
| Later | Disputes, marketplace primitives, framework integrations, and additional gateways |

---

## 28. Codex Execution Protocol

Codex must use the following process for every phase or subphase:

1. inspect the current implementation and public exports.
2. identify all contracts and persisted schemas affected.
3. write or update an architecture decision record.
4. add failing behavioral, concurrency, and type-level tests first.
5. implement the smallest complete vertical slice.
6. run all repository tests, not only changed files.
7. run runtime-specific and adapter-specific integration tests.
8. validate build and packed package output.
9. update API docs, migrations, manifests, and migration notes.
10. review security, idempotency, money safety, and crash boundaries.
11. inspect bundle entry points for accidental runtime-specific imports.
12. commit one coherent unit of work at a time.
13. do not begin the next phase until acceptance criteria pass.

### 28.1 Adapter-Specific Codex Checklist

For every adapter, Codex must answer in its implementation report:

- What exact operation is atomic?
- What database primitive enforces atomicity?
- Can two workers claim the same record?
- How is a stale worker fenced out?
- What happens after lease expiry?
- What persists across process or service restart?
- What is the consistency model?
- Is the adapter safe across processes, hosts, and regions?
- What is the cleanup/retention strategy?
- Which values may lose precision through the driver?
- Which driver versions and runtimes were tested?
- What happens if completion persistence fails after an external side effect?

### 28.2 Prohibited Codex Shortcuts

Codex must not:

- implement atomic claims as `get()` then `set()`.
- use process-local mutexes as distributed correctness.
- catch and suppress transaction conflicts without retry policy.
- retry payment mutations after unknown outcomes.
- use raw payload snapshots containing secrets.
- import optional database drivers from a package root.
- use an ORM abstraction without verifying generated SQL under contention.
- call external provider APIs inside database or Durable Object transactions.
- silently acknowledge failed webhooks.
- run production migrations automatically on import.
- add Redis as a mandatory transitive dependency of core, webhooks, or reconciliation packages.

---

## 29. Final Architectural Outcome

At the end of this roadmap, the project should provide:

- a small portable payment core.
- a typed gateway registry and plugin ecosystem.
- explicit provider capabilities.
- exact and safe monetary values.
- unambiguous operation outcomes.
- versioned typed webhook events.
- a reusable webhook inbox with inline and durable retry modes.
- lease-aware idempotency and stale-worker protection.
- reconciliation primitives for uncertain and drifting state.
- correctness-capable storage and coordination adapters for PostgreSQL, Bun SQLite, Node SQLite, `better-sqlite3`, Turso/libSQL, Cloudflare D1, SQLite-backed Durable Objects, and optional Redis/Valkey bindings through Bun Redis, Upstash, ioredis, and node-redis, with durability guarantees declared per adapter.
- gateway and storage conformance test kits.
- mock payment infrastructure.
- optional framework and telemetry integrations.
- clear boundaries between payment execution, durable coordination, and subscription management.

The primary success metric is not the number of gateways or database drivers. It is whether adding, operating, testing, deduplicating, retrying, reconciling, and recovering payment behavior can be done safely without modifying core architecture or duplicating fragile logic across applications.

---

## 30. Current Runtime Notes for Codex

These notes were rechecked during the final review on 2026-08-02. Codex must verify them again against official documentation before implementation and pin the tested versions in each adapter manifest.

- Bun's native Redis client supports Redis server 7.2+, TLS, RESP3, automatic connection management, reconnection, automatic pipelining, environment discovery through `REDIS_URL` and `VALKEY_URL`, and raw command execution through `send()`.
- Bun currently requires raw commands for `MULTI`/`EXEC` and does not support Redis Cluster or Sentinel. The Bun binding must reject unsupported topology configuration rather than degrade silently.
- Bun SQLite exposes a synchronous API and synchronous transaction callbacks. No asynchronous provider or network work may execute inside those callbacks.
- D1 supports prepared statements and transactional `batch()` execution. Correctness-critical read-after-write flows must use an explicit consistency strategy, including Sessions where appropriate.
- SQLite-backed Durable Objects provide private, transactional, strongly consistent storage per object. `transactionSync()` callbacks must remain synchronous, and external provider calls must remain outside storage transactions.
- Durable Object alarms execute at least once and may retry automatically. Alarm handlers therefore require the same idempotency and lease protections as any other retry worker.
- Turso currently recommends `@tursodatabase/serverless` for remote over-the-wire access and retains `@libsql/client` for mature ORM compatibility. Their transaction and concurrency behavior must be tested independently rather than treated as interchangeable.
- `node:sqlite` availability and stability differ by supported Node line. The adapter must publish an exact runtime matrix and must not make the core package's minimum Node version depend on this optional subpath.
- Redis `SET` with conditional options and server-side Lua scripts are useful low-level primitives, but the SDK must still enforce lease tokens, fencing, payload-conflict detection, and explicit crash-boundary semantics.

Codex must not rely on remembered runtime behavior. Recheck the official Bun, Cloudflare, Turso, Node.js, and Redis documentation during implementation and record the verification date in every runtime-specific adapter manifest.

### 30.1 Official References to Recheck

- [Bun Redis](https://bun.sh/docs/runtime/redis)
- [Bun SQLite](https://bun.sh/docs/runtime/sqlite)
- [Cloudflare D1 Workers Binding API](https://developers.cloudflare.com/d1/worker-api/)
- [Cloudflare D1 Database API and transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Turso TypeScript SDK reference](https://docs.turso.tech/sdk/ts/reference)
- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)
- [Redis SET command](https://redis.io/docs/latest/commands/set/)
- [Redis programmability and scripting](https://redis.io/docs/latest/develop/programmability/)
