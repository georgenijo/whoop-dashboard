// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: {
      id: 1,
      email: "test@example.com",
      name: null,
      apple_sub: "test-sub",
      timezone: null,
    },
    source: "ios" as const,
  })),
}));

const getUserSettingsMock = vi.fn();
const upsertUserSettingsMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
  upsertUserSettings: (...args: unknown[]) => upsertUserSettingsMock(...args),
}));

// Stub the Anthropic SDK at module-construction time. The route imports
// `Anthropic` (default) + `APIError` (named) and constructs a new client
// inside POST. We replace the constructor with a class whose
// `models.list` is the mock — APIError is preserved (re-exported from the
// real SDK) so the route's `err instanceof APIError` check still works
// when the test triggers a 401-shaped throw.
import Anthropic, { APIError } from "@anthropic-ai/sdk";

const modelsListMock = vi.fn();

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>(
    "@anthropic-ai/sdk",
  );
  return {
    ...actual,
    default: class FakeClient {
      models = { list: modelsListMock };
      constructor() {
        // No-op — we don't need the real client. Accepts (and ignores) the
        // real client's constructor args at call sites; the API key isn't
        // needed here since `models.list` is mocked directly.
      }
    },
  };
});

import { DELETE, GET, POST } from "./route";

function makeRequest(method: "GET" | "POST" | "DELETE", body?: unknown): Request {
  return new Request("http://localhost/api/me/anthropic-key", {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  getUserSettingsMock.mockReset();
  upsertUserSettingsMock.mockReset();
  modelsListMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/me/anthropic-key — body validation", () => {
  it("returns 400 invalid_request for malformed JSON body", async () => {
    const req = new Request("http://localhost/api/me/anthropic-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: "invalid_request" });
    expect(upsertUserSettingsMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when key doesn't start with sk-ant-", async () => {
    const res = await POST(makeRequest("POST", { key: "not-an-anthropic-key-xyzxyzxyz" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: "invalid_request" });
    expect(upsertUserSettingsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/me/anthropic-key — probe outcomes", () => {
  it("on probe success, persists the key and returns masked", async () => {
    modelsListMock.mockResolvedValue({ data: [] });
    const res = await POST(
      makeRequest("POST", { key: "sk-ant-test-key-AAAAAAAAAAAA-W4nT" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      present: true,
      masked: "sk-ant-…W4nT",
    });
    expect(upsertUserSettingsMock).toHaveBeenCalledTimes(1);
    expect(upsertUserSettingsMock).toHaveBeenCalledWith({
      user_id: 1,
      anthropic_key: "sk-ant-test-key-AAAAAAAAAAAA-W4nT",
    });
  });

  it("on probe 401, does NOT persist and returns ok:false invalid_key", async () => {
    // Mint a real APIError so the route's `instanceof APIError && status === 401` matches.
    const fake401 = new APIError(
      401,
      { error: { message: "invalid_api_key" } },
      "Invalid API key",
      new Headers(),
    );
    modelsListMock.mockRejectedValue(fake401);
    const res = await POST(
      makeRequest("POST", { key: "sk-ant-bad-key-AAAAAAAAAAAAAAA" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, code: "invalid_key" });
    expect(upsertUserSettingsMock).not.toHaveBeenCalled();
  });

  it("on generic probe failure, does NOT persist and returns ok:false probe_failed", async () => {
    modelsListMock.mockRejectedValue(new Error("ECONNRESET"));
    const res = await POST(
      makeRequest("POST", { key: "sk-ant-net-fail-AAAAAAAAAAAAAAA" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, code: "probe_failed" });
    expect(upsertUserSettingsMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/me/anthropic-key", () => {
  it("returns masked-only when a key is set; never the cleartext", async () => {
    getUserSettingsMock.mockReturnValue({
      anthropic_key: "sk-ant-CLEARTEXT-SHOULD-NEVER-LEAK-AAAA",
    });
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { present: boolean; masked: string | null };
    expect(body.present).toBe(true);
    expect(body.masked).toBe("sk-ant-…AAAA");
    const serialized = JSON.stringify(body);
    expect(serialized.includes("CLEARTEXT")).toBe(false);
    expect(serialized.includes("SHOULD-NEVER-LEAK")).toBe(false);
  });

  it("returns { present:false, masked:null } when no key is set", async () => {
    getUserSettingsMock.mockReturnValue(null);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ present: false, masked: null });
  });
});

describe("DELETE /api/me/anthropic-key", () => {
  it("clears the column and returns { ok:true, present:false, masked:null }", async () => {
    const res = await DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, present: false, masked: null });
    expect(upsertUserSettingsMock).toHaveBeenCalledWith({
      user_id: 1,
      anthropic_key: null,
    });
  });
});

// Touch the imported `Anthropic` to keep the unused-import linter happy and
// document that the route really does construct the client (smoke-checked
// by the probe tests above).
void Anthropic;
