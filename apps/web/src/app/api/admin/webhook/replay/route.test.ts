// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockUser = {
  id: 2,
  email: "admin@example.com",
  name: null,
  apple_sub: "admin-apple-sub-123",
  timezone: null,
};

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ user: mockUser, source: "ios" as const })),
}));

vi.mock("@/lib/db", () => ({
  bumpWebhookAttempt: vi.fn(),
  getWebhookEvent: vi.fn(),
  listFailedWebhookEvents: vi.fn(() => []),
  markWebhookDiscarded: vi.fn(),
  markWebhookFailed: vi.fn(),
  markWebhookSucceeded: vi.fn(),
}));

vi.mock("@/lib/whoop/client", () => ({
  WhoopNotFoundError: class extends Error {},
}));

vi.mock("@/lib/whoop/webhook-handler", () => ({
  handleEvent: vi.fn(),
}));

type RouteModule = typeof import("./route");
let route: RouteModule;

beforeEach(async () => {
  route = await import("./route");
});

afterEach(() => {
  delete process.env.ADMIN_APPLE_SUB;
});

function makeRequest(query = "?status=failed"): Request {
  return new Request(`http://localhost/api/admin/webhook/replay${query}`, {
    method: "POST",
  });
}

describe("POST /api/admin/webhook/replay — admin gate", () => {
  it("returns 500 when ADMIN_APPLE_SUB env is not set", async () => {
    const res = await route.POST(makeRequest());
    expect(res.status).toBe(500);
  });

  it("returns 403 when authenticated user's apple_sub does not match ADMIN_APPLE_SUB", async () => {
    process.env.ADMIN_APPLE_SUB = "different-sub";
    const res = await route.POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it("returns 200 (success path) when apple_sub matches ADMIN_APPLE_SUB", async () => {
    process.env.ADMIN_APPLE_SUB = mockUser.apple_sub;
    const res = await route.POST(makeRequest("?status=failed&limit=5"));
    // No failed events in mock; reach success path with replayed=0.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { replayed: number };
    expect(body.replayed).toBe(0);
  });
});
