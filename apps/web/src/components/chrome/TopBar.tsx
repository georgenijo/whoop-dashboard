"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const RANGES = ["7d", "14d", "30d", "90d", "all"] as const;
type Range = (typeof RANGES)[number];

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/recovery": "Recovery",
  "/sleep": "Sleep",
  "/strain": "Strain",
  "/workouts": "Workouts",
  "/coach": "Coach",
  "/logs": "Logs",
  "/history": "History",
  "/settings": "Settings",
};

const SYNC_STATUS_TIMEOUT_MS = 4000;

type SyncStatus =
  | { kind: "idle" }
  | { kind: "synced" }
  | { kind: "skipped"; lastSyncAt: string }
  | { kind: "error" };

function icon(name: string) {
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
}

function formatToday(): string {
  const d = new Date();
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).replace(",", " ·");
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function syncStatusLabel(status: SyncStatus): string | null {
  switch (status.kind) {
    case "synced":
      return "Synced just now";
    case "skipped":
      return `Already up to date · synced ${formatRelative(status.lastSyncAt)}`;
    case "error":
      return "Sync failed";
    default:
      return null;
  }
}

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const title = TITLES[pathname] ?? "Overview";
  const range = (searchParams.get("range") as Range) ?? "30d";
  const subtitle = useMemo(formatToday, []);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: "idle" });
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  function flashStatus(status: SyncStatus) {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setSyncStatus(status);
    statusTimerRef.current = setTimeout(
      () => setSyncStatus({ kind: "idle" }),
      SYNC_STATUS_TIMEOUT_MS
    );
  }

  function setRange(r: Range) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", r);
    router.push(`${pathname}?${params.toString()}`);
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const data = await r.json();
      if (!r.ok) {
        console.error("Sync failed", data);
        flashStatus({ kind: "error" });
        return;
      }
      if (data?.skipped) {
        flashStatus({
          kind: "skipped",
          lastSyncAt: typeof data.lastSyncAt === "string" ? data.lastSyncAt : new Date().toISOString(),
        });
        return;
      }
      flashStatus({ kind: "synced" });
      router.refresh();
    } catch (e) {
      console.error("Sync error", e);
      flashStatus({ kind: "error" });
    } finally {
      setSyncing(false);
    }
  }

  const showRangePicker =
    pathname === "/" ||
    pathname === "/recovery" ||
    pathname === "/sleep" ||
    pathname === "/strain" ||
    pathname === "/workouts";

  return (
    <div className="topbar">
      <div className="title-block">
        <h1>{title}</h1>
        <div className="date">{subtitle}</div>
      </div>
      <div className="right">
        {showRangePicker && (
          <div className="range" role="tablist" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r}
                className={range === r ? "active" : ""}
                onClick={() => setRange(r)}
                type="button"
                role="tab"
                aria-selected={range === r}
              >
                {r}
              </button>
            ))}
          </div>
        )}
        {(() => {
          const label = syncStatusLabel(syncStatus);
          if (!label) return null;
          return (
            <span
              role="status"
              aria-live="polite"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                color: syncStatus.kind === "error" ? "#ff6b6b" : "var(--fg-3)",
              }}
            >
              {label}
            </span>
          );
        })()}
        <button
          type="button"
          className="icon-btn"
          title="Sync Whoop data"
          onClick={handleSync}
          disabled={syncing}
          style={{ cursor: syncing ? "wait" : "pointer", opacity: syncing ? 0.6 : 1 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={icon("refresh-cw")}
            alt="sync"
            style={{ animation: syncing ? "spin 1s linear infinite" : undefined }}
          />
        </button>
        <div className="icon-btn" title="Notifications" role="button">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon("bell")} alt="notifications" />
        </div>
      </div>
    </div>
  );
}
