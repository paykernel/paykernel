import { describe, expect, it } from "bun:test";
import {
  classifyReconciliationClaimMiss,
  decideIdempotencyReserve,
  decideLeaseMutation,
  decideReconciliationClaim,
  decideWebhookClaim,
  evaluateClaim,
  isActiveLeaseToken,
} from "./algorithm";
import {
  idempotencyCompleteTemplates,
  idempotencyReserveTemplates,
  pickClaimTemplate,
  reconciliationClaimTemplates,
  reconciliationTimestampRepairTemplates,
  webhookClaimTemplates,
  webhookCompleteTemplates,
  webhookFailTemplates,
  type ClaimTemplateSet,
} from "./templates";
import { createSchemaNamespace } from "../schema/namespace";
import {
  IDEMPOTENCY_COLUMNS,
  RECONCILIATION_COLUMNS,
  WEBHOOK_INBOX_COLUMNS,
} from "../schema/tables";
import { buildFoundationMigrationSql } from "../migrations/definitions";

const nowMs = Date.parse("2026-01-15T12:00:00.000Z");

describe("decideIdempotencyReserve", () => {
  it("inserts when absent", () => {
    const d = decideIdempotencyReserve({
      key: "k",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 30_000,
      newLeaseToken: "tok1",
      clock: { nowMs },
    });
    expect(d.kind).toBe("acquired");
    if (d.kind === "acquired") {
      expect(d.action).toBe("insert");
      expect(d.generation).toBe(1);
      expect(d.attempts).toBe(1);
      expect(d.leaseToken).toBe("tok1");
    }
  });

  it("blocks completed / indeterminate / fingerprint conflict / in_progress", () => {
    const base = {
      fingerprint: "fp",
      leaseExpiresAt: "2026-01-15T12:01:00.000Z",
      generation: 1,
      attempts: 1,
      createdAt: "2026-01-15T11:00:00.000Z",
    };
    expect(
      decideIdempotencyReserve({
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "completed" },
      }).kind,
    ).toBe("already_completed");

    expect(
      decideIdempotencyReserve({
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "indeterminate" },
      }).kind,
    ).toBe("indeterminate");

    expect(
      decideIdempotencyReserve({
        key: "k",
        fingerprint: "other",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "reserved" },
      }).kind,
    ).toBe("fingerprint_conflict");

    expect(
      decideIdempotencyReserve({
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "reserved" },
      }).kind,
    ).toBe("in_progress");
  });

  it("reclaims expired lease with generation++", () => {
    const d = decideIdempotencyReserve({
      key: "k",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 30_000,
      newLeaseToken: "tok2",
      clock: { nowMs },
      existing: {
        status: "reserved",
        fingerprint: "fp",
        leaseExpiresAt: "2026-01-15T11:59:00.000Z",
        generation: 3,
        attempts: 2,
        createdAt: "2026-01-15T11:00:00.000Z",
      },
    });
    expect(d.kind).toBe("acquired");
    if (d.kind === "acquired") {
      expect(d.action).toBe("update");
      expect(d.generation).toBe(4);
      expect(d.attempts).toBe(3);
    }
  });

  it("reclaims status=expired rows", () => {
    const d = decideIdempotencyReserve({
      key: "k",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1000,
      newLeaseToken: "t2",
      clock: { nowMs },
      existing: {
        status: "expired",
        fingerprint: "fp",
        generation: 1,
        attempts: 1,
        createdAt: "2026-01-15T11:00:00.000Z",
      },
    });
    expect(d.kind).toBe("acquired");
    if (d.kind === "acquired") {
      expect(d.generation).toBe(2);
    }
  });

  it("does NOT re-lease indeterminate (A4)", () => {
    const d = decideIdempotencyReserve({
      key: "k",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1000,
      newLeaseToken: "t",
      clock: { nowMs },
      existing: {
        status: "indeterminate",
        fingerprint: "fp",
        generation: 2,
        attempts: 2,
        createdAt: "2026-01-15T11:00:00.000Z",
        // even with expired lease fields, indeterminate blocks
        leaseExpiresAt: "2026-01-15T11:00:00.000Z",
      },
    });
    expect(d.kind).toBe("indeterminate");
  });
});

