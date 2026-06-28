"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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

const moreHrefs = new Set(more.map((m) => m.href));

export default function BottomNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const range = params.get("range");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const withRange = (h: string) => (range ? `${h}?range=${range}` : h);
  const moreActive = moreHrefs.has(pathname);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
            {more.map((m) => {
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
