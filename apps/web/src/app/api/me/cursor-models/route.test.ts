// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}));

const resolveCursorKeyMock = vi.fn();
const listCursorModelsForKeyMock = vi.fn();

vi.mock("@/lib/coach/cursor-key", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/coach/cursor-key")
  >();
  return {
    ...actual,
    resolveCursorKey: (...args: unknown[]) => resolveCursorKeyMock(...args),
  };
});

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

import { GET } from "./route";
import { MissingCursorKeyError } from "@/lib/coach/cursor-key";
import { CursorModelCatalogError } from "@/lib/coach/cursor-models";

beforeEach(() => {
  requireAuthMock.mockReset();
  requireAuthMock.mockResolvedValue({
    user: { id: 7, email: "test@example.com" },
    source: "web",
  });
  resolveCursorKeyMock.mockReset();
  listCursorModelsForKeyMock.mockReset();
});

describe("GET /api/me/cursor-models", () => {
  it("preserves an authentication Response instead of turning it into a 500", async () => {
    requireAuthMock.mockRejectedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const response = await GET(
      new Request("http://localhost/api/me/cursor-models"),
    );
    expect(response.status).toBe(401);
  });

  it("returns the models available to the resolved user key", async () => {
    resolveCursorKeyMock.mockReturnValue({
      key: "key_personal",
      origin: "user",
    });
    listCursorModelsForKeyMock.mockResolvedValue([
      {
        id: "composer-2.5",
        display_name: "Composer 2.5",
        description: null,
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/me/cursor-models"),
    );
    expect(await response.json()).toEqual({
      status: "ready",
      models: [
        {
          id: "composer-2.5",
          display_name: "Composer 2.5",
          description: null,
        },
      ],
    });
    expect(resolveCursorKeyMock).toHaveBeenCalledWith(7);
    expect(listCursorModelsForKeyMock).toHaveBeenCalledWith("key_personal");
  });

  it("returns a non-error empty state when Cursor is not configured", async () => {
    resolveCursorKeyMock.mockImplementation(() => {
      throw new MissingCursorKeyError();
    });

    const response = await GET(
      new Request("http://localhost/api/me/cursor-models"),
    );
    expect(await response.json()).toEqual({
      status: "not_configured",
      models: [],
    });
  });

  it("surfaces an invalid-key catalog state without leaking credentials", async () => {
    resolveCursorKeyMock.mockReturnValue({
      key: "key_rejected",
      origin: "user",
    });
    listCursorModelsForKeyMock.mockRejectedValue(
      new CursorModelCatalogError("invalid_key", "rejected"),
    );

    const response = await GET(
      new Request("http://localhost/api/me/cursor-models"),
    );
    const body = await response.json();
    expect(body).toEqual({ status: "invalid_key", models: [] });
    expect(JSON.stringify(body)).not.toContain("key_rejected");
  });
});