describe("decideWebhookClaim", () => {
  it("acquires new and detects payload hash conflict", () => {
    const acquired = decideWebhookClaim({
      key: "e1",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 5000,
      newLeaseToken: "t",
      clock: { nowMs },
    });
    expect(acquired.kind).toBe("acquired");

    const conflict = decideWebhookClaim({
      key: "e1",
      payloadHash: "h2",
      owner: "w",
      leaseMs: 5000,
      newLeaseToken: "t",
      clock: { nowMs },
      existing: {
        status: "claimed",
        payloadHash: "h1",
        leaseExpiresAt: "2026-01-15T12:01:00.000Z",
        generation: 1,
        attempts: 1,
        createdAt: "2026-01-15T11:00:00.000Z",
        availableAt: "2026-01-15T11:00:00.000Z",
      },
    });
    expect(conflict.kind).toBe("payload_hash_conflict");
  });

  it("WEBHOOKS-1: terminal completed/dead_letter/failed before payload_hash_conflict", () => {
    const base = {
      payloadHash: "h1",
      generation: 1,
      attempts: 1,
      createdAt: "2026-01-15T11:00:00.000Z",
      availableAt: "2026-01-15T11:00:00.000Z",
    };

    // Mismatched hash on completed → already_completed (not payload_hash_conflict)
    expect(
      decideWebhookClaim({
        key: "e",
        payloadHash: "h2-different",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "completed" },
      }).kind,
    ).toBe("already_completed");

    expect(
      decideWebhookClaim({
        key: "e",
        payloadHash: "h2-different",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "dead_letter" },
      }).kind,
    ).toBe("duplicate_failed");

    expect(
      decideWebhookClaim({
        key: "e",
        payloadHash: "h2-different",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "failed" },
      }).kind,
    ).toBe("duplicate_failed");

    // Non-terminal still conflicts on hash mismatch
    expect(
      decideWebhookClaim({
        key: "e",
        payloadHash: "h2-different",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "pending" },
      }).kind,
    ).toBe("payload_hash_conflict");
  });

  it("covers pending reclaim, completed, dead_letter, failed, in_progress, expired claim", () => {
    const base = {
      payloadHash: "h1",
      generation: 1,
      attempts: 1,
      createdAt: "2026-01-15T11:00:00.000Z",
      availableAt: "2026-01-15T11:00:00.000Z",
    };

    const pending = decideWebhookClaim({
      key: "e",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 1000,
      newLeaseToken: "t2",
      clock: { nowMs },
      existing: { ...base, status: "pending" },
    });
    expect(pending.kind).toBe("acquired");
    if (pending.kind === "acquired") {
      expect(pending.action).toBe("update");
      expect(pending.generation).toBe(2);
    }

    expect(
      decideWebhookClaim({
        key: "e",
        payloadHash: "h1",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "completed" },
      }).kind,
    ).toBe("already_completed");

    expect(
      decideWebhookClaim({
        key: "e",
        payloadHash: "h1",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "dead_letter" },
      }).kind,
    ).toBe("duplicate_failed");

    expect(
      decideWebhookClaim({
        key: "e",
        payloadHash: "h1",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: { ...base, status: "failed" },
      }).kind,
    ).toBe("duplicate_failed");

    expect(
      decideWebhookClaim({
        key: "e",
        payloadHash: "h1",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: {
          ...base,
          status: "claimed",
          leaseExpiresAt: "2026-01-15T12:01:00.000Z",
        },
      }).kind,
    ).toBe("in_progress");

    const expired = decideWebhookClaim({
      key: "e",
      payloadHash: "h1",
      owner: "w2",
      leaseMs: 1000,
      newLeaseToken: "t3",
      clock: { nowMs },
      existing: {
        ...base,
        status: "claimed",
        leaseExpiresAt: "2026-01-15T11:59:00.000Z",
        generation: 5,
        attempts: 4,
      },
    });
    expect(expired.kind).toBe("acquired");
    if (expired.kind === "acquired") {
      expect(expired.generation).toBe(6);
      // WEBHOOKS-1: expired claimed reclaim keeps attempts (crash recovery)
      expect(expired.attempts).toBe(4);
      expect(expired.leaseToken).toBe("t3");
    }

    // pending reclaim still burns an attempt (handler retry path)
    const pendingRetry = decideWebhookClaim({
      key: "e",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 1000,
      newLeaseToken: "t4",
      clock: { nowMs },
      existing: { ...base, status: "pending", attempts: 2 },
    });
    expect(pendingRetry.kind).toBe("acquired");
    if (pendingRetry.kind === "acquired") {
      expect(pendingRetry.attempts).toBe(3);
    }
  });

  it("blocks pending when availableAt is in the future (not_available)", () => {
    const blocked = decideWebhookClaim({
      key: "e",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 1000,
      newLeaseToken: "t",
      clock: { nowMs },
      existing: {
        status: "pending",
        payloadHash: "h1",
        generation: 2,
        attempts: 2,
        createdAt: "2026-01-15T11:00:00.000Z",
        availableAt: "2026-01-15T12:30:00.000Z",
      },
    });
    expect(blocked.kind).toBe("not_available");
  });

  it("allows pending reclaim when availableAt is due", () => {
    const due = decideWebhookClaim({
      key: "e",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 1000,
      newLeaseToken: "t2",
      clock: { nowMs },
      existing: {
        status: "pending",
        payloadHash: "h1",
        generation: 2,
        attempts: 2,
        createdAt: "2026-01-15T11:00:00.000Z",
        availableAt: "2026-01-15T11:59:00.000Z",
      },
    });
    expect(due.kind).toBe("acquired");
  });

  it("allows expired lease reclaim even when availableAt is still future", () => {
    const reclaim = decideWebhookClaim({
      key: "e",
      payloadHash: "h1",
      owner: "w2",
      leaseMs: 1000,
      newLeaseToken: "t3",
      clock: { nowMs },
      existing: {
        status: "claimed",
        payloadHash: "h1",
        leaseExpiresAt: "2026-01-15T11:59:00.000Z",
        generation: 3,
        attempts: 3,
        createdAt: "2026-01-15T11:00:00.000Z",
        availableAt: "2026-01-15T12:30:00.000Z",
      },
    });
    expect(reclaim.kind).toBe("acquired");
    if (reclaim.kind === "acquired") {
      expect(reclaim.generation).toBe(4);
    }
  });
});

