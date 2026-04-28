"use client";

import { useMemo } from "react";
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

  function setRange(r: Range) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", r);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="topbar">
      <div className="title-block">
        <h1>{title}</h1>
        <div className="date">{subtitle}</div>
      </div>
      <div className="right">
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
        <div className="icon-btn" title="Sync" role="button">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon("refresh-cw")} alt="sync" />
        </div>
        <div className="icon-btn" title="Notifications" role="button">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon("bell")} alt="notifications" />
        </div>
      </div>
    </div>
  );
}
