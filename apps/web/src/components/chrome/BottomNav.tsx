"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { NAV_ICONS } from "./icons";

type Item = { href: string; label: string; icon: string };

const tabs: Item[] = [
  { href: "/", label: "Overview", icon: "layout-dashboard" },
  { href: "/recovery", label: "Recovery", icon: "activity" },
  { href: "/sleep", label: "Sleep", icon: "moon" },
  { href: "/strain", label: "Strain", icon: "flame" },
  { href: "/workouts", label: "Workouts", icon: "dumbbell" },
];

const more: Item[] = [
  { href: "/stats", label: "Stats", icon: "bar-chart-3" },
  { href: "/coach", label: "Coach", icon: "sparkles" },
  { href: "/plans", label: "Plans", icon: "clipboard-list" },
  { href: "/logs", label: "Logs", icon: "list" },
  { href: "/perf", label: "Performance", icon: "gauge" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

// Shown only when the server passes `showWeekly` (WEEKLY_REVIEW=1).
const weeklyItem: Item = { href: "/weekly", label: "Weekly review", icon: "calendar-days" };

// Default-off /compare entry (PERIOD_COMPARE=1); the server layout decides.
const compareItem: Item = { href: "/compare", label: "Compare", icon: "git-compare" };

// Added to the "More" drawer only when RECORDS_PAGE=1 (the layout passes `showRecords`).
const RECORDS_ITEM: Item = { href: "/records", label: "Records", icon: "trophy" };

export default function BottomNav({
  showWeekly = false,
  compareEnabled = false,
  showRecords = false,
}: { showWeekly?: boolean; compareEnabled?: boolean; showRecords?: boolean } = {}) {
  const drawerItems = [
    ...(showRecords ? [RECORDS_ITEM] : []),
    ...(showWeekly ? [weeklyItem] : []),
    ...(compareEnabled ? [compareItem] : []),
    ...more,
  ];
  const pathname = usePathname();
  const params = useSearchParams();
  const range = params.get("range");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close the drawer on navigation. Adjusting state during render (rather
  // than in an effect) per the documented "store prevProp, compare, adjust"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // avoids the extra commit + flash-open a post-navigation effect would cause.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setDrawerOpen(false);
  }

  const withRange = (h: string) => (range ? `${h}?range=${range}` : h);
  const moreActive = drawerItems.some((m) => m.href === pathname);

  return (
    <>
      {drawerOpen && (
        <>
          <div
            className="bn-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="bn-drawer" role="dialog" aria-label="More navigation">
            <div className="bn-drawer-handle" />
            {drawerItems.map((m) => {
              const Icon = NAV_ICONS[m.icon];
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  className={`bn-drawer-link ${pathname === m.href ? "active" : ""}`}
                  onClick={() => setDrawerOpen(false)}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden />
                  {m.label}
                </Link>
              );
            })}
          </div>
        </>
      )}

      <nav className="bottom-nav" aria-label="Primary navigation">
        <div className="bn-tabs">
          {tabs.map((t) => {
            const Icon = NAV_ICONS[t.icon];
            return (
              <Link
                key={t.href}
                href={withRange(t.href)}
                className={`bn-tab ${pathname === t.href ? "active" : ""}`}
              >
                <Icon size={20} strokeWidth={1.8} aria-hidden />
                {t.label}
              </Link>
            );
          })}
          {(() => {
            const MenuIcon = NAV_ICONS.menu;
            return (
              <button
                type="button"
                className={`bn-tab ${moreActive || drawerOpen ? "active" : ""}`}
                onClick={() => setDrawerOpen((v) => !v)}
                aria-expanded={drawerOpen}
                aria-haspopup="dialog"
              >
                <MenuIcon size={20} strokeWidth={1.8} aria-hidden />
                More
              </button>
            );
          })()}
        </div>
      </nav>
    </>
  );
}
