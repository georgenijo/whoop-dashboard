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
  getChatLogs: vi.fn(() => [{ id: 1 }]),
  clearChatLogs: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { clearChatLogs, getChatLogs } from "@/lib/db";

type RouteModule = typeof import("./route");
let route: RouteModule;

beforeEach(async () => {
  delete process.env.ADMIN_APPLE_SUB;
  vi.mocked(requireAuth).mockReset();
  vi.mocked(requireAuth).mockImplementation(async () => ({
    user: mockUser,
    source: "ios" as const,
  }));
  vi.mocked(getChatLogs).mockClear();
  vi.mocked(clearChatLogs).mockClear();
  route = await import("./route");
});

afterEach(() => {
  delete process.env.ADMIN_APPLE_SUB;
});

function makeRequest(method: "GET" | "DELETE" = "GET"): Request {
  return new Request("http://localhost/api/logs", { method });
}

describe("GET /api/logs — admin gate", () => {
  it("returns 401 and never reads logs when requireAuth rejects unauthenticated requests", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    const res = await route.GET(makeRequest());
    expect(res.status).toBe(401);
    expect(getChatLogs).not.toHaveBeenCalled();
  });

  it("returns 500 and never reads logs when ADMIN_APPLE_SUB env is not set", async () => {
    const res = await route.GET(makeRequest());
    expect(res.status).toBe(500);
    expect(getChatLogs).not.toHaveBeenCalled();
  });

  it("returns 403 and never reads logs when authenticated user's apple_sub does not match ADMIN_APPLE_SUB", async () => {
    process.env.ADMIN_APPLE_SUB = "different-sub";
    const res = await route.GET(makeRequest());
    expect(res.status).toBe(403);
    expect(getChatLogs).not.toHaveBeenCalled();
  });

  it("returns 200 with logs when apple_sub matches ADMIN_APPLE_SUB", async () => {
    process.env.ADMIN_APPLE_SUB = mockUser.apple_sub;
    const res = await route.GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([{ id: 1 }]);
  });
});

describe("DELETE /api/logs — admin gate", () => {
  it("returns 401 and never clears logs when requireAuth rejects unauthenticated requests", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    const res = await route.DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(401);
    expect(clearChatLogs).not.toHaveBeenCalled();
  });

  it("returns 500 and never clears logs when ADMIN_APPLE_SUB env is not set", async () => {
    const res = await route.DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(500);
    expect(clearChatLogs).not.toHaveBeenCalled();
  });

  it("returns 403 and never clears logs when authenticated user's apple_sub does not match ADMIN_APPLE_SUB", async () => {
    process.env.ADMIN_APPLE_SUB = "different-sub";
    const res = await route.DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(403);
    expect(clearChatLogs).not.toHaveBeenCalled();
  });

  it("returns 204 when apple_sub matches ADMIN_APPLE_SUB", async () => {
    process.env.ADMIN_APPLE_SUB = mockUser.apple_sub;
    const res = await route.DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(204);
    expect(clearChatLogs).toHaveBeenCalledOnce();
  });
});
