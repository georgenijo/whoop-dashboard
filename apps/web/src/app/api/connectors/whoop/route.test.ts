// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthMock = vi.fn();
const getIntegrationMock = vi.fn();
const getLastSuccessfulSyncAtMock = vi.fn();
const getLastSuccessfulResourceEventAtMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireAuth: (...args: unknown[]) => requireAuthMock(...args) }));
vi.mock("@/lib/db/integrations", () => ({
  getIntegration: (...args: unknown[]) => getIntegrationMock(...args),
}));
vi.mock("@/lib/db", () => ({
  getLastSuccessfulSyncAt: (...args: unknown[]) => getLastSuccessfulSyncAtMock(...args),
}));
vi.mock("@/lib/db/logs", () => ({
  getLastSuccessfulResourceEventAt: (...args: unknown[]) => getLastSuccessfulResourceEventAtMock(...args),
}));

import { GET } from "./route";

describe("GET /api/connectors/whoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: { id: 42 } });
    getIntegrationMock.mockReturnValue(null);
  });

  it("returns separate tenant-scoped full sync and resource event timestamps", async () => {
    getLastSuccessfulSyncAtMock.mockReturnValue(new Date("2026-09-13T10:00:00.000Z"));
    getLastSuccessfulResourceEventAtMock.mockReturnValue(new Date("2026-09-26T10:00:00.000Z"));

    const response = await GET(new Request("http://localhost/api/connectors/whoop"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      last_sync_at: "2026-09-13T10:00:00.000Z",
      last_event_at: "2026-09-26T10:00:00.000Z",
    });
    expect(getLastSuccessfulSyncAtMock).toHaveBeenCalledWith(42);
    expect(getLastSuccessfulResourceEventAtMock).toHaveBeenCalledWith(42);
  });
});
