"use client";

import { useMemo, useState } from "react";

const RANGES = ["7d", "14d", "30d", "90d"] as const;
type Range = (typeof RANGES)[number];

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

export default function TopBar({ title }: { title: string }) {
  const [range, setRange] = useState<Range>("30d");
  const subtitle = useMemo(formatToday, []);

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
