// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CursorAcpRuntime } from "./cursor-acp-runtime";
import { CursorAcpSessionRegistry } from "./cursor-acp-registry";

vi.mock("server-only", () => ({}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fakeRuntime() {
  const runtime = {
    healthy: true,
    isHealthy() {
      return this.healthy;
    },
    dispose: vi.fn(async function (this: { healthy: boolean }) {
      this.healthy = false;
    }),
  };
  return runtime as unknown as CursorAcpRuntime;
}

function input(
  overrides: Partial<{
    userId: number;
    threadId: number;
    credentialFingerprint: string;
    promptFingerprint: string;
  }> = {},
) {
  return {
    userId: overrides.userId ?? 1,
    threadId: overrides.threadId ?? 10,
    key: "key",
    keyOrigin: "user" as const,
    credentialFingerprint: overrides.credentialFingerprint ?? "credential-1",
    promptFingerprint: overrides.promptFingerprint ?? "prompt-1",
    withMcp: true,
    historyFingerprint: "history-1",
  };
}

describe("CursorAcpSessionRegistry", () => {
  it("reuses a healthy session and serializes turns for one thread", async () => {
    const runtime = fakeRuntime();
    const factory = vi.fn(async () => runtime);
    const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);
    const order: string[] = [];

    const first = registry.run(input(), async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first-end");
    });
    const second = registry.run(input(), async () => {
      order.push("second");
    });
    await Promise.all([first, second]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["first-start", "first-end", "second"]);
    await registry.disposeAll();
  });

  it("replaces a session when credentials change", async () => {
    const first = fakeRuntime();
    const second = fakeRuntime();
    const factory = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);

    await registry.run(input(), async () => {});
    await registry.run(
      input({ credentialFingerprint: "credential-2" }),
      async () => {},
    );

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);
    await registry.disposeAll();
  });

  it("serializes credential replacement behind an active thread turn", async () => {
    const first = fakeRuntime();
    const second = fakeRuntime();
    const factory = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);
    const order: string[] = [];

    const active = registry.run(input(), async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first-end");
    });
    const rotated = registry.run(
      input({ credentialFingerprint: "credential-2" }),
      async () => {
        order.push("second");
      },
    );
    await Promise.all([active, rotated]);

    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(first.dispose).toHaveBeenCalledOnce();
    await registry.disposeAll();
  });

  it("restarts when another provider changed the persisted thread history", async () => {
    const first = fakeRuntime();
    const second = fakeRuntime();
    const factory = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);

    await registry.run(input(), async (active) => {
      active.hasPrompted = true;
      active.historyFingerprint = "history-1";
    });
    await registry.run(
      { ...input(), historyFingerprint: "history-from-anthropic" },
      async () => {},
    );

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);
    await registry.disposeAll();
  });

  it("keeps users and threads isolated", async () => {
    const factory = vi.fn(async () => fakeRuntime());
    const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);

    await registry.run(input(), async () => {});
    await registry.run(input({ userId: 2 }), async () => {});
    await registry.run(input({ threadId: 11 }), async () => {});

    expect(factory).toHaveBeenCalledTimes(3);
    expect(registry.size()).toBe(3);
    await registry.disposeAll();
  });

  it("allows different user and thread sessions to run in parallel", async () => {
    const registry = new CursorAcpSessionRegistry(
      vi.fn(async () => fakeRuntime()),
      60_000,
      4,
    );
    const bothStarted = deferred<void>();
    const release = deferred<void>();
    let active = 0;
    let maximumActive = 0;
    const operation = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (active === 2) bothStarted.resolve();
      await release.promise;
      active -= 1;
    };

    const first = registry.run(input({ userId: 1, threadId: 1 }), operation);
    const second = registry.run(input({ userId: 2, threadId: 2 }), operation);
    await bothStarted.promise;
    release.resolve();
    await Promise.all([first, second]);

    expect(maximumActive).toBe(2);
    await registry.disposeAll();
  });

  it("evicts the least recently used idle session at capacity", async () => {
    const runtimes = [fakeRuntime(), fakeRuntime(), fakeRuntime()];
    const factory = vi
      .fn()
      .mockResolvedValueOnce(runtimes[0])
      .mockResolvedValueOnce(runtimes[1])
      .mockResolvedValueOnce(runtimes[2]);
    const registry = new CursorAcpSessionRegistry(factory, 60_000, 2);

    await registry.run(input({ threadId: 1 }), async () => {});
    await new Promise((resolve) => setTimeout(resolve, 2));
    await registry.run(input({ threadId: 2 }), async () => {});
    await registry.run(input({ threadId: 3 }), async () => {});

    expect(runtimes[0].dispose).toHaveBeenCalledOnce();
    expect(registry.size()).toBe(2);
    await registry.disposeAll();
  });

  it("rejects a new session while every bounded slot is active", async () => {
    const registry = new CursorAcpSessionRegistry(
      vi.fn(async () => fakeRuntime()),
      60_000,
      1,
    );
    let releaseFirst: (() => void) | undefined;
    const firstStarted = deferred<void>();
    const first = registry.run(input({ threadId: 1 }), async () => {
      firstStarted.resolve();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    await firstStarted.promise;

    await expect(
      registry.run(input({ threadId: 2 }), async () => {}),
    ).rejects.toThrow("active session limit");
    expect(registry.size()).toBe(1);

    releaseFirst?.();
    await first;
    await registry.disposeAll();
  });

  it("evicts an idle session after its configured TTL", async () => {
    const runtime = fakeRuntime();
    const registry = new CursorAcpSessionRegistry(
      vi.fn(async () => runtime),
      10,
      4,
    );

    await registry.run(input(), async () => {});
    await vi.waitFor(() => expect(registry.size()).toBe(0), { timeout: 250 });

    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