describe("decideReconciliationClaim", () => {
  it("not_found / not_due / acquires when due", () => {
    expect(
      decideReconciliationClaim({
        key: "r",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
      }).kind,
    ).toBe("not_found");

    expect(
      decideReconciliationClaim({
        key: "r",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: {
          status: "scheduled",
          generation: 0,
          attempts: 0,
          dueAt: "2026-01-15T13:00:00.000Z",
          createdAt: "2026-01-15T11:00:00.000Z",
          subjectId: "s",
          reason: "x",
        },
      }).kind,
    ).toBe("not_due");

    const acq = decideReconciliationClaim({
      key: "r",
      owner: "w",
      leaseMs: 1000,
      newLeaseToken: "t",
      clock: { nowMs },
      existing: {
        status: "scheduled",
        generation: 0,
        attempts: 0,
        dueAt: "2026-01-15T11:00:00.000Z",
        createdAt: "2026-01-15T10:00:00.000Z",
        subjectId: "s",
        reason: "x",
      },
    });
    expect(acq.kind).toBe("acquired");
    if (acq.kind === "acquired") {
      expect(acq.generation).toBe(1);
      expect(acq.attempts).toBe(1);
    }
  });

  it("blocks terminal and active claim; reclaims expired claim", () => {
    const base = {
      generation: 2,
      attempts: 2,
      dueAt: "2026-01-15T11:00:00.000Z",
      createdAt: "2026-01-15T10:00:00.000Z",
      subjectId: "s",
      reason: "x",
    };
    for (const status of ["completed", "failed", "manual_review"] as const) {
      expect(
        decideReconciliationClaim({
          key: "r",
          owner: "w",
          leaseMs: 1000,
          newLeaseToken: "t",
          clock: { nowMs },
          existing: { ...base, status },
        }).kind,
      ).toBe("already_terminal");
    }
    expect(
      decideReconciliationClaim({
        key: "r",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
        existing: {
          ...base,
          status: "claimed",
          leaseExpiresAt: "2026-01-15T12:01:00.000Z",
        },
      }).kind,
    ).toBe("in_progress");

    const reclaim = decideReconciliationClaim({
      key: "r",
      owner: "w2",
      leaseMs: 1000,
      newLeaseToken: "t2",
      clock: { nowMs },
      existing: {
        ...base,
        status: "claimed",
        leaseExpiresAt: "2026-01-15T11:00:00.000Z",
      },
    });
    expect(reclaim.kind).toBe("acquired");
    if (reclaim.kind === "acquired") {
      expect(reclaim.generation).toBe(3);
    }
  });
});

