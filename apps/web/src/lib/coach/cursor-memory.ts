import { readFileSync } from "node:fs";

/**
 * Pre-flight memory check before spawning cursor-agent (issue #475-A, option 2).
 *
 * cursor-agent runs as a child of the Next.js server, inside the same systemd
 * cgroup (`whoop-web.service`, `MemoryMax` capped). When that cgroup is pinned
 * at its ceiling, a freshly spawned cursor-agent thrashes for 12-17s and is
 * then killed by a signal, and the user is told "try again" at something a
 * retry won't fix. With this check enabled the turn fails fast, before any
 * spawn, with a message that names the actual problem.
 *
 * DEFAULT OFF. Enabled only when `COACH_CURSOR_MIN_AVAILABLE_MB` is a positive
 * number. When unset (or the measurement can't be taken, e.g. not Linux) the
 * spawn path is unchanged: this module fails open and never blocks a turn on
 * a reading it couldn't make.
 */

const MB = 1024 * 1024;

export interface MemoryAvailability {
  /** min(host MemAvailable, tightest cgroup headroom), or whichever is known. */
  available_bytes: number;
  host_available_bytes: number | null;
  cgroup_headroom_bytes: number | null;
  /** The cgroup whose limit produced `cgroup_headroom_bytes`. */
  cgroup_limited_by: string | null;
}

export interface CursorMemoryPreflight extends MemoryAvailability {
  required_bytes: number;
  ok: boolean;
}

export class CursorInsufficientMemoryError extends Error {
  constructor(public readonly preflight: CursorMemoryPreflight) {
    super(
      `Not enough memory to start cursor-agent: ${toMb(preflight.available_bytes)} MB available, ` +
        `${toMb(preflight.required_bytes)} MB required`,
    );
    this.name = "CursorInsufficientMemoryError";
  }
}

export type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, "utf8");

function toMb(bytes: number): number {
  return Math.floor(bytes / MB);
}

/** Threshold in bytes, or null when the check is disabled. */
export function cursorMemoryThresholdBytes(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | null {
  const raw = env.COACH_CURSOR_MIN_AVAILABLE_MB?.trim();
  if (!raw) return null;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb <= 0) return null;
  return Math.floor(mb * MB);
}

function tryRead(readFile: ReadFile, path: string): string | null {
  try {
    return readFile(path);
  } catch {
    return null;
  }
}

function hostAvailableBytes(readFile: ReadFile): number | null {
  const meminfo = tryRead(readFile, "/proc/meminfo");
  const match = meminfo?.match(/^MemAvailable:\s+(\d+)\s*kB/m);
  return match ? Number(match[1]) * 1024 : null;
}

/**
 * Headroom under the tightest cgroup v2 `memory.max` from this process's
 * cgroup up to the root. Usage is the working set — `memory.current` minus
 * `inactive_file` — because page cache counts toward `memory.current` but is
 * reclaimed before the kernel kills anything; using raw `memory.current`
 * would report a cgroup with a warm cache as permanently full.
 */
function cgroupHeadroom(
  readFile: ReadFile,
): { bytes: number; path: string } | null {
  const self = tryRead(readFile, "/proc/self/cgroup");
  const line = self?.split("\n").find((l) => l.startsWith("0::"));
  if (!line) return null; // cgroup v1 or no cgroup info: unknown, not zero
  let rel = line.slice(3).trim();
  let best: { bytes: number; path: string } | null = null;
  for (;;) {
    const dir = `/sys/fs/cgroup${rel === "/" ? "" : rel}`;
    const max = tryRead(readFile, `${dir}/memory.max`)?.trim();
    if (max && max !== "max" && /^\d+$/.test(max)) {
      const current = Number(tryRead(readFile, `${dir}/memory.current`)?.trim());
      if (Number.isFinite(current)) {
        const stat = tryRead(readFile, `${dir}/memory.stat`) ?? "";
        const inactiveFile = Number(stat.match(/^inactive_file\s+(\d+)/m)?.[1] ?? 0);
        const workingSet = Math.max(0, current - inactiveFile);
        const headroom = Math.max(0, Number(max) - workingSet);
        if (!best || headroom < best.bytes) best = { bytes: headroom, path: rel };
      }
    }
    if (rel === "/" || rel === "") break;
    const parent = rel.slice(0, rel.lastIndexOf("/"));
    rel = parent === "" ? "/" : parent;
  }
  return best;
}

/** Best-effort reading; null when neither host nor cgroup figures are known. */
export function readMemoryAvailability(
  readFile: ReadFile = defaultReadFile,
): MemoryAvailability | null {
  const host = hostAvailableBytes(readFile);
  const cgroup = cgroupHeadroom(readFile);
  const known = [host, cgroup?.bytes].filter((n): n is number => n != null);
  if (known.length === 0) return null;
  return {
    available_bytes: Math.min(...known),
    host_available_bytes: host,
    cgroup_headroom_bytes: cgroup?.bytes ?? null,
    cgroup_limited_by: cgroup?.path ?? null,
  };
}

/**
 * Returns the reading when the check ran, null when it is disabled or the
 * reading was unavailable. Throws `CursorInsufficientMemoryError` when
 * enabled and available memory is under the threshold — before any spawn.
 */
export function assertCursorSpawnMemory(
  env: Readonly<Record<string, string | undefined>> = process.env,
  readFile: ReadFile = defaultReadFile,
): CursorMemoryPreflight | null {
  const required = cursorMemoryThresholdBytes(env);
  if (required == null) return null;
  const reading = readMemoryAvailability(readFile);
  if (!reading) return null;
  const preflight: CursorMemoryPreflight = {
    ...reading,
    required_bytes: required,
    ok: reading.available_bytes >= required,
  };
  if (!preflight.ok) throw new CursorInsufficientMemoryError(preflight);
  return preflight;
}
