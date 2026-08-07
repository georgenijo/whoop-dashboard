// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 7, email: "test@example.com" },
    source: "web",
  })),
}));

const db = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getUserSettings: vi.fn(),
  upsertUserSettings: vi.fn(),
}));
const resolveCursorKeyMock = vi.fn();
const listCursorModelsForKeyMock = vi.fn();

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/coach/cursor-key", () => ({
  resolveCursorKey: (...args: unknown[]) => resolveCursorKeyMock(...args),
}));
vi.mock("@/lib/coach/cursor-models", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/coach/cursor-models")
  >();
  return {
    ...actual,
    listCursorModelsForKey: (...args: unknown[]) =>
      listCursorModelsForKeyMock(...args),
  };
});

import { GET, POST } from "./route";
import { CursorModelCatalogError } from "@/lib/coach/cursor-models";

function post(body: unknown): Request {
  return new Request("http://localhost/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(db).forEach((mock) => mock.mockReset());
  resolveCursorKeyMock.mockReset();
  listCursorModelsForKeyMock.mockReset();
  db.getSetting.mockReturnValue(null);
});

describe("/api/settings model preferences", () => {
  it("returns a stored dynamic Cursor model instead of collapsing to Composer", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: "key_personal",
      model_pref: "cursor:gpt-5.5-high",
    });

    const response = await GET(new Request("http://localhost/api/settings"));
    expect(await response.json()).toMatchObject({
      model_pref: "cursor:gpt-5.5-high",
      cursor_available: true,
    });
  });

  it("persists a model present in the user's live Cursor catalog", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: "key_personal",
      model_pref: "anthropic:claude-sonnet-4-6",
    });
    resolveCursorKeyMock.mockReturnValue({
      key: "key_personal",
      origin: "user",
    });
    listCursorModelsForKeyMock.mockResolvedValue([
      {
        id: "gpt-5.5-high",
        display_name: "GPT-5.5 High",
        description: null,
      },
    ]);

    const response = await POST(post({ model_pref: "cursor:gpt-5.5-high" }));
    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      model_pref: "cursor:gpt-5.5-high",
    });
  });

  it("persists a supported per-user Coach effort level", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      coach_effort: "max",
    });

    const response = await POST(post({ coach_effort: "max" }));

    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      coach_effort: "max",
    });
    expect(await response.json()).toMatchObject({
      coach_effort: "max",
    });
  });

  it("persists the option to turn Anthropic thinking off", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      coach_effort: "off",
    });

    const response = await POST(post({ coach_effort: "off" }));

    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      coach_effort: "off",
    });
    expect(await response.json()).toMatchObject({
      coach_effort: "off",
    });
  });

  it("rejects unsupported Coach effort levels", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
    });

    const response = await POST(post({ coach_effort: "xhigh" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid coach_effort",
    });
    expect(db.upsertUserSettings).not.toHaveBeenCalled();
  });

  it("rejects a Cursor model missing from the user's catalog", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: "key_personal",
      model_pref: "anthropic:claude-sonnet-4-6",
    });
    resolveCursorKeyMock.mockReturnValue({
      key: "key_personal",
      origin: "user",
    });
    listCursorModelsForKeyMock.mockResolvedValue([]);

    const response = await POST(post({ model_pref: "cursor:not-real" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Cursor model is not available for this account",
    });
    expect(db.upsertUserSettings).not.toHaveBeenCalled();
  });

  it("uses 422 when Cursor rejects the configured key", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: "key_personal",
      model_pref: "anthropic:claude-sonnet-4-6",
    });
    resolveCursorKeyMock.mockReturnValue({
      key: "key_personal",
      origin: "user",
    });
    listCursorModelsForKeyMock.mockRejectedValue(
      new CursorModelCatalogError("invalid_key", "rejected"),
    );

    const response = await POST(post({ model_pref: "cursor:composer-2.5" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Cursor rejected the configured API key",
    });
    expect(db.upsertUserSettings).not.toHaveBeenCalled();
  });

  it("uses 502 when Cursor model discovery is unavailable", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: "key_personal",
      model_pref: "anthropic:claude-sonnet-4-6",
    });
    resolveCursorKeyMock.mockReturnValue({
      key: "key_personal",
      origin: "user",
    });
    listCursorModelsForKeyMock.mockRejectedValue(
      new CursorModelCatalogError("unavailable", "offline"),
    );

    const response = await POST(post({ model_pref: "cursor:composer-2.5" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Cursor model catalog is unavailable",
    });
    expect(db.upsertUserSettings).not.toHaveBeenCalled();
  });
});
