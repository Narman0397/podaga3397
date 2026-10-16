import { describe, it, expect } from "vitest";
import { curvePctOf, proceedsSol, bundleMetrics } from "@/lib/edge";

describe("shared math", () => {
  it("curve graduates at 85 SOL pooled", () => { expect(curvePctOf(42.5, 0)).toBe(50); expect(curvePctOf(200, 0)).toBe(100); });
  it("curve falls back to $69k mcap", () => expect(curvePctOf(0, 34_500)).toBe(50));
  it("proceeds apply 0.25% fee with no impact when liq is 0", () => expect(proceedsSol(100, 1, 100, 0)).toBeCloseTo(0.9975));
  it("single funding gives zero bundle score", () => expect(bundleMetrics([1], [0]).bundleScore).toBe(0));
  it("identical simultaneous funding scores 100", () => expect(bundleMetrics([1, 1], [0, 0]).bundleScore).toBe(100));
});
