// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertCursorSpawnMemory,
  CursorInsufficientMemoryError,
  cursorMemoryThresholdBytes,
  readMemoryAvailability,
  type ReadFile,
} from "./cursor-memory";

const MB = 1024 * 1024;

function fs(files: Record<string, string>): ReadFile {
  return (path) => {
    if (!(path in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return files[path];
  };
}

const SERVICE = "/system.slice/whoop-web.service";
const svc = `/sys/fs/cgroup${SERVICE}`;

// A cgroup pinned at its 512M ceiling, as observed in prod for #475-A.
const pinned = fs({
  "/proc/meminfo": "MemTotal: 979000 kB\nMemAvailable:   400000 kB\n",
  "/proc/self/cgroup": `0::${SERVICE}\n`,
  [`${svc}/memory.max`]: `${512 * MB}\n`,
  [`${svc}/memory.current`]: `${510 * MB}\n`,
  [`${svc}/memory.stat`]: `anon 1\ninactive_file ${4 * MB}\nactive_file 0\n`,
  "/sys/fs/cgroup/system.slice/memory.max": "max\n",
});

describe("cursorMemoryThresholdBytes", () => {
  it("is disabled unless a positive MB value is set", () => {
    expect(cursorMemoryThresholdBytes({})).toBeNull();
    expect(cursorMemoryThresholdBytes({ COACH_CURSOR_MIN_AVAILABLE_MB: "" })).toBeNull();
    expect(cursorMemoryThresholdBytes({ COACH_CURSOR_MIN_AVAILABLE_MB: "0" })).toBeNull();
    expect(cursorMemoryThresholdBytes({ COACH_CURSOR_MIN_AVAILABLE_MB: "-5" })).toBeNull();
    expect(cursorMemoryThresholdBytes({ COACH_CURSOR_MIN_AVAILABLE_MB: "lots" })).toBeNull();
    expect(cursorMemoryThresholdBytes({ COACH_CURSOR_MIN_AVAILABLE_MB: "150" })).toBe(150 * MB);
  });
});

describe("readMemoryAvailability", () => {
  it("takes the tighter of host MemAvailable and cgroup working-set headroom", () => {
    const r = readMemoryAvailability(pinned)!;
    expect(r.host_available_bytes).toBe(400000 * 1024);
    // 512 - (510 - 4 inactive_file) = 6 MB
    expect(r.cgroup_headroom_bytes).toBe(6 * MB);
    expect(r.cgroup_limited_by).toBe(SERVICE);
    expect(r.available_bytes).toBe(6 * MB);
  });

  it("does not count reclaimable page cache as used", () => {
    const r = readMemoryAvailability(
      fs({
        "/proc/self/cgroup": `0::${SERVICE}\n`,
        [`${svc}/memory.max`]: `${512 * MB}`,
        [`${svc}/memory.current`]: `${500 * MB}`,
        [`${svc}/memory.stat`]: `inactive_file ${300 * MB}\n`,
      }),
    )!;
    expect(r.cgroup_headroom_bytes).toBe(312 * MB);
  });

  it("uses an ancestor limit when the service itself is unlimited", () => {
    const r = readMemoryAvailability(
      fs({
        "/proc/self/cgroup": `0::${SERVICE}\n`,
        [`${svc}/memory.max`]: "max\n",
        "/sys/fs/cgroup/system.slice/memory.max": `${1000 * MB}`,
        "/sys/fs/cgroup/system.slice/memory.current": `${900 * MB}`,
      }),
    )!;
    expect(r.cgroup_headroom_bytes).toBe(100 * MB);
    expect(r.cgroup_limited_by).toBe("/system.slice");
    expect(r.host_available_bytes).toBeNull();
  });

  it("returns null when nothing can be read (non-Linux, cgroup v1)", () => {
    expect(readMemoryAvailability(fs({}))).toBeNull();
    expect(readMemoryAvailability(fs({ "/proc/self/cgroup": "12:memory:/foo\n" }))).toBeNull();
  });
});

describe("assertCursorSpawnMemory", () => {
  it("is a no-op when disabled, even under pressure", () => {
    expect(assertCursorSpawnMemory({}, pinned)).toBeNull();
  });

  it("throws an explicit out-of-memory error under the threshold", () => {
    let err: unknown;
    try {
      assertCursorSpawnMemory({ COACH_CURSOR_MIN_AVAILABLE_MB: "150" }, pinned);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CursorInsufficientMemoryError);
    const e = err as CursorInsufficientMemoryError;
    expect(e.message).toBe("Not enough memory to start cursor-agent: 6 MB available, 150 MB required");
    expect(e.preflight.ok).toBe(false);
  });

  it("passes and returns the reading when memory is fine", () => {
    const r = assertCursorSpawnMemory({ COACH_CURSOR_MIN_AVAILABLE_MB: "1" }, pinned);
    expect(r?.ok).toBe(true);
  });

  it("fails open when enabled but the reading is unavailable", () => {
    expect(assertCursorSpawnMemory({ COACH_CURSOR_MIN_AVAILABLE_MB: "150" }, fs({}))).toBeNull();
  });
});
