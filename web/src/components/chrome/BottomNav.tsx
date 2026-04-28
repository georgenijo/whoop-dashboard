"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Item = { href: string; label: string; icon: string };

const tabs: Item[] = [
  { href: "/", label: "Overview", icon: "layout-dashboard" },
  { href: "/recovery", label: "Recovery", icon: "activity" },
  { href: "/sleep", label: "Sleep", icon: "moon" },
  { href: "/strain", label: "Strain", icon: "flame" },
  { href: "/workouts", label: "Workouts", icon: "dumbbell" },
];

const more: Item[] = [
  { href: "/coach", label: "Coach", icon: "sparkles" },
  { href: "/logs", label: "Logs", icon: "list" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

const moreHrefs = new Set(more.map((m) => m.href));

function icon(name: string) {
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
}

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
            {more.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className={`bn-drawer-link ${pathname === m.href ? "active" : ""}`}
                onClick={() => setDrawerOpen(false)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={icon(m.icon)} alt="" />
                {m.label}
              </Link>
            ))}
          </div>
        </>
      )}

      <nav className="bottom-nav" aria-label="Primary navigation">
        <div className="bn-tabs">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={withRange(t.href)}
              className={`bn-tab ${pathname === t.href ? "active" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon(t.icon)} alt="" />
              {t.label}
            </Link>
          ))}
          <button
            type="button"
            className={`bn-tab ${moreActive || drawerOpen ? "active" : ""}`}
            onClick={() => setDrawerOpen((v) => !v)}
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon("menu")} alt="" />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