describe("classifyReconciliationClaimMiss (SQL-2)", () => {
  it("never classifies free due scheduled work as in_progress", () => {
    // Offset form that is due by Date.parse but fails lexical TEXT compare vs Z now.
    expect(
      classifyReconciliationClaimMiss(
        {
          status: "scheduled",
          dueAt: "2026-01-15T14:00:00+05:00", // 09:00Z < 12:00Z
        },
        nowMs,
      ),
    ).toBe("claimable");
  });

  it("classifies free expired-lease claimed+due work as claimable (not in_progress)", () => {
    expect(
      classifyReconciliationClaimMiss(
        {
          status: "claimed",
          dueAt: "2026-01-15T11:00:00.000Z",
          leaseExpiresAt: "2026-01-15T11:30:00.000Z",
        },
        nowMs,
      ),
    ).toBe("claimable");
  });

  it("classifies active foreign lease as in_progress", () => {
    expect(
      classifyReconciliationClaimMiss(
        {
          status: "claimed",
          dueAt: "2026-01-15T11:00:00.000Z",
          leaseExpiresAt: "2026-01-15T12:30:00.000Z",
        },
        nowMs,
      ),
    ).toBe("in_progress");
  });

  it("classifies not_due / terminal / not_found", () => {
    expect(classifyReconciliationClaimMiss(undefined, nowMs)).toBe("not_found");
    expect(
      classifyReconciliationClaimMiss(
        { status: "scheduled", dueAt: "2026-01-15T13:00:00.000Z" },
        nowMs,
      ),
    ).toBe("not_due");
    expect(
      classifyReconciliationClaimMiss(
        { status: "completed", dueAt: "2026-01-15T11:00:00.000Z" },
        nowMs,
      ),
    ).toBe("already_terminal");
  });
});

describe("evaluateClaim (unified pure dispatcher)", () => {
  it("dispatches all three stores", () => {
    const id = evaluateClaim({
      store: "idempotency",
      input: {
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
      },
    });
    expect(id.store).toBe("idempotency");
    expect(id.decision.kind).toBe("acquired");

    const wh = evaluateClaim({
      store: "webhook",
      input: {
        key: "e",
        payloadHash: "h",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
      },
    });
    expect(wh.store).toBe("webhook");
    expect(wh.decision.kind).toBe("acquired");

    const rec = evaluateClaim({
      store: "reconciliation",
      input: {
        key: "r",
        owner: "w",
        leaseMs: 1000,
        newLeaseToken: "t",
        clock: { nowMs },
      },
    });
    expect(rec.store).toBe("reconciliation");
    expect(rec.decision.kind).toBe("not_found");
  });
});

