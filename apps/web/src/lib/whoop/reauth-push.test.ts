// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The real APNs sender must never run in this suite — every test injects
// `send`, and this mock makes an accidental default-path call loud.
const { realSendMock } = vi.hoisted(() => ({
  realSendMock: vi.fn(() => {
    throw new Error("real APNs sender must not be called in tests");
  }),
}));
vi.mock("@/lib/push", async () => {
  const actual = await vi.importActual<typeof import("@/lib/push/apns")>(
    "@/lib/push/apns"
  );
  return {
    sendAlertToToken: realSendMock,
    shouldRemoveTokenForReason: actual.shouldRemoveTokenForReason,
  };
});
vi.mock("@/lib/db/devices", () => ({
  listDeviceTokensForUser: vi.fn(() => []),
  deleteDeviceToken: vi.fn(() => 0),
}));

import {
  REAUTH_PUSH_DEBOUNCE_MS,
  buildReauthPushPayload,
  notifyWhoopNeedsReauth,
  reauthPushMode,
  resetReauthPushDebounce,
  type ReauthPushDeps,
} from "./reauth-push";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

function device(token: string) {
  return {
    user_id: 1,
    token,
    platform: "ios" as const,
    env: "production" as const,
    app_version: "1.0(1)",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

function makeDeps(mode: string | undefined, tokens = [TOKEN_A, TOKEN_B]) {
  let clock = 1_000_000;
  const logs: string[] = [];
  const deps = {
    listTokens: vi.fn(() => tokens.map(device)),
    send: vi.fn(async () => ({ ok: true as const, apnsId: "id" })),
    deleteToken: vi.fn(() => 1),
    now: () => clock,
    log: (m: string) => logs.push(m),
    env: { WHOOP_REAUTH_PUSH: mode },
  } satisfies ReauthPushDeps;
  return {
    deps,
    logs,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

beforeEach(() => {
  resetReauthPushDebounce();
  realSendMock.mockClear();
});

describe("reauthPushMode", () => {
  it("is default-off and only accepts the two explicit values", () => {
    expect(reauthPushMode({})).toBe("off");
    expect(reauthPushMode({ WHOOP_REAUTH_PUSH: "" })).toBe("off");
    expect(reauthPushMode({ WHOOP_REAUTH_PUSH: "1" })).toBe("off");
    expect(reauthPushMode({ WHOOP_REAUTH_PUSH: "true" })).toBe("off");
    expect(reauthPushMode({ WHOOP_REAUTH_PUSH: "log" })).toBe("log");
    expect(reauthPushMode({ WHOOP_REAUTH_PUSH: " ON " })).toBe("on");
  });
});

describe("buildReauthPushPayload", () => {
  it("carries the alert copy and the Settings deep-link route", () => {
    expect(buildReauthPushPayload()).toEqual({
      title: "Coach",
      body: "Whoop disconnected — tap to reconnect.",
      sound: "default",
      custom: { route: "settings/connectors", reason: "whoop_needs_reauth" },
    });
  });
});

describe("notifyWhoopNeedsReauth", () => {
  it("flag off is a complete no-op", async () => {
    const { deps, logs } = makeDeps(undefined);
    expect(await notifyWhoopNeedsReauth(1, deps)).toEqual({ status: "disabled" });
    expect(deps.listTokens).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it("log mode records the payload but never calls APNs or prints tokens", async () => {
    const { deps, logs } = makeDeps("log");
    expect(await notifyWhoopNeedsReauth(1, deps)).toEqual({
      status: "logged",
      devices: 2,
    });
    expect(deps.send).not.toHaveBeenCalled();
    expect(realSendMock).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("would-send");
    expect(logs[0]).toContain("Whoop disconnected");
    expect(logs[0]).toContain("settings/connectors");
    expect(logs.join("\n")).not.toContain(TOKEN_A);
    expect(logs.join("\n")).not.toContain(TOKEN_B);
  });

  it("on mode sends the payload once to each registered device", async () => {
    const { deps, logs } = makeDeps("on");
    const out = await notifyWhoopNeedsReauth(1, deps);
    expect(out).toEqual({ status: "sent", devices: 2, delivered: 2, removed: 0 });
    expect(deps.send).toHaveBeenCalledTimes(2);
    expect(deps.send).toHaveBeenCalledWith(TOKEN_A, buildReauthPushPayload());
    expect(deps.send).toHaveBeenCalledWith(TOKEN_B, buildReauthPushPayload());
    expect(logs.join("\n")).not.toContain(TOKEN_A);
    expect(realSendMock).not.toHaveBeenCalled();
  });

  it("debounces a second transition inside the window, then allows one after", async () => {
    const { deps, advance } = makeDeps("on");
    await notifyWhoopNeedsReauth(1, deps);
    advance(60_000);
    expect(await notifyWhoopNeedsReauth(1, deps)).toEqual({ status: "debounced" });
    expect(deps.send).toHaveBeenCalledTimes(2); // still just the first fan-out
    advance(REAUTH_PUSH_DEBOUNCE_MS);
    expect((await notifyWhoopNeedsReauth(1, deps)).status).toBe("sent");
    expect(deps.send).toHaveBeenCalledTimes(4);
  });

  it("two concurrent transitions for one user push once", async () => {
    const { deps } = makeDeps("on");
    const [a, b] = await Promise.all([
      notifyWhoopNeedsReauth(1, deps),
      notifyWhoopNeedsReauth(1, deps),
    ]);
    expect([a.status, b.status].sort()).toEqual(["debounced", "sent"]);
    expect(deps.send).toHaveBeenCalledTimes(2);
  });

  it("debounce is per user", async () => {
    const { deps } = makeDeps("on");
    await notifyWhoopNeedsReauth(1, deps);
    expect((await notifyWhoopNeedsReauth(2, deps)).status).toBe("sent");
  });

  it("deletes a token APNs reports Unregistered and survives a throwing send", async () => {
    const { deps } = makeDeps("on");
    deps.send
      .mockResolvedValueOnce({
        ok: false,
        status: 410,
        reason: "Unregistered",
        apnsId: null,
      } as never)
      .mockRejectedValueOnce(new Error("boom"));
    const out = await notifyWhoopNeedsReauth(1, deps);
    expect(out).toEqual({ status: "sent", devices: 2, delivered: 0, removed: 1 });
    expect(deps.deleteToken).toHaveBeenCalledTimes(1);
    expect(deps.deleteToken).toHaveBeenCalledWith(1, TOKEN_A);
  });

  it("no registered devices is reported, not an error", async () => {
    const { deps } = makeDeps("on", []);
    expect(await notifyWhoopNeedsReauth(1, deps)).toEqual({ status: "no_devices" });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("never throws when the device lookup blows up", async () => {
    const { deps } = makeDeps("on");
    deps.listTokens.mockImplementation(() => {
      throw new Error("db gone");
    });
    expect(await notifyWhoopNeedsReauth(1, deps)).toEqual({ status: "error" });
  });
});
