"use client";

import { useMemo, useState } from "react";
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

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const title = TITLES[pathname] ?? "Overview";
  const range = (searchParams.get("range") as Range) ?? "30d";
  const subtitle = useMemo(formatToday, []);
  const [syncing, setSyncing] = useState(false);

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