describe("decideLeaseMutation / isActiveLeaseToken", () => {
  it("requires matching token, status, and unexpired lease", () => {
    expect(
      isActiveLeaseToken({
        recordToken: "a",
        providedToken: "a",
        leaseExpiresAt: "2026-01-15T12:01:00.000Z",
        nowMs,
        status: "reserved",
        expectedStatus: "reserved",
      }),
    ).toBe(true);
    expect(
      isActiveLeaseToken({
        recordToken: "a",
        providedToken: "b",
        leaseExpiresAt: "2026-01-15T12:01:00.000Z",
        nowMs,
        status: "reserved",
        expectedStatus: "reserved",
      }),
    ).toBe(false);
  });

  it("covers not_found / wrong_status / lease_lost / ok branches", () => {
    expect(
      decideLeaseMutation({
        exists: false,
        status: "",
        expectedStatus: "reserved",
        recordToken: null,
        providedToken: "t",
        leaseExpiresAt: null,
        nowMs,
      }),
    ).toEqual({ ok: false, reason: "not_found" });

    expect(
      decideLeaseMutation({
        exists: true,
        status: "completed",
        expectedStatus: "reserved",
        recordToken: "t",
        providedToken: "t",
        leaseExpiresAt: "2026-01-15T12:01:00.000Z",
        nowMs,
      }),
    ).toEqual({ ok: false, reason: "wrong_status" });

    expect(
      decideLeaseMutation({
        exists: true,
        status: "reserved",
        expectedStatus: "reserved",
        recordToken: "old",
        providedToken: "stale",
        leaseExpiresAt: "2026-01-15T12:01:00.000Z",
        nowMs,
      }),
    ).toEqual({ ok: false, reason: "lease_lost" });

    expect(
      decideLeaseMutation({
        exists: true,
        status: "reserved",
        expectedStatus: "reserved",
        recordToken: "t",
        providedToken: "t",
        leaseExpiresAt: "2026-01-15T11:00:00.000Z",
        nowMs,
      }),
    ).toEqual({ ok: false, reason: "lease_lost" });

    expect(
      decideLeaseMutation({
        exists: true,
        status: "reserved",
        expectedStatus: "reserved",
        recordToken: "t",
        providedToken: "t",
        leaseExpiresAt: "2026-01-15T12:01:00.000Z",
        nowMs,
      }),
    ).toEqual({ ok: true });

    // markIndeterminate-style: token match without requiring active lease
    expect(
      decideLeaseMutation({
        exists: true,
        status: "reserved",
        expectedStatus: "reserved",
        recordToken: "t",
        providedToken: "t",
        leaseExpiresAt: "2026-01-15T11:00:00.000Z",
        nowMs,
        requireActiveLease: false,
      }),
    ).toEqual({ ok: true });
  });
});

