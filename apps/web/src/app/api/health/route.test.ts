import { describe, expect, it } from "vitest";
import { GET } from "./route";

// Guards a discriminator that is NOT obvious from reading the code: Next 16.2.4
// synthesizes x-forwarded-for/-host/-port/-proto on EVERY request, so a direct
// `curl localhost:8501` arrives carrying `x-forwarded-for: ::1`. An
// absence-of-header check therefore never matches and would strip the sha from
// the deploy verification itself. If a future Next version stops synthesizing
// these, the first case here still passes (no xff -> direct) — but if someone
// "simplifies" this to a presence check, the first case fails loudly.
function req(headers: Record<string, string>): Request {
  return new Request("http://localhost:8501/api/health", { headers });
}

async function body(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

describe("GET /api/health", () => {
  it("direct on-box call (Next-synthesized loopback xff) gets the build sha", async () => {
    const b = await body(GET(req({ "x-forwarded-for": "::1" })));
    expect(b.status).toBe("ok");
    expect(b.sha).toBeDefined();
    expect(b.built_at).toBeDefined();
  });

  it("direct call with no forwarding headers at all gets the sha", async () => {
    const b = await body(GET(req({})));
    expect(b.sha).toBeDefined();
  });

  it.each([["127.0.0.1"], ["::ffff:127.0.0.1"]])(
    "treats %s as loopback",
    async (addr) => {
      const b = await body(GET(req({ "x-forwarded-for": addr })));
      expect(b.sha).toBeDefined();
    },
  );

  it("public request through nginx gets status only — no sha", async () => {
    const b = await body(
      GET(req({ "x-forwarded-for": "203.0.113.9, ::1", "x-real-ip": "203.0.113.9" })),
    );
    expect(b).toEqual({ status: "ok" });
  });

  it("fails closed when x-real-ip is present even if xff claims loopback", async () => {
    const b = await body(
      GET(req({ "x-forwarded-for": "::1", "x-real-ip": "203.0.113.9" })),
    );
    expect(b).toEqual({ status: "ok" });
  });

  it("uses the FIRST xff entry — a trailing loopback hop does not leak the sha", async () => {
    const b = await body(GET(req({ "x-forwarded-for": "203.0.113.9, 127.0.0.1" })));
    expect(b).toEqual({ status: "ok" });
  });
});
