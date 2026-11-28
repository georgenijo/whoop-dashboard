"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_ICONS } from "./icons";

type NavItem = { href: string; label: string; icon: string };

const nav: NavItem[] = [
  { href: "/", label: "Overview", icon: "layout-dashboard" },
  { href: "/recovery", label: "Recovery", icon: "activity" },
  { href: "/sleep", label: "Sleep", icon: "moon" },
  { href: "/strain", label: "Strain", icon: "flame" },
  { href: "/workouts", label: "Workouts", icon: "dumbbell" },
  { href: "/stats", label: "Stats", icon: "bar-chart-3" },
];

// Added only when RECORDS_PAGE=1 (the layout passes `showRecords`).
const RECORDS_ITEM: NavItem = { href: "/records", label: "Records", icon: "trophy" };

const secondary: NavItem[] = [
  { href: "/coach", label: "Coach", icon: "sparkles" },
  { href: "/plans", label: "Plans", icon: "clipboard-list" },
  { href: "/logs", label: "Logs", icon: "list" },
  { href: "/perf", label: "Performance", icon: "gauge" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

// Default-off /compare entry (PERIOD_COMPARE=1); the server layout decides.
const compareItem: NavItem = { href: "/compare", label: "Compare", icon: "git-compare" };

// Shown only when the server passes `showWeekly` (WEEKLY_REVIEW=1).
const weeklyItem: NavItem = { href: "/weekly", label: "Weekly review", icon: "calendar-days" };

export default function Sidebar({
  showWeekly = false,
  compareEnabled = false,
  showRecords = false,
}: { showWeekly?: boolean; compareEnabled?: boolean; showRecords?: boolean } = {}) {
  const items = [
    ...nav,
    ...(compareEnabled ? [compareItem] : []),
    ...(showRecords ? [RECORDS_ITEM] : []),
  ];
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const range = searchParams.get("range");
  const withRange = (href: string) => (range ? `${href}?range=${range}` : href);

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="mark" aria-hidden />
        <span className="wm">Coach</span>
      </div>

      <div className="sb-nav">
        <div className="sb-group-label">Dashboard</div>
        {items.map((n) => {
          const Icon = NAV_ICONS[n.icon];
          return (
            <Link
              key={n.href}
              href={withRange(n.href)}
              className={`sb-link ${pathname === n.href ? "active" : ""}`}
              data-track={`nav:${n.href}`}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden />
              {n.label}
            </Link>
          );
        })}
        <div className="sb-group-label">Intelligence</div>
        {(showWeekly ? [weeklyItem, ...secondary] : secondary).map((n) => {
          const Icon = NAV_ICONS[n.icon];
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`sb-link ${pathname === n.href ? "active" : ""}`}
              data-track={`nav:${n.href}`}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden />
              {n.label}
            </Link>
          );
        })}
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