describe("dialect claim templates", () => {
  it("does not pretend postgres === sqlite", () => {
    const ns = createSchemaNamespace({ tablePrefix: "pay_" });
    const set = idempotencyReserveTemplates(ns);
    expect(set.postgres.sql).not.toBe(set.sqlite.sql);
    expect(set.postgres.sql).toContain("ON CONFLICT");
    expect(set.sqlite.sql).toContain("INSERT OR IGNORE");
    expect(set.postgres.sql).toContain("pay_payment_idempotency");

    const wh = webhookClaimTemplates(ns);
    expect(pickClaimTemplate(wh, "postgres").dialect).toBe("postgres");
    expect(pickClaimTemplate(wh, "sqlite").sql).toContain("INSERT OR IGNORE");
    // B4: pending reclaim requires available_at <= now; expired claimed may reclaim.
    expect(wh.postgres.sql).toContain("available_at");
    expect(wh.postgres.sql).toContain("status = 'pending'");
    expect(wh.postgres.sql).toContain("status = 'claimed'");
    expect(wh.sqlite.sql).toContain("available_at");

    const rec = reconciliationClaimTemplates(ns);
    expect(rec.postgres.sql).toContain("UPDATE");
    expect(rec.sqlite.sql).toContain("UPDATE");
    expect(rec.postgres.params).not.toEqual(rec.sqlite.params);

    // SQL-1: timestamp repair free-lease fence (never overwrite active winner lease).
    const repair = reconciliationTimestampRepairTemplates(ns);
    for (const frag of [repair.postgres, repair.sqlite]) {
      expect(frag.sql).toContain("due_at");
      expect(frag.sql).toContain("lease_expires_at");
      expect(frag.sql).toContain("status = 'scheduled'");
      expect(frag.sql).toMatch(/lease_expires_at IS NULL/i);
      expect(frag.sql).toMatch(/lease_expires_at\s*<=/i);
      expect(frag.sql).toContain("NOT IN ('completed', 'failed', 'manual_review')");
      // Must not be an unfenced key-only repair.
      expect(frag.sql).not.toMatch(
        /WHERE key = \S+\s+AND status NOT IN \('completed', 'failed', 'manual_review'\)\s*$/i,
      );
    }
    expect(repair.postgres.params).toEqual(["key", "dueAt", "leaseExpiresAt", "now"]);
    expect(repair.sqlite.params).toEqual(["dueAt", "leaseExpiresAt", "key", "now"]);
  });

  it("never leaves unvalidated table placeholders like raw user input", () => {
    const set = idempotencyReserveTemplates();
    expect(set.postgres.sql).toContain('"payment_idempotency"');
    expect(set.postgres.sql).not.toMatch(/\$\{/);
  });

  it("complete/fail templates fence on lease_token with prepared params only", () => {
    const id = idempotencyCompleteTemplates();
    expect(id.postgres.sql).toContain("lease_token = $2");
    expect(id.postgres.sql).toContain("status = 'reserved'");
    expect(id.sqlite.sql).toContain("lease_token = ?");
    expect(id.intent.toLowerCase()).toContain("atomic");

    const whc = webhookCompleteTemplates();
    expect(whc.postgres.sql).toContain("status = 'claimed'");
    const whf = webhookFailTemplates();
    expect(whf.postgres.params).toContain("lastError");
    expect(whf.postgres.params).toContain("restoreAttemptFlag");
    expect(whf.sqlite.params).toContain("restoreAttemptFlag");
    expect(whf.postgres.sql).toContain("last_error_sanitized");
    expect(whf.sqlite.sql).toContain("last_error_sanitized");
    expect(whf.postgres.sql).toContain("attempts");
    expect(whf.sqlite.sql).toContain("attempts");
    // Must never write the non-existent bare column name.
    expect(whf.postgres.sql).not.toMatch(/\blast_error\s*=/);
    expect(whf.sqlite.sql).not.toMatch(/\blast_error\s*=/);
    expect(whf.postgres.sql).not.toMatch(/\$\{/);
  });

  it("documents same logical transitions across dialects", () => {
    const set = idempotencyReserveTemplates();
    expect(set.intent).toContain("No get-then-set");
    expect(set.postgres.intent).toContain("Atomic reserve");
    expect(set.sqlite.intent).toContain("SQLite");
  });

  it("template SET columns are a subset of foundation DDL / column maps", () => {
    /**
     * Regression for B1: webhookFailTemplates used `last_error` while DDL,
     * codecs, and column maps use `last_error_sanitized`. Every assignment
     * target after SET (including ON CONFLICT DO UPDATE SET) must appear in
     * the canonical column map and in foundation CREATE TABLE bodies.
     */
    const columnMapValues = (map: Record<string, string>): Set<string> =>
      new Set(Object.values(map));

    const extractSetColumns = (sql: string): string[] => {
      const cols: string[] = [];
      // Split on bare SET (UPDATE ... SET / DO UPDATE SET); ignore WHERE/RETURNING tails.
      const chunks = sql.split(/\bSET\b/i);
      for (let i = 1; i < chunks.length; i++) {
        const assignmentBlock = (chunks[i] ?? "").split(/\bWHERE\b/i)[0] ?? "";
        for (const m of assignmentBlock.matchAll(
          /(?:^|[,;\n])\s*(?:(?:"[^"]+"|[\w]+)\.)?([a-z_][a-z0-9_]*)\s*=/gi,
        )) {
          const col = m[1]?.toLowerCase();
          if (col) cols.push(col);
        }
      }
      return cols;
    };

    const extractDdlColumns = (ddl: string, tableLogical: string): Set<string> => {
      // Match CREATE TABLE ... ( ... ) for the logical name (quoted or bare).
      const re = new RegExp(
        `CREATE TABLE IF NOT EXISTS\\s+(?:"[^"]*"\\.)?"?${tableLogical}"?\\s*\\(([^;]+?)\\)`,
        "is",
      );
      const body = ddl.match(re)?.[1] ?? "";
      const cols = new Set<string>();
      for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || /^(CHECK|PRIMARY|UNIQUE|FOREIGN|CONSTRAINT)\b/i.test(trimmed)) continue;
        const m = trimmed.match(/^([a-z_][a-z0-9_]*)\b/i);
        if (m?.[1]) cols.add(m[1].toLowerCase());
      }
      return cols;
    };

    const assertSetColsSubset = (
      label: string,
      set: ClaimTemplateSet,
      allowed: Set<string>,
      ddlCols: Set<string>,
    ) => {
      for (const dialect of ["postgres", "sqlite"] as const) {
        const sql = set[dialect].sql;
        const setCols = extractSetColumns(sql);
        expect(setCols.length).toBeGreaterThan(0);
        for (const col of setCols) {
          expect(allowed.has(col), `${label}/${dialect} SET col "${col}" ∉ column map`).toBe(true);
          expect(ddlCols.has(col), `${label}/${dialect} SET col "${col}" ∉ foundation DDL`).toBe(
            true,
          );
        }
      }
    };

    const sqliteDdl = buildFoundationMigrationSql("sqlite", (logical) => `"${logical}"`);
    const postgresDdl = buildFoundationMigrationSql("postgres", (logical) => `"${logical}"`);

    const idemMap = columnMapValues(IDEMPOTENCY_COLUMNS);
    const webhookMap = columnMapValues(WEBHOOK_INBOX_COLUMNS);
    const reconMap = columnMapValues(RECONCILIATION_COLUMNS);

    const idemDdl = extractDdlColumns(sqliteDdl, "payment_idempotency");
    const webhookDdl = extractDdlColumns(sqliteDdl, "payment_webhook_inbox");
    const reconDdl = extractDdlColumns(postgresDdl, "payment_reconciliation_jobs");

    // Column maps and DDL must themselves agree on sanitized error names.
    expect(webhookMap.has("last_error_sanitized")).toBe(true);
    expect(webhookDdl.has("last_error_sanitized")).toBe(true);
    expect(webhookMap.has("last_error")).toBe(false);
    expect(webhookDdl.has("last_error")).toBe(false);

    assertSetColsSubset("idempotencyReserve", idempotencyReserveTemplates(), idemMap, idemDdl);
    assertSetColsSubset("idempotencyComplete", idempotencyCompleteTemplates(), idemMap, idemDdl);
    assertSetColsSubset("webhookClaim", webhookClaimTemplates(), webhookMap, webhookDdl);
    assertSetColsSubset("webhookComplete", webhookCompleteTemplates(), webhookMap, webhookDdl);
    assertSetColsSubset("webhookFail", webhookFailTemplates(), webhookMap, webhookDdl);
    assertSetColsSubset("reconciliationClaim", reconciliationClaimTemplates(), reconMap, reconDdl);
  });
});
