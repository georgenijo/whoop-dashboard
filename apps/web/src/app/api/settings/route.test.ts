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
import {
  DEFAULT_SYSTEM_PROMPT,
  MAX_SYSTEM_PROMPT_LENGTH,
} from "@/lib/coach/prompts";

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

  it("validates and persists Cursor parameters from the live catalog", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: "key_personal",
      model_pref: "cursor:gpt-5.5",
      cursor_model_params: {},
    });
    resolveCursorKeyMock.mockReturnValue({
      key: "key_personal",
      origin: "user",
    });
    listCursorModelsForKeyMock.mockResolvedValue([
      {
        id: "gpt-5.5",
        display_name: "GPT-5.5",
        description: null,
        parameters: [
          {
            id: "effort",
            display_name: "Reasoning",
            values: [
              { value: "medium", display_name: "Medium" },
              { value: "high", display_name: "High" },
            ],
          },
        ],
        variants: [],
      },
    ]);

    const response = await POST(
      post({
        cursor_model_params: {
          model_id: "gpt-5.5",
          params: [{ id: "effort", value: "high" }],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      cursor_model_params: {
        "gpt-5.5": [{ id: "effort", value: "high" }],
      },
    });
  });

  it("rejects Cursor parameter values missing from the live catalog", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: "key_personal",
      model_pref: "cursor:gpt-5.5",
      cursor_model_params: {},
    });
    resolveCursorKeyMock.mockReturnValue({
      key: "key_personal",
      origin: "user",
    });
    listCursorModelsForKeyMock.mockResolvedValue([
      {
        id: "gpt-5.5",
        parameters: [
          {
            id: "effort",
            values: [{ value: "medium" }],
          },
        ],
      },
    ]);

    const response = await POST(
      post({
        cursor_model_params: {
          model_id: "gpt-5.5",
          params: [{ id: "effort", value: "ultra" }],
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Cursor model parameter is not available",
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

describe("/api/settings system_prompt (issue #493 — per-user, not app-global)", () => {
  it("writes system_prompt scoped to the authenticated user, not the global setting", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: "custom instructions",
    });

    const response = await POST(post({ system_prompt: "custom instructions" }));

    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      system_prompt: "custom instructions",
    });
    expect(db.setSetting).not.toHaveBeenCalled();
  });

  it("clearing the textarea (empty string) stores null, not an empty override", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: null,
    });

    const response = await POST(post({ system_prompt: "" }));

    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      system_prompt: null,
    });
  });

  it("rejects an overlong system_prompt with 400 and does not persist it", async () => {
    const overlong = "x".repeat(MAX_SYSTEM_PROMPT_LENGTH + 1);

    const response = await POST(post({ system_prompt: overlong }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: `system_prompt must be ${MAX_SYSTEM_PROMPT_LENGTH} characters or fewer`,
    });
    expect(db.upsertUserSettings).not.toHaveBeenCalled();
    expect(db.setSetting).not.toHaveBeenCalled();
  });

  it("accepts a system_prompt exactly at the length cap", async () => {
    const atCap = "x".repeat(MAX_SYSTEM_PROMPT_LENGTH);
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: atCap,
    });

    const response = await POST(post({ system_prompt: atCap }));

    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      system_prompt: atCap,
    });
  });

  it("GET resolves the caller's per-user system_prompt", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: "per-user override",
    });

    const response = await GET(new Request("http://localhost/api/settings"));
    expect(await response.json()).toMatchObject({
      system_prompt: "per-user override",
    });
  });

  // Issue #498 — GET returns the RAW stored value, not one resolved against
  // DEFAULT_SYSTEM_PROMPT. Custom instructions are additive now, so
  // pre-filling the Settings textarea with the built-in prompt would invite
  // the user to save a near-copy of it, which the coach would then receive
  // twice (once cached, once as ~9.4KB of uncached per-user text per turn).
  it("GET returns an empty string when no per-user instructions exist", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: null,
    });

    const response = await GET(new Request("http://localhost/api/settings"));
    const body = await response.json();
    expect(body.system_prompt).toBe("");
    expect(body.system_prompt).not.toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("GET no longer ships the built-in prompt to the client", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: null,
    });

    const response = await GET(new Request("http://localhost/api/settings"));
    expect(await response.json()).not.toHaveProperty("default_system_prompt");
  });

  // Issue #493 follow-up (fable review, MEDIUM) — the legacy app-global
  // app_settings row was a frozen, cross-tenant-shared fallback: any
  // instance where someone had written it before this fix kept leaking that
  // value to every future user indefinitely, and it blocked clearing back
  // to the default. connection.ts (openWrite) now migrates it into
  // user_settings once and deletes it, so the route must never read it.
  it("GET never falls back to the legacy global app_settings key", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: null,
    });

    const response = await GET(new Request("http://localhost/api/settings"));
    expect(await response.json()).toMatchObject({ system_prompt: "" });
    expect(db.getSetting).not.toHaveBeenCalled();
  });

  it("trims whitespace before the empty-string check, so a whitespace-only value clears to null", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: null,
    });

    const response = await POST(post({ system_prompt: "   \n\t  " }));

    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      system_prompt: null,
    });
  });

  it("trims leading/trailing whitespace before persisting a non-empty system_prompt", async () => {
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
      system_prompt: "be terse",
    });

    const response = await POST(post({ system_prompt: "  be terse  \n" }));

    expect(response.status).toBe(200);
    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      system_prompt: "be terse",
    });
  });

  it("a different authenticated user's write does not leak into another user's resolved prompt", async () => {
    // Simulate two independent requests as different users by asserting the
    // write call is scoped with the authenticated user's id (7, per the
    // requireAuth mock) rather than any global key — the per-user isolation
    // itself is covered end-to-end in user_settings.test.ts.
    db.getUserSettings.mockReturnValue({
      cursor_key: null,
      model_pref: "anthropic:claude-sonnet-4-6",
    });

    await POST(post({ system_prompt: "attacker-controlled instructions" }));

    expect(db.upsertUserSettings).toHaveBeenCalledWith({
      user_id: 7,
      system_prompt: "attacker-controlled instructions",
    });
    expect(db.setSetting).not.toHaveBeenCalled();
  });
});
