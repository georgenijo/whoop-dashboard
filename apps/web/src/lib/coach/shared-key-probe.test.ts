// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CredentialHealthRow } from "@/lib/db/credential-health";

const { store, saveMock, logCalls, logMock, listViaHttpMock, listForKeyMock } =
  vi.hoisted(() => {
    const store = new Map<string, CredentialHealthRow>();
    const saveMock = vi.fn((row: CredentialHealthRow) => {
      store.set(row.credential, { ...row });
    });
    const logCalls: { level: string; args: unknown[] }[] = [];
    const logMock = Object.fromEntries(
      ["debug", "info", "warn", "error", "fatal"].map((level) => [
        level,
        (...args: unknown[]) => logCalls.push({ level, args }),
      ]),
    );
    const listViaHttpMock = vi.fn<(key: string) => Promise<unknown[]>>();
    const listForKeyMock = vi.fn();
    return { store, saveMock, logCalls, logMock, listViaHttpMock, listForKeyMock };
  });
vi.mock("@/lib/db/credential-health", () => ({
  getCredentialHealth: (c: string) => store.get(c) ?? null,
  saveCredentialHealth: (row: CredentialHealthRow) => saveMock(row),
}));

vi.mock("@/lib/logger", () => ({ forModule: () => logMock }));

vi.mock("./cursor-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cursor-models")>();
  return {
    ...actual,
    listCursorModelsViaHttp: (key: string) => listViaHttpMock(key),
    // The probe must never go through the transport-dispatching catalog
    // (ACP would spawn cursor-agent).
    listCursorModelsForKey: (...a: unknown[]) => listForKeyMock(...a),
  };
});

import { CursorModelCatalogError } from "./cursor-models";
import {
  INVALID_INCIDENT_THRESHOLD,
  SHARED_CURSOR_CREDENTIAL,
  classifyProbeOutcome,
  isSharedKeyProbeEnabled,
  nextCredentialHealth,
  registerSharedCredentialIncidentHandler,
  runSharedKeyProbe,
  type SharedCredentialIncident,
} from "./shared-key-probe";

// Obviously fake — never a production credential.
const FAKE_KEY = "crsr_FAKE_TEST_KEY_do_not_use_0123456789abcdef";
const ENV_ON = { COACH_KEY_PROBE: "on", CURSOR_API_KEY: FAKE_KEY };

let clock = Date.parse("2026-11-27T12:00:00Z");
const now = () => new Date(clock);
const tick = () => {
  clock += 30 * 60_000;
};

const invalid = () =>
  new CursorModelCatalogError("invalid_key", "Cursor rejected the API key");
const unavailable = () =>
  new CursorModelCatalogError("unavailable", "Cursor model discovery is unavailable");

let incidents: SharedCredentialIncident[];
let unregister: () => void;

beforeEach(() => {
  store.clear();
  saveMock.mockClear();
  logCalls.length = 0;
  listViaHttpMock.mockReset();
  listForKeyMock.mockReset();
  incidents = [];
  unregister = registerSharedCredentialIncidentHandler((i) => {
    incidents.push(i);
  });
});

afterEach(() => unregister());

describe("isSharedKeyProbeEnabled", () => {
  it("is on only for COACH_KEY_PROBE=on", () => {
    expect(isSharedKeyProbeEnabled({})).toBe(false);
    expect(isSharedKeyProbeEnabled({ COACH_KEY_PROBE: "off" })).toBe(false);
    expect(isSharedKeyProbeEnabled({ COACH_KEY_PROBE: "1" })).toBe(false);
    expect(isSharedKeyProbeEnabled({ COACH_KEY_PROBE: " ON " })).toBe(true);
  });
});

describe("classifyProbeOutcome", () => {
  it("classifies ok / invalid / unreachable", () => {
    expect(classifyProbeOutcome(null)).toBe("ok");
    expect(classifyProbeOutcome(invalid())).toBe("invalid");
    expect(classifyProbeOutcome(unavailable())).toBe("unreachable");
    expect(classifyProbeOutcome(new TypeError("fetch failed"))).toBe("unreachable");
  });
});

