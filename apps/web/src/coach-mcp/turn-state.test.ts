// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoachMcpTurnState } from "./turn-state";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("CoachMcpTurnState", () => {
  it("retains guards within a turn and resets them on a parent epoch change", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "coach-turn-state-"));
    dirs.push(dir);
    const epochPath = path.join(dir, "epoch");
    await writeFile(epochPath, "turn-1");
    const manager = new CoachMcpTurnState(epochPath);

    const first = await manager.current();
    first.syncAttempts = 1;
    first.savedPlanHashes.set("plan", 7);
    expect(await manager.current()).toBe(first);

    await writeFile(epochPath, "turn-2");
    const second = await manager.current();
    expect(second).not.toBe(first);
    expect(second.syncAttempts).toBe(0);
    expect(second.savedPlanHashes.size).toBe(0);
  });

  it("fails closed when a configured epoch is empty", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "coach-turn-state-"));
    dirs.push(dir);
    const epochPath = path.join(dir, "epoch");
    await writeFile(epochPath, "");
    await expect(new CoachMcpTurnState(epochPath).current()).rejects.toThrow(
      "epoch is missing or invalid",
    );
  });

  it("single-flights concurrent refreshes at a new turn boundary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "coach-turn-state-"));
    dirs.push(dir);
    const epochPath = path.join(dir, "epoch");
    await writeFile(epochPath, "turn-1");
    const manager = new CoachMcpTurnState(epochPath);
    await manager.current();
    await writeFile(epochPath, "turn-2");

    const [first, second] = await Promise.all([
      manager.current(),
      manager.current(),
    ]);

    expect(first).toBe(second);
  });
});
