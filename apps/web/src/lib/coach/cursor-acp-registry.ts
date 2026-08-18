import "server-only";

import { createHash } from "node:crypto";
import { CursorAcpRuntime } from "./cursor-acp-runtime";
import { CursorAgentError, type CursorKeyOrigin } from "./cursor-errors";

const DEFAULT_IDLE_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_SESSIONS = 4;
const REGISTRY_SHUTDOWN_GRACE_MS = 6_000;

function positiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function cursorCredentialFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function cursorPromptFingerprint(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

type RuntimeFactoryInput = {
  userId: number;
  key: string;
  keyOrigin: CursorKeyOrigin;
  credentialFingerprint: string;
  promptFingerprint: string;
  withMcp: boolean;
};

type RegistryEntry = {
  baseKey: string;
  signature: string;
  runtime: CursorAcpRuntime;
  lastUsedAt: number;
  busy: number;
  idleTimer?: ReturnType<typeof setTimeout>;
};

export class CursorAcpSessionRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly starting = new Map<string, Promise<CursorAcpRuntime>>();
  private readonly threadTails = new Map<string, Promise<void>>();
  private lifecycleTail = Promise.resolve();
  private closed = false;

  constructor(
    private readonly factory: (
      input: RuntimeFactoryInput,
    ) => Promise<CursorAcpRuntime> = CursorAcpRuntime.start,
    private readonly idleTtlMs = positiveEnvInt(
      "COACH_CURSOR_ACP_IDLE_TTL_MS",
      DEFAULT_IDLE_TTL_MS,
    ),
    private readonly maxSessions = positiveEnvInt(
      "COACH_CURSOR_ACP_MAX_SESSIONS",
      DEFAULT_MAX_SESSIONS,
    ),
  ) {}

  private scheduleIdle(entry: RegistryEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      if (entry.busy > 0 || Date.now() - entry.lastUsedAt < this.idleTtlMs) {
        this.scheduleIdle(entry);
        return;
      }
      void this.evict(entry.baseKey, entry.runtime);
    }, this.idleTtlMs);
    entry.idleTimer.unref?.();
  }

  private async evict(
    baseKey: string,
    expected?: CursorAcpRuntime,
  ): Promise<void> {
    const entry = this.entries.get(baseKey);
    if (!entry || (expected && entry.runtime !== expected)) return;
    this.entries.delete(baseKey);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    await entry.runtime.dispose();
  }

  private async enforceCapacity(exceptKey: string): Promise<void> {
    while (this.entries.size + this.starting.size >= this.maxSessions) {
      const candidate = [...this.entries.values()]
        .filter((entry) => entry.baseKey !== exceptKey && entry.busy === 0)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (!candidate) {
        throw new CursorAgentError(
          "agent",
          "Cursor coach is at its active session limit; retry shortly",
        );
      }
      await this.evict(candidate.baseKey, candidate.runtime);
    }
  }

  private async withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleTail;
    let release: (() => void) | undefined;
    this.lifecycleTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  private closedError(): CursorAgentError {
    return new CursorAgentError(
      "agent",
      "Cursor coach session registry is shutting down",
    );
  }

  private async getOrCreate(
    input: RuntimeFactoryInput & {
      threadId: number;
      historyFingerprint: string;
    },
  ): Promise<RegistryEntry> {
    const baseKey = `${input.userId}:${input.threadId}`;
    const signature = `${baseKey}:${input.credentialFingerprint}:${input.promptFingerprint}`;
    const reservation = await this.withLifecycleLock(async () => {
      if (this.closed) throw this.closedError();
      const existing = this.entries.get(baseKey);
      if (
        existing &&
        existing.signature === signature &&
        existing.runtime.isHealthy() &&
        (!existing.runtime.hasPrompted ||
          existing.runtime.historyFingerprint === input.historyFingerprint)
      ) {
        existing.lastUsedAt = Date.now();
        this.scheduleIdle(existing);
        return { entry: existing, start: null };
      }
      if (existing) await this.evict(baseKey, existing.runtime);

      let start = this.starting.get(signature);
      if (!start) {
        await this.enforceCapacity(baseKey);
        start = this.factory(input);
        this.starting.set(signature, start);
      }
      return { entry: null, start };
    });
    if (reservation.entry) return reservation.entry;

    const start = reservation.start;
    if (!start) throw this.closedError();
    let runtime: CursorAcpRuntime;
    try {
      runtime = await start;
    } catch (error) {
      await this.withLifecycleLock(async () => {
        if (this.starting.get(signature) === start) {
          this.starting.delete(signature);
        }
      });
      throw error;
    }

    return this.withLifecycleLock(async () => {
      if (this.starting.get(signature) === start) {
        this.starting.delete(signature);
      }
      if (this.closed) {
        throw this.closedError();
      }
      const ready = this.entries.get(baseKey);
      if (ready && ready.signature === signature && ready.runtime === runtime) {
        return ready;
      }
      const entry: RegistryEntry = {
        baseKey,
        signature,
        runtime,
        lastUsedAt: Date.now(),
        busy: 0,
      };
      this.entries.set(baseKey, entry);
      this.scheduleIdle(entry);
      return entry;
    });
  }

  async run<T>(
    input: RuntimeFactoryInput & {
      threadId: number;
      historyFingerprint: string;
    },
    operation: (runtime: CursorAcpRuntime) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw this.closedError();
    const baseKey = `${input.userId}:${input.threadId}`;
    const previous = this.threadTails.get(baseKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.threadTails.set(baseKey, current);
    await previous;
    let entry: RegistryEntry | undefined;
    try {
      entry = await this.getOrCreate(input);
      entry.busy += 1;
      entry.lastUsedAt = Date.now();
      return await operation(entry.runtime);
    } finally {
      if (entry) {
        entry.busy -= 1;
        entry.lastUsedAt = Date.now();
        if (!entry.runtime.isHealthy()) {
          await this.evict(entry.baseKey, entry.runtime);
        } else {
          this.scheduleIdle(entry);
        }
      }
      release?.();
      if (this.threadTails.get(baseKey) === current) {
        this.threadTails.delete(baseKey);
      }
    }
  }

  async disposeAll(): Promise<void> {
    const snapshot = await this.withLifecycleLock(async () => {
      this.closed = true;
      const entries = [...this.entries.values()];
      const starts = [...this.starting.values()];
      this.entries.clear();
      this.starting.clear();
      this.threadTails.clear();
      for (const entry of entries) {
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
      }
      return { entries, starts };
    });
    const started = await Promise.allSettled(snapshot.starts);
    const runtimes = new Set(snapshot.entries.map((entry) => entry.runtime));
    for (const result of started) {
      if (result.status === "fulfilled") runtimes.add(result.value);
    }
    await Promise.all([...runtimes].map((runtime) => runtime.dispose()));
  }

  size(): number {
    return this.entries.size;
  }
}

const globalRegistry = globalThis as typeof globalThis & {
  __coachCursorAcpRegistry?: CursorAcpSessionRegistry;
  __coachCursorAcpShutdownHooks?: boolean;
};

export const cursorAcpSessions = (globalRegistry.__coachCursorAcpRegistry ??=
  new CursorAcpSessionRegistry());

if (
  process.env.NODE_ENV !== "test" &&
  !globalRegistry.__coachCursorAcpShutdownHooks
) {
  globalRegistry.__coachCursorAcpShutdownHooks = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const shutdown = () => {
      const finish = () => {
        process.removeListener(signal, shutdown);
        process.kill(process.pid, signal);
      };
      const hardExit = setTimeout(finish, REGISTRY_SHUTDOWN_GRACE_MS);
      hardExit.unref?.();
      void cursorAcpSessions.disposeAll().finally(() => {
        clearTimeout(hardExit);
        finish();
      });
    };
    process.once(signal, shutdown);
  }
}
