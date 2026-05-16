"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { clog } from "@/lib/clog";

// Issue #389 — installs:
//   - window.onerror / unhandledrejection capture
//   - delegated click handler reading [data-track]
//   - pageview events on every route change
//
// Mounted once from the (dashboard)/layout.tsx so all dashboard pages and
// their client-component subtrees share the same listeners.

export default function ClientLogBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      clog.error(ev.message ?? "uncaught error", {
        src: ev.filename,
        line: ev.lineno,
        col: ev.colno,
        stack: ev.error instanceof Error ? ev.error.stack : undefined,
      });
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      let reasonDetail: unknown;
      if (reason instanceof Error) {
        reasonDetail = { message: reason.message, stack: reason.stack };
      } else if (typeof reason === "object" && reason !== null) {
        try {
          reasonDetail = JSON.parse(JSON.stringify(reason));
        } catch {
          reasonDetail = String(reason);
        }
      } else {
        reasonDetail = String(reason);
      }
      clog.error("unhandledrejection", { reason: reasonDetail });
    };
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest<HTMLElement>("[data-track]");
      if (!el) return;
      const track = el.getAttribute("data-track");
      if (!track) return;
      clog.event(
        "click",
        {
          track,
          tag: el.tagName.toLowerCase(),
          path: window.location.pathname,
        },
        `click:${track}`,
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    if (!pathname) return;
    clog.event("pageview", { path: pathname }, `pageview:${pathname}`);
  }, [pathname]);

  return null;
}
