// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("reports whether the session was reused or cold-started", async () => {
    const registry = new CursorAcpSessionRegistry(
      vi.fn(async () => fakeRuntime()),
      60_000,
      4,
    );
    const sessions: boolean[] = [];

    await registry.run(input(), async (_runtime, session) => {
      sessions.push(session.reused);
    });
    await registry.run(input(), async (_runtime, session) => {
      sessions.push(session.reused);
    });

    expect(sessions).toEqual([false, true]);
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

  it("does not block another user behind a slow session startup", async () => {
    const firstStart = deferred<CursorAcpRuntime>();
    const firstFactoryCalled = deferred<void>();
    const secondRuntime = fakeRuntime();
    const factory = vi.fn(async ({ userId }: { userId: number }) => {
      if (userId === 1) {
        firstFactoryCalled.resolve();
        return firstStart.promise;
      }
      return secondRuntime;
    });
    const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);

    const first = registry.run(
      input({ userId: 1, threadId: 1 }),
      async () => {},
    );
    await firstFactoryCalled.promise;
    await registry.run(input({ userId: 2, threadId: 2 }), async (runtime) =>
      expect(runtime).toBe(secondRuntime),
    );

    firstStart.resolve(fakeRuntime());
    await first;
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

  it("drains and disposes a runtime that finishes starting during shutdown", async () => {
    const start = deferred<CursorAcpRuntime>();
    const factoryCalled = deferred<void>();
    const runtime = fakeRuntime();
    const registry = new CursorAcpSessionRegistry(
      vi.fn(async () => {
        factoryCalled.resolve();
        return start.promise;
      }),
      60_000,
      4,
    );
    const run = registry.run(input(), async () => {});
    await factoryCalled.promise;

    const shutdown = registry.disposeAll();
    start.resolve(runtime);
    await shutdown;

    await expect(run).rejects.toThrow("shutting down");
    expect(runtime.dispose).toHaveBeenCalledOnce();
    await expect(registry.run(input(), async () => {})).rejects.toThrow(
      "shutting down",
    );
  });

  describe("lifecycle pressure (#552)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("single-flights a slow startup across queued turns on one thread", async () => {
      const start = deferred<CursorAcpRuntime>();
      const factoryCalled = deferred<void>();
      const runtime = fakeRuntime();
      const factory = vi.fn(async () => {
        factoryCalled.resolve();
        return start.promise;
      });
      const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);
      const seen: Array<{ runtime: CursorAcpRuntime; reused: boolean }> = [];

      const runs = [1, 2, 3].map(() =>
        registry.run(input(), async (active, session) => {
          seen.push({ runtime: active, reused: session.reused });
        }),
      );
      await factoryCalled.promise;
      start.resolve(runtime);
      await Promise.all(runs);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(seen.map((entry) => entry.runtime)).toEqual([
        runtime,
        runtime,
        runtime,
      ]);
      expect(seen.map((entry) => entry.reused)).toEqual([false, true, true]);
      await registry.disposeAll();
    });

    it("replaces a session when the system prompt fingerprint changes", async () => {
      const first = fakeRuntime();
      const second = fakeRuntime();
      const factory = vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);

      await registry.run(input(), async () => {});
      await registry.run(
        input({ promptFingerprint: "prompt-2" }),
        async (active) => expect(active).toBe(second),
      );

      expect(first.dispose).toHaveBeenCalledOnce();
      expect(registry.size()).toBe(1);
      await registry.disposeAll();
    });

    it("evicts a runtime that became unhealthy during its turn", async () => {
      const first = fakeRuntime();
      const second = fakeRuntime();
      const factory = vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);

      await registry.run(input(), async (active) => {
        (active as unknown as { healthy: boolean }).healthy = false;
      });
      expect(first.dispose).toHaveBeenCalledOnce();
      expect(registry.size()).toBe(0);

      await registry.run(input(), async (active, session) => {
        expect(active).toBe(second);
        expect(session.reused).toBe(false);
      });
      await registry.disposeAll();
    });

    it("releases the thread and keeps the session after an operation throws", async () => {
      const runtime = fakeRuntime();
      const factory = vi.fn(async () => runtime);
      const registry = new CursorAcpSessionRegistry(factory, 60_000, 4);

      const failed = registry.run(input(), async () => {
        throw new Error("turn failed");
      });
      const next = registry.run(input(), async (_active, session) => {
        expect(session.reused).toBe(true);
        return "ok";
      });

      await expect(failed).rejects.toThrow("turn failed");
      await expect(next).resolves.toBe("ok");
      expect(factory).toHaveBeenCalledOnce();
      expect(runtime.dispose).not.toHaveBeenCalled();
      await registry.disposeAll();
    });

    it("does not leak a capacity slot when startup fails", async () => {
      const runtime = fakeRuntime();
      const factory = vi
        .fn()
        .mockRejectedValueOnce(new Error("spawn failed"))
        .mockResolvedValueOnce(runtime);
      const registry = new CursorAcpSessionRegistry(factory, 60_000, 1);

      await expect(
        registry.run(input({ threadId: 1 }), async () => {}),
      ).rejects.toThrow("spawn failed");
      expect(registry.size()).toBe(0);
      await registry.run(input({ threadId: 2 }), async (active) =>
        expect(active).toBe(runtime),
      );
      expect(registry.size()).toBe(1);
      await registry.disposeAll();
    });

    it("evicts the idle session rather than the busy one at capacity", async () => {
      const busy = fakeRuntime();
      const idle = fakeRuntime();
      const incoming = fakeRuntime();
      const factory = vi
        .fn()
        .mockResolvedValueOnce(busy)
        .mockResolvedValueOnce(idle)
        .mockResolvedValueOnce(incoming);
      const registry = new CursorAcpSessionRegistry(factory, 60_000, 2);
      const busyStarted = deferred<void>();
      const releaseBusy = deferred<void>();

      // The busy session is the least recently used one, so plain LRU would
      // pick it; an active prompt must never be evicted.
      const active = registry.run(input({ threadId: 1 }), async () => {
        busyStarted.resolve();
        await releaseBusy.promise;
      });
      await busyStarted.promise;
      await registry.run(input({ threadId: 2 }), async () => {});
      await registry.run(input({ threadId: 3 }), async () => {});

      expect(busy.dispose).not.toHaveBeenCalled();
      expect(idle.dispose).toHaveBeenCalledOnce();
      releaseBusy.resolve();
      await active;
      expect(registry.size()).toBe(2);
      await registry.disposeAll();
    });

    it("defers idle eviction until an over-TTL turn finishes", async () => {
      vi.useFakeTimers();
      const runtime = fakeRuntime();
      const registry = new CursorAcpSessionRegistry(
        vi.fn(async () => runtime),
        1_000,
        4,
      );
      const started = deferred<void>();
      const release = deferred<void>();

      const turn = registry.run(input(), async () => {
        started.resolve();
        await release.promise;
      });
      await started.promise;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(runtime.dispose).not.toHaveBeenCalled();
      expect(registry.size()).toBe(1);

      release.resolve();
      await turn;
      await vi.advanceTimersByTimeAsync(999);
      expect(runtime.dispose).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(runtime.dispose).toHaveBeenCalledOnce();
      expect(registry.size()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("disposes an active session at shutdown and rejects queued and new turns", async () => {
      vi.useFakeTimers();
      const runtime = fakeRuntime();
      const registry = new CursorAcpSessionRegistry(
        vi.fn(async () => runtime),
        60_000,
        4,
      );
      const started = deferred<void>();
      const release = deferred<void>();

      const active = registry.run(input(), async () => {
        started.resolve();
        await release.promise;
        return "finished";
      });
      await started.promise;
      const queued = registry.run(input(), async () => "never");
      const queuedOutcome = queued.then(
        () => "resolved",
        (error: unknown) => (error as Error).message,
      );

      await registry.disposeAll();
      expect(runtime.dispose).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);

      release.resolve();
      await expect(active).resolves.toBe("finished");
      await expect(queuedOutcome).resolves.toMatch("shutting down");
      await expect(registry.run(input(), async () => {})).rejects.toThrow(
        "shutting down",
      );
      expect(runtime.dispose).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