describe("runSharedKeyProbe — flag off", () => {
  it("is a no-op: no network, no DB write, no logs", async () => {
    const res = await runSharedKeyProbe({
      env: { CURSOR_API_KEY: FAKE_KEY },
      now,
    });
    expect(res).toEqual({ ran: false, reason: "disabled" });
    expect(listViaHttpMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
    expect(logCalls).toEqual([]);
  });

  it("skips when enabled but no shared key is configured", async () => {
    const res = await runSharedKeyProbe({
      env: { COACH_KEY_PROBE: "on" },
      now,
    });
    expect(res).toEqual({ ran: false, reason: "no_shared_key" });
    expect(listViaHttpMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe("runSharedKeyProbe — classification + persistence", () => {
  it("records ok with last_ok, using the plain HTTP catalog", async () => {
    listViaHttpMock.mockResolvedValue([]);
    const res = await runSharedKeyProbe({ env: ENV_ON, now });
    expect(listViaHttpMock).toHaveBeenCalledWith(FAKE_KEY);
    expect(listForKeyMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ran: true, status: "ok", incident: null });
    const row = store.get(SHARED_CURSOR_CREDENTIAL)!;
    expect(row.status).toBe("ok");
    expect(row.last_ok).toBe(row.last_checked);
    expect(row.consecutive_invalid).toBe(0);
  });

  it("records invalid and keeps the previous last_ok", async () => {
    listViaHttpMock.mockResolvedValueOnce([]);
    await runSharedKeyProbe({ env: ENV_ON, now });
    const okAt = store.get(SHARED_CURSOR_CREDENTIAL)!.last_ok;
    tick();
    listViaHttpMock.mockRejectedValueOnce(invalid());
    const res = await runSharedKeyProbe({ env: ENV_ON, now });
    expect(res).toMatchObject({ status: "invalid", consecutive_invalid: 1 });
    const row = store.get(SHARED_CURSOR_CREDENTIAL)!;
    expect(row.status).toBe("invalid");
    expect(row.last_ok).toBe(okAt);
    expect(row.last_checked).not.toBe(okAt);
  });

  it("records unreachable on network failure without touching the invalid streak", async () => {
    listViaHttpMock.mockRejectedValueOnce(invalid());
    await runSharedKeyProbe({ env: ENV_ON, now });
    tick();
    listViaHttpMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await runSharedKeyProbe({ env: ENV_ON, now });
    expect(res).toMatchObject({ status: "unreachable", consecutive_invalid: 1 });
    expect(incidents).toEqual([]);
  });

  it("never throws when persistence fails", async () => {
    listViaHttpMock.mockResolvedValue([]);
    saveMock.mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY");
    });
    await expect(runSharedKeyProbe({ env: ENV_ON, now })).resolves.toMatchObject({
      ran: true,
      status: "ok",
    });
  });
});

describe("runSharedKeyProbe — incident debounce", () => {
  it("opens one incident after the threshold, not on every repeat, and resolves once", async () => {
    listViaHttpMock.mockRejectedValue(invalid());
    for (let i = 0; i < 6; i++) {
      await runSharedKeyProbe({ env: ENV_ON, now });
      tick();
    }
    expect(incidents.map((i) => i.phase)).toEqual(["opened"]);
    expect(incidents[0].consecutive_invalid).toBe(INVALID_INCIDENT_THRESHOLD);

    // Repeats at most error-log twice (first rejection + incident open).
    const errors = logCalls.filter((c) => c.level === "error");
    expect(errors).toHaveLength(2);

    listViaHttpMock.mockResolvedValue([]);
    await runSharedKeyProbe({ env: ENV_ON, now });
    tick();
    await runSharedKeyProbe({ env: ENV_ON, now });
    expect(incidents.map((i) => i.phase)).toEqual(["opened", "resolved"]);
    expect(store.get(SHARED_CURSOR_CREDENTIAL)!.incident_open).toBe(false);
  });

  it("a single blip below the threshold opens nothing", async () => {
    listViaHttpMock.mockRejectedValueOnce(invalid()).mockResolvedValue([]);
    await runSharedKeyProbe({ env: ENV_ON, now });
    tick();
    await runSharedKeyProbe({ env: ENV_ON, now });
    expect(incidents).toEqual([]);
  });

  it("interleaved unreachable results do not reset or re-fire the incident", async () => {
    const seq = [invalid(), unavailable(), invalid(), unavailable(), invalid()];
    for (const err of seq) {
      listViaHttpMock.mockRejectedValueOnce(err);
      await runSharedKeyProbe({ env: ENV_ON, now });
      tick();
    }
    expect(incidents.map((i) => i.phase)).toEqual(["opened"]);
  });

  it("a throwing handler does not break the probe or other handlers", async () => {
    const seen: string[] = [];
    const off1 = registerSharedCredentialIncidentHandler(() => {
      throw new Error("boom");
    });
    const off2 = registerSharedCredentialIncidentHandler((i) => {
      seen.push(i.phase);
    });
    listViaHttpMock.mockRejectedValue(invalid());
    await runSharedKeyProbe({ env: ENV_ON, now });
    await expect(runSharedKeyProbe({ env: ENV_ON, now })).resolves.toMatchObject({
      incident: "opened",
    });
    expect(seen).toEqual(["opened"]);
    off1();
    off2();
  });
});

describe("no key leakage", () => {
  it("the key never appears in logs, persisted rows, results or incidents", async () => {
    const sequence: (Error | null)[] = [
      null,
      invalid(),
      invalid(),
      invalid(),
      new TypeError(`fetch failed for ${FAKE_KEY}`),
      null,
    ];
    const results: unknown[] = [];
    for (const err of sequence) {
      if (err) listViaHttpMock.mockRejectedValueOnce(err);
      else listViaHttpMock.mockResolvedValueOnce([]);
      results.push(await runSharedKeyProbe({ env: ENV_ON, now }));
      tick();
    }
    const blob = JSON.stringify({
      logs: logCalls,
      rows: saveMock.mock.calls,
      results,
      incidents,
    });
    expect(blob).not.toContain(FAKE_KEY);
    expect(blob).not.toContain(FAKE_KEY.slice(0, 12));
    expect(blob).not.toContain(FAKE_KEY.slice(-8));
  });
});

describe("nextCredentialHealth", () => {
  it("is pure and starts from an empty history", () => {
    const { row, incident } = nextCredentialHealth(null, "invalid", "2026-11-27T00:00:00.000Z");
    expect(row).toMatchObject({ consecutive_invalid: 1, incident_open: false, last_ok: null });
    expect(incident).toBeNull();
  });
});
