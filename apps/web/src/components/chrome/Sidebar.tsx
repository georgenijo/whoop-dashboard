"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

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
  const searchParams = useSearchParams();
  const range = searchParams.get("range");
  const withRange = (href: string) => (range ? `${href}?range=${range}` : href);
  const [needsReauth, setNeedsReauth] = useState(false);

  useEffect(() => {
    const fetchStatus = () => {
      fetch("/api/integrations/whoop/status")
        .then((r) => r.json())
        .then((d: { needs_reauth: boolean }) => setNeedsReauth(!!d.needs_reauth))
        .catch(() => {});
    };
    fetchStatus();
    window.addEventListener("focus", fetchStatus);
    return () => window.removeEventListener("focus", fetchStatus);
  }, []);

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
            href={withRange(n.href)}
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
            style={{ position: "relative" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon(n.icon)} alt="" />
            {n.label}
            {n.href === "/settings" && needsReauth && (
              <span
                aria-label="Whoop disconnected"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 10,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#ff4444",
                  boxShadow: "0 0 6px #ff4444",
                }}
              />
            )}
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
