"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, RefreshCw } from "lucide-react";

const RANGES = ["7d", "14d", "30d", "90d", "all"] as const;
type Range = (typeof RANGES)[number];

const SYNC_MESSAGE_TIMEOUT_MS = 4000;

function formatAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

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

function formatToday(): string {
  const d = new Date();
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).replace(",", " ·");
}

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const title = TITLES[pathname] ?? "Overview";
  const range = (searchParams.get("range") as Range) ?? "30d";
  const subtitle = useMemo(formatToday, []);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []);

  function flashMessage(text: string) {
    setSyncMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setSyncMessage(null), SYNC_MESSAGE_TIMEOUT_MS);
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
      const data = (await r.json()) as {
        ok?: boolean;
        skipped?: boolean;
        reason?: string;
        lastSyncAt?: string;
      };
      if (!r.ok) {
        console.error("Sync failed", data);
      } else if (data.skipped && data.lastSyncAt) {
        flashMessage(`Already up to date (synced ${formatAgo(data.lastSyncAt)})`);
      }
      router.refresh();
    } catch (e) {
      console.error("Sync error", e);
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
        {syncMessage && (
          <div
            role="status"
            aria-live="polite"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              color: "var(--fg-2)",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              padding: "4px 10px",
              whiteSpace: "nowrap",
            }}
          >
            {syncMessage}
          </div>
        )}
        <button
          type="button"
          className="icon-btn"
          title="Sync Whoop data"
          onClick={handleSync}
          disabled={syncing}
          style={{ cursor: syncing ? "wait" : "pointer", opacity: syncing ? 0.6 : 1 }}
        >
          <RefreshCw
            size={15}
            strokeWidth={1.8}
            aria-label="sync"
            style={{ animation: syncing ? "spin 1s linear infinite" : undefined }}
          />
        </button>
        <div className="icon-btn" title="Notifications" role="button">
          <Bell size={15} strokeWidth={1.8} aria-label="notifications" />
        </div>
      </div>
    </div>
  );
}
