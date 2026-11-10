// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { insertPerfMetric } = vi.hoisted(() => ({ insertPerfMetric: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 1 } })),
}));
vi.mock("@/lib/db/perf", () => ({
  insertPerfMetric,
  PERF_METRICS: ["LCP", "INP", "CLS", "FCP", "TTFB", "FID"],
}));
vi.mock("@/lib/logger", () => ({
  forModule: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

import { POST } from "./route";

const post = (raw: string) =>
  POST(new Request("http://localhost/api/perf", { method: "POST", body: raw }));
const metric = (m = "LCP") => ({ source: "web", metric: m, value: 1200, rating: "good", path: "/" });

beforeEach(() => insertPerfMetric.mockClear());

describe("POST /api/perf payload validation", () => {
  it("accepts a legacy single metric and a batch", async () => {
    expect((await post(JSON.stringify(metric()))).status).toBe(204);
    expect((await post(JSON.stringify({ metrics: [metric("LCP"), metric("CLS")] }))).status).toBe(204);
    expect(insertPerfMetric).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["a null batch element", { metrics: [null] }],
    ["a primitive batch element", { metrics: [5] }],
    ["a string batch element", { metrics: ["LCP"] }],
    ["an array batch element", { metrics: [[metric()]] }],
    ["a valid element followed by null", { metrics: [metric(), null] }],
    ["a non-array metrics value", { metrics: { a: 1 } }],
    ["an empty batch", { metrics: [] }],
    ["more than 10 elements", { metrics: Array.from({ length: 11 }, () => metric()) }],
  ])("returns 400 (not a 500/TypeError) for %s", async (_label, body) => {
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(insertPerfMetric).not.toHaveBeenCalled();
  });

  it.each(["null", "5", '"str"', "true", "[]", "[null]"])(
    "returns 400 for the top-level JSON value %s",
    async (raw) => {
      const res = await post(raw);
      expect(res.status).toBe(400);
      expect(insertPerfMetric).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for invalid JSON", async () => {
    expect((await post("{nope")).status).toBe(400);
  });

  it("writes nothing from a batch that contains one bad metric", async () => {
    const res = await post(JSON.stringify({ metrics: [metric(), { ...metric(), metric: "NOPE" }] }));
    expect(res.status).toBe(400);
    expect(insertPerfMetric).not.toHaveBeenCalled();
  });
});
