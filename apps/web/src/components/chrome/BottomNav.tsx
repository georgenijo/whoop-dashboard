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

// Added to the "More" drawer only when TRAINING_LOAD=1 (the layout passes `showTrainingLoad`).
const TRAINING_LOAD_ITEM: Item = { href: "/load", label: "Load", icon: "scale" };

// Added first in the "More" drawer only when SHARE_CARD=1 (the layout passes `showShareCard`).
const SHARE_CARD_ITEM: Item = { href: "/share/today", label: "Share today", icon: "share" };
// Added to the "More" drawer only when BASELINES_PAGE=1 (the layout passes `showBaselines`).
const BASELINES_ITEM: Item = { href: "/baselines", label: "Baselines", icon: "target" };

// Added before Logs in the "More" drawer only when DATA_HEALTH=1 (the layout passes `showDataHealth`).
const DATA_HEALTH_ITEM: Item = { href: "/data-health", label: "Data health", icon: "heart-pulse" };

// Shown only when the server passes `showReport` (HEALTH_REPORT=1).
const reportItem: Item = { href: "/report", label: "Health report", icon: "file-text" };

// Shown only when the server passes `showWeekly` (WEEKLY_REVIEW=1).
const weeklyItem: Item = { href: "/weekly", label: "Weekly review", icon: "calendar-days" };

// Shown in the More drawer only when the server passes `showAlerts` (HEALTH_ALERTS=1).
const ALERTS_ITEM: Item = { href: "/alerts", label: "Alerts", icon: "bell" };

// Default-off /compare entry (PERIOD_COMPARE=1); the server layout decides.
const compareItem: Item = { href: "/compare", label: "Compare", icon: "git-compare" };

// Added to the "More" drawer only when RECORDS_PAGE=1 (the layout passes `showRecords`).
const RECORDS_ITEM: Item = { href: "/records", label: "Records", icon: "trophy" };

// Added to the "More" drawer only when GOALS_PAGE=1 (the layout passes `showGoals`).
const GOALS_ITEM: Item = { href: "/goals", label: "Goals", icon: "flag" };

export default function BottomNav({
  showWeekly = false,
  compareEnabled = false,
  showRecords = false,
  showAlerts = false,
  showReport = false,
  showTrainingLoad = false,
  showDataHealth = false,
  showGoals = false,
  showShareCard = false,
  showBaselines = false,
}: {
  showWeekly?: boolean;
  compareEnabled?: boolean;
  showRecords?: boolean;
  showAlerts?: boolean;
  showReport?: boolean;
  showTrainingLoad?: boolean;
  showDataHealth?: boolean;
  showGoals?: boolean;
  showShareCard?: boolean;
  showBaselines?: boolean;
} = {}) {
  const moreItems = showDataHealth
    ? more.flatMap((m) => (m.href === "/logs" ? [DATA_HEALTH_ITEM, m] : [m]))
    : more;
  const drawerItems = [
    ...(showShareCard ? [SHARE_CARD_ITEM] : []),
    ...(showTrainingLoad ? [TRAINING_LOAD_ITEM] : []),
    ...(showBaselines ? [BASELINES_ITEM] : []),
    ...(showAlerts ? [ALERTS_ITEM] : []),
    ...(showRecords ? [RECORDS_ITEM] : []),
    ...(showGoals ? [GOALS_ITEM] : []),
    ...(showWeekly ? [weeklyItem] : []),
    ...(compareEnabled ? [compareItem] : []),
    ...(showReport ? [...moreItems.slice(0, -1), reportItem, ...moreItems.slice(-1)] : moreItems),
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
