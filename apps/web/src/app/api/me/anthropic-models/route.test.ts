// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getUserSettings: vi.fn() }));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), resolve: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/coach/api-key", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/coach/api-key")>(),
  resolveApiKeyForUser: mocks.resolve,
}));
vi.mock("@/lib/coach/anthropic-models", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/coach/anthropic-models")>(),
  listAnthropicModelsForKey: mocks.list,
}));
import { GET } from "./route";
import { MissingApiKeyError } from "@/lib/coach/api-key";
import { AnthropicModelCatalogError } from "@/lib/coach/anthropic-models";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.auth.mockResolvedValue({ user: { id: 7 } });
  mocks.resolve.mockReturnValue({ key: "personal", origin: "user" });
});

describe("Anthropic catalog endpoint", () => {
  const req = () => new Request("http://localhost/api/me/anthropic-models");
  it("returns the authenticated account's catalog without keys or caching", async () => {
    mocks.list.mockResolvedValue([{ id: "claude-opus-4-6" }]);
    const res = await GET(req());
    expect(await res.json()).toEqual({ status: "ready", models: [{ id: "claude-opus-4-6" }] });
    expect(mocks.resolve).toHaveBeenCalledWith(7);
    expect(mocks.list).toHaveBeenCalledWith("personal");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(["invalid_key", "unavailable"] as const)("reports %s independently of Cursor", async (reason) => {
    mocks.list.mockRejectedValue(new AnthropicModelCatalogError(reason));
    expect(await (await GET(req())).json()).toEqual({ status: reason, models: [] });
  });
  it("gates an unconfigured provider", async () => {
    mocks.resolve.mockImplementation(() => { throw new MissingApiKeyError(); });
    expect(await (await GET(req())).json()).toEqual({ status: "not_configured", models: [] });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("preserves authentication failures", async () => {
    mocks.auth.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    expect((await GET(req())).status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
