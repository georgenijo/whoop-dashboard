"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  { href: "/logs", label: "Logs", icon: "list" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function icon(name: string) {
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
}

export default function Sidebar() {
  const pathname = usePathname();

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
          <Link
            key={n.href}
            href={n.href}
            className={`sb-link ${pathname === n.href ? "active" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon(n.icon)} alt="" />
            {n.label}
          </Link>
        ))}
        <div className="sb-group-label">Intelligence</div>
        {secondary.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`sb-link ${pathname === n.href ? "active" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon(n.icon)} alt="" />
            {n.label}
          </Link>
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
