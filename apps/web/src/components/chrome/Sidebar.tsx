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
];

const secondary: NavItem[] = [
  { href: "/coach", label: "Coach", icon: "sparkles" },
  { href: "/plans", label: "Plans", icon: "clipboard-list" },
  { href: "/logs", label: "Logs", icon: "list" },
  { href: "/perf", label: "Performance", icon: "gauge" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const range = searchParams.get("range");
  const withRange = (href: string) => (range ? `${href}?range=${range}` : href);

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
        {nav.map((n) => {
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
        {secondary.map((n) => {
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
