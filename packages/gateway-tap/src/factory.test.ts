import { describe, expect, it } from "bun:test";
import {
  createDefaultGatewayContext,
  createPaymentClient,
  HooksManager,
  InvalidRequestError,
} from "@paykernel/core";
import { TAP_CAPABILITIES } from "./capabilities";
import { tapGateway } from "./factory";
import { TapGateway } from "./gateway";
import { TAP_TEST_SECRET } from "./fixtures/charges";

describe("tapGateway", () => {
  it("rejects empty secretKey", () => {
    expect(() => tapGateway({ secretKey: "  " })).toThrow(InvalidRequestError);
  });

  it("rejects non-positive timeoutMs on TapGateway as well as the factory", () => {
    expect(
      () =>
        new TapGateway(
          { secretKey: TAP_TEST_SECRET, timeoutMs: 0 },
          new HooksManager({}),
        ),
    ).toThrow(InvalidRequestError);
  });

  it("rejects non-positive timeoutMs", () => {
    expect(() =>
      tapGateway({ secretKey: TAP_TEST_SECRET, timeoutMs: 0 }),
    ).toThrow(InvalidRequestError);
    expect(() =>
      tapGateway({ secretKey: TAP_TEST_SECRET, timeoutMs: -1 }),
    ).toThrow(InvalidRequestError);
  });

  it("closes over secrets and keeps them off the manifest", () => {
    const adapter = tapGateway({ secretKey: TAP_TEST_SECRET });
    expect(adapter.name).toBe("tap");
    expect(adapter.manifest.name).toBe("tap");
    expect(adapter.manifest.capabilities).toEqual(TAP_CAPABILITIES);
    expect(JSON.stringify(adapter.manifest)).not.toContain(TAP_TEST_SECRET);
    const gateway = adapter.create(createDefaultGatewayContext());
    expect(gateway).toBeInstanceOf(TapGateway);
    expect(gateway.name).toBe("tap");
    expect(gateway.supports("payments")).toBe(true);
    expect(gateway.supports("hostedCheckout")).toBe(false);
    expect(gateway.supports("customers")).toBe(false);
  });

  it("composes with createPaymentClient without core factory edits", () => {
    const client = createPaymentClient({
      gateways: { tap: tapGateway({ secretKey: TAP_TEST_SECRET }) },
      defaultGateway: "tap",
    });
    expect(client.gateway("tap")).toBeInstanceOf(TapGateway);
    expect(client.hasGateway("tap")).toBe(true);
  });
});
