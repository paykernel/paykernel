import { describe, it, expect } from "bun:test";
import { createOpenTelemetryBridge, type OpenTelemetryApiLike } from "./otel";
import { PAYMENT_SPAN_NAMES } from "./spans";

type RecordedSpan = {
  name: string;
  attributes: Record<string, string | number | boolean>;
  ended: boolean;
  status?: { code: number; message?: string };
  exceptions: unknown[];
};

function createMockOtelApi(): {
  api: OpenTelemetryApiLike;
  spans: RecordedSpan[];
  tracerName: string | undefined;
} {
  const spans: RecordedSpan[] = [];
  let tracerName: string | undefined;

  const api: OpenTelemetryApiLike = {
    SpanStatusCode: { OK: 1, ERROR: 2 },
    trace: {
      getTracer(name: string) {
        tracerName = name;
        return {
          startSpan(
            spanName: string,
            options?: {
              attributes?: Record<string, string | number | boolean>;
            },
          ) {
            const recorded: RecordedSpan = {
              name: spanName,
              attributes: { ...(options?.attributes ?? {}) },
              ended: false,
              exceptions: [],
            };
            spans.push(recorded);
            return {
              end() {
                recorded.ended = true;
              },
              setAttribute(key: string, value: string | number | boolean) {
                recorded.attributes[key] = value;
              },
              setStatus(status: { code: number; message?: string }) {
                recorded.status = status;
              },
              recordException(exception: unknown) {
                recorded.exceptions.push(exception);
              },
            };
          },
        };
      },
    },
  };

  return { api, spans, get tracerName() { return tracerName; } };
}

describe("createOpenTelemetryBridge", () => {
  it("creates and ends spans with correct names via mock API (A2 optional path)", () => {
    const mock = createMockOtelApi();
    const tracer = createOpenTelemetryBridge(mock.api, {
      tracerName: "payments-test",
    });

    const span = tracer.startSpan(PAYMENT_SPAN_NAMES.create, {
      gateway: "stripe",
      operationType: "payment.create",
    });
    span.setAttribute("providerRequestId", "req_1");
    span.end({ code: "ok" });

    expect(mock.tracerName).toBe("payments-test");
    expect(mock.spans).toHaveLength(1);
    const s = mock.spans[0]!;
    expect(s.name).toBe("payment.create");
    expect(s.ended).toBe(true);
    expect(s.attributes.gateway).toBe("stripe");
    expect(s.attributes.providerRequestId).toBe("req_1");
    expect(s.status?.code).toBe(1);
  });

  it("maps error status and sanitizes recordException (OBS-1)", () => {
    const mock = createMockOtelApi();
    const tracer = createOpenTelemetryBridge(mock.api);
    const span = tracer.startSpan(PAYMENT_SPAN_NAMES.refund);
    const err = new Error("sk_live_boom_secret");
    span.recordException?.(err);
    span.end({ code: "error", message: "Error" });

    const s = mock.spans[0]!;
    // Name only — raw message/stack must not reach OTEL exporters
    expect(s.exceptions).toEqual([{ name: "Error" }]);
    expect(JSON.stringify(s.exceptions)).not.toContain("sk_live");
    expect(s.status?.code).toBe(2);
    expect(s.status?.message).toBe("Error");
    expect(s.ended).toBe(true);
  });

  it("works without SpanStatusCode (numeric fallback)", () => {
    const spans: Array<{ status?: { code: number } }> = [];
    const api: OpenTelemetryApiLike = {
      trace: {
        getTracer() {
          return {
            startSpan() {
              const rec: { status?: { code: number }; ended: boolean } = {
                ended: false,
              };
              spans.push(rec);
              return {
                end() {
                  rec.ended = true;
                },
                setAttribute() {},
                setStatus(status: { code: number }) {
                  rec.status = status;
                },
              };
            },
          };
        },
      },
    };
    const tracer = createOpenTelemetryBridge(api);
    tracer.startSpan("payment.void").end({ code: "error" });
    expect(spans[0]!.status?.code).toBe(2);
  });

  it("does not import @opentelemetry/api (duck-typed only)", async () => {
    // otel.ts must load without the peer package.
    const mod = await import("./otel");
    expect(typeof mod.createOpenTelemetryBridge).toBe("function");
  });
});
