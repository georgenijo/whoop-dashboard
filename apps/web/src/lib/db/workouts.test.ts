import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./connection", () => ({
  dateRangeClause: () => ({ clause: "", params: [] }),
  hasTable: () => false,
  safeQuery: () => null,
}));

import { sanitizeLimit } from "./workouts";

const DEFAULT = 50;
const MAX = 500;

describe("sanitizeLimit", () => {
  it("returns default for undefined", () => {
    expect(sanitizeLimit(undefined)).toBe(DEFAULT);
  });

  it("returns default for non-number input", () => {
    expect(sanitizeLimit("100")).toBe(DEFAULT);
    expect(sanitizeLimit(null)).toBe(DEFAULT);
    expect(sanitizeLimit({})).toBe(DEFAULT);
  });

  it("returns default for NaN", () => {
    expect(sanitizeLimit(NaN)).toBe(DEFAULT);
  });

  it("returns default for Infinity", () => {
    expect(sanitizeLimit(Infinity)).toBe(DEFAULT);
    expect(sanitizeLimit(-Infinity)).toBe(DEFAULT);
  });

  it("returns default for zero", () => {
    expect(sanitizeLimit(0)).toBe(DEFAULT);
  });

  it("returns default for negative numbers", () => {
    expect(sanitizeLimit(-1)).toBe(DEFAULT);
    expect(sanitizeLimit(-1000)).toBe(DEFAULT);
  });

  it("returns default for fractional values that floor to 0 (regression: 0.5 must NOT yield LIMIT 0)", () => {
    expect(sanitizeLimit(0.5)).toBe(DEFAULT);
    expect(sanitizeLimit(0.99)).toBe(DEFAULT);
  });

  it("floors positive fractional values to integers", () => {
    expect(sanitizeLimit(10.7)).toBe(10);
    expect(sanitizeLimit(1.1)).toBe(1);
  });

  it("returns the value when within range", () => {
    expect(sanitizeLimit(1)).toBe(1);
    expect(sanitizeLimit(50)).toBe(50);
    expect(sanitizeLimit(500)).toBe(500);
  });

  it("caps over-limit values at MAX_WORKOUTS_LIMIT (500)", () => {
    expect(sanitizeLimit(501)).toBe(MAX);
    expect(sanitizeLimit(1_000_000)).toBe(MAX);
    expect(sanitizeLimit(Number.MAX_SAFE_INTEGER)).toBe(MAX);
  });
});
