import { AlertInput } from "@screener/shared";
import { describe, expect, it } from "vitest";

/**
 * Cross-field validation: FUNDING_RATE / OPEN_INTEREST require futures.
 * The same Zod schema is used by both backend and frontend.
 */
describe("AlertInput validation", () => {
  it("accepts FUNDING_RATE on futures", () => {
    const r = AlertInput.safeParse({
      symbol: "BTCUSDT",
      exchange: "mock",
      marketType: "futures",
      conditionType: "FUNDING_RATE",
      operator: ">",
      threshold: 0.01,
    });
    expect(r.success).toBe(true);
  });

  it("rejects FUNDING_RATE on spot", () => {
    const r = AlertInput.safeParse({
      symbol: "BTCUSDT",
      exchange: "mock",
      marketType: "spot",
      conditionType: "FUNDING_RATE",
      operator: ">",
      threshold: 0.01,
    });
    expect(r.success).toBe(false);
  });

  it("rejects OPEN_INTEREST on spot", () => {
    const r = AlertInput.safeParse({
      symbol: "BTCUSDT",
      exchange: "mock",
      marketType: "spot",
      conditionType: "OPEN_INTEREST",
      operator: ">=",
      threshold: 1,
    });
    expect(r.success).toBe(false);
  });

  it("default cooldownSeconds is 300", () => {
    const r = AlertInput.parse({
      symbol: "ETHUSDT",
      exchange: "mock",
      marketType: "spot",
      conditionType: "PRICE_CHANGE_5M",
      operator: ">",
      threshold: 1,
    });
    expect(r.cooldownSeconds).toBe(300);
  });
});
