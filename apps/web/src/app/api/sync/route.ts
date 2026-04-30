import { spawn } from "child_process";
import path from "path";
import { addSyncLog } from "@/lib/db";

export const dynamic = "force-dynamic";

type ParsedCounts = {
  recovery: number | null;
  sleep: number | null;
  workouts: number | null;
};

type ParsedSyncOutput = {
  counts: ParsedCounts;
  details: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCounts(stdout: string): ParsedCounts {
  // daily_sync.py prints: "Synced: 7 recovery, 7 sleep, 2 workouts"
  const m = stdout.match(/Synced:\s+(\d+)\s+recovery,\s+(\d+)\s+sleep,\s+(\d+)\s+workouts/);
  if (!m) return { recovery: null, sleep: null, workouts: null };
  return {
    recovery: parseInt(m[1], 10),
    sleep: parseInt(m[2], 10),
    workouts: parseInt(m[3], 10),
  };
}

function parseStructuredOutput(stdout: string): ParsedSyncOutput | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) continue;

      const countsValue = parsed.counts;
      const detailsValue = parsed.details;
      const counts = isRecord(countsValue)
        ? {
            recovery: numberOrNull(countsValue.recovery),
            sleep: numberOrNull(countsValue.sleep),
            workouts: numberOrNull(countsValue.workouts),
          }
        : { recovery: null, sleep: null, workouts: null };

      return {
        counts,
        details: isRecord(detailsValue) ? JSON.stringify(detailsValue) : null,
      };
    } catch {
      // Keep scanning older stdout lines; human-readable sync output is not JSON.
    }
  }

  return null;
}

function runSync(): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const repoRoot = path.resolve(process.cwd(), "..", "..");
    const py = path.join(repoRoot, "venv/bin/python");
    const script = path.join(repoRoot, "sync", "daily_sync.py");

    const child = spawn(py, [script], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, 120_000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, stdout, stderr });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, stdout, stderr: stderr + "\n" + err.message });
    });
  });
}

export async function POST() {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const { ok, stdout, stderr } = await runSync();
  const durationMs = Date.now() - t0;
  const structured = parseStructuredOutput(stdout);
  const fallbackCounts = parseCounts(stdout);
  const counts = structured
    ? {
        recovery: structured.counts.recovery ?? fallbackCounts.recovery,
        sleep: structured.counts.sleep ?? fallbackCounts.sleep,
        workouts: structured.counts.workouts ?? fallbackCounts.workouts,
      }
    : fallbackCounts;
  const details = structured?.details ?? null;

  if (ok) {
    addSyncLog({
      started_at: startedAt,
      duration_ms: durationMs,
      status: "ok",
      recovery_count: counts.recovery,
      sleep_count: counts.sleep,
      workouts_count: counts.workouts,
      error_message: null,
      source: "manual",
      details,
    });
    return Response.json({
      ok: true,
      durationMs,
      ...counts,
    });
  }

  const errorMsg = (stderr || stdout).slice(0, 800);
  addSyncLog({
    started_at: startedAt,
    duration_ms: durationMs,
    status: "error",
    recovery_count: counts.recovery,
    sleep_count: counts.sleep,
    workouts_count: counts.workouts,
    error_message: errorMsg,
    source: "manual",
    details,
  });
  return Response.json({ ok: false, error: errorMsg, durationMs }, { status: 500 });
}
