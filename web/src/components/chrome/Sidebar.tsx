"use client";

import { useState } from "react";

type NavItem = { id: string; label: string; icon: string };

const nav: NavItem[] = [
  { id: "overview", label: "Overview", icon: "layout-dashboard" },
  { id: "recovery", label: "Recovery", icon: "activity" },
  { id: "sleep", label: "Sleep", icon: "moon" },
  { id: "strain", label: "Strain", icon: "flame" },
  { id: "workouts", label: "Workouts", icon: "dumbbell" },
];

const secondary: NavItem[] = [
  { id: "coach", label: "Coach", icon: "sparkles" },
  { id: "history", label: "History", icon: "calendar" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function icon(name: string) {
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
}

export default function Sidebar() {
  // Only Overview is wired in Phase 1; the rest are visual-only placeholders.
  const [active, setActive] = useState<string>("overview");

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="mark">W</div>
        <span className="wm">
          whoop<span className="plus">+</span>
        </span>
      </div>

      <div className="sb-nav">
        <div className="sb-group-label">Dashboard</div>
        {nav.map((n) => (
          <button
            key={n.id}
            className={`sb-link ${active === n.id ? "active" : ""}`}
            onClick={() => setActive(n.id)}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon(n.icon)} alt="" />
            {n.label}
          </button>
        ))}
        <div className="sb-group-label">Intelligence</div>
        {secondary.map((n) => (
          <button
            key={n.id}
            className={`sb-link ${active === n.id ? "active" : ""}`}
            onClick={() => setActive(n.id)}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon(n.icon)} alt="" />
            {n.label}
          </button>
        ))}
      </div>

      <div className="sb-profile">
        <div className="av">G</div>
        <div className="who">
          <div className="n">George N.</div>
          <div className="s">whoop 4.0 · connect to sync</div>
        </div>
      </div>
    </aside>
  );
}
