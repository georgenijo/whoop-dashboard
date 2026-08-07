// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}));

const getUserSettingsMock = vi.fn();
const upsertUserSettingsMock = vi.fn();
const probeCursorKeyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
  upsertUserSettings: (...args: unknown[]) => upsertUserSettingsMock(...args),
}));

vi.mock("@/lib/coach/cursor-key", () => ({
  probeCursorKey: (...args: unknown[]) => probeCursorKeyMock(...args),
}));

import { DELETE, GET, POST } from "./route";

const originalCursorApiKey = process.env.CURSOR_API_KEY;

function makeRequest(method: "GET" | "POST" | "DELETE", body?: unknown): Request {
  return new Request("http://localhost/api/me/cursor-key", {
    method,
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  requireAuthMock.mockResolvedValue({
    user: {
      id: 1,
      email: "test@example.com",
      name: null,
      apple_sub: "test-sub",
      timezone: null,
    },
    source: "ios",
  });
  getUserSettingsMock.mockReset();
  upsertUserSettingsMock.mockReset();
  probeCursorKeyMock.mockReset();
  delete process.env.CURSOR_API_KEY;
});

afterEach(() => {
  if (originalCursorApiKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = originalCursorApiKey;
});

describe("POST /api/me/cursor-key", () => {
  it("rejects malformed key shapes without probing or persisting", async () => {
    const response = await POST(makeRequest("POST", { key: "not-cursor" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      code: "invalid_request",
    });
    expect(probeCursorKeyMock).not.toHaveBeenCalled();
    expect(upsertUserSettingsMock).not.toHaveBeenCalled();
  });

  it("persists only after a successful credential probe", async () => {
    probeCursorKeyMock.mockResolvedValue("ok");
    const key = "key_test-key-AAAAAAAAAAAAAAAAAAAA";
    const response = await POST(makeRequest("POST", { key }));
    expect(await response.json()).toEqual({
      ok: true,
      present: true,
      masked: "••••…AAAA",
      fallback_available: false,
    });
    expect(probeCursorKeyMock).toHaveBeenCalledWith(key);
    expect(upsertUserSettingsMock).toHaveBeenCalledWith({
      user_id: 1,
      cursor_key: key,
      cursor_model_params: {},
    });
  });

  it.each(["invalid_key", "probe_failed"] as const)(
    "does not persist when the probe returns %s",
    async (code) => {
      probeCursorKeyMock.mockResolvedValue(code);
      const response = await POST(
        makeRequest("POST", {
          key: "key_test-key-BBBBBBBBBBBBBBBBBBBB",
        }),
      );
      expect(await response.json()).toEqual({ ok: false, code });
      expect(upsertUserSettingsMock).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/me/cursor-key", () => {
  it("preserves an authentication Response instead of turning it into a 500", async () => {
    requireAuthMock.mockRejectedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    const response = await GET(makeRequest("GET"));
    expect(response.status).toBe(401);
  });

  it("returns only the masked key", async () => {
    getUserSettingsMock.mockReturnValue({
      cursor_key: "key_CLEARTEXT-SHOULD-NEVER-LEAK-Z9yX",
    });
    const response = await GET(makeRequest("GET"));
    const body = await response.json();
    expect(body).toEqual({
      present: true,
      masked: "••••…Z9yX",
      fallback_available: false,
    });
    expect(JSON.stringify(body)).not.toContain("CLEARTEXT");
  });

  it("returns absent when no personal key exists", async () => {
    getUserSettingsMock.mockReturnValue(null);
    const response = await GET(makeRequest("GET"));
    expect(await response.json()).toEqual({
      present: false,
      masked: null,
      fallback_available: false,
    });
  });
});

describe("DELETE /api/me/cursor-key", () => {
  it("clears the personal key", async () => {
    const response = await DELETE(makeRequest("DELETE"));
    expect(await response.json()).toEqual({
      present: false,
      masked: null,
      fallback_available: false,
      model_pref: "anthropic:claude-sonnet-4-6",
    });
    expect(upsertUserSettingsMock).toHaveBeenCalledWith({
      user_id: 1,
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      cursor_model_params: {},
    });
  });

  it("resets the model even when a shared Cursor fallback remains", async () => {
    process.env.CURSOR_API_KEY = "key_shared";
    const response = await DELETE(makeRequest("DELETE"));
    expect(await response.json()).toMatchObject({
      fallback_available: true,
      model_pref: "anthropic:claude-sonnet-4-6",
    });
    expect(upsertUserSettingsMock).toHaveBeenCalledWith({
      user_id: 1,
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      cursor_model_params: {},
    });
  });
});
