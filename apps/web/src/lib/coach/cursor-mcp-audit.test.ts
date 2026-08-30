// @vitest-environment node
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CursorMcpAuditChannel } from "./cursor-mcp-audit";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

function event(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    runtime_id: "runtime-1",
    turn_epoch: "turn-1",
    call_id: "call-1",
    tool_name: "query_recovery",
    phase: "start",
    at_ms: 10,
    input: {},
    ...overrides,
  };
}

describe("CursorMcpAuditChannel", () => {
  it("delivers matching events once and rejects stale or cross-runtime events", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "coach-mcp-audit-"));
    dirs.push(dir);
    const auditPath = path.join(dir, "audit.ndjson");
    await writeFile(auditPath, "");
    const channel = new CursorMcpAuditChannel(auditPath, "runtime-1");
    const events: unknown[] = [];
    const failures: Error[] = [];
    const listener = channel.listen(
      "turn-1",
      (value) => events.push(value),
      (error) => failures.push(error),
    );

    const matching = JSON.stringify(event());
    await appendFile(
      auditPath,
      [
        matching,
        matching,
        JSON.stringify(event({ call_id: "stale", turn_epoch: "turn-0" })),
        JSON.stringify(event({ call_id: "foreign", runtime_id: "runtime-2" })),
      ].join("\n") + "\n",
    );
    await listener.drainAndStop();

    expect(events).toHaveLength(1);
    expect(failures).toEqual([]);
  });

  it("reports malformed and partial events without throwing into the tool path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "coach-mcp-audit-"));
    dirs.push(dir);
    const auditPath = path.join(dir, "audit.ndjson");
    await writeFile(auditPath, "not-json\npartial");
    const failures: Error[] = [];
    const listener = new CursorMcpAuditChannel(
      auditPath,
      "runtime-1",
    ).listen("turn-1", () => {}, (error) => failures.push(error));

    await listener.drainAndStop();

    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain("invalid event");
  });
});
