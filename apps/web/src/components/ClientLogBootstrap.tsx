"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { clog } from "@/lib/clog";

// Issue #389 — installs:
//   - window.onerror / unhandledrejection capture
//   - delegated click handler reading [data-track]
//   - pageview events on every route change
//   - CSP violation capture (issue #501)
//
// Mounted once from the (dashboard)/layout.tsx so all dashboard pages and
// their client-component subtrees share the same listeners.

// Issue #501 — how CSP violations get collected, and why it is done this way.
//
// The app ships a report-only CSP. Report-only is worthless if nobody ever
// reads the reports, so violations have to land somewhere durable.
//
// The obvious mechanism, `report-uri` / `report-to`, needs an endpoint that
// accepts UNAUTHENTICATED POSTs — browsers strip credentials from violation
// reports. That would mean adding a path to AUTH_EXEMPT_PREFIXES in proxy.ts,
// which CLAUDE.md flags as a policy surface, and it would put an unauthorised
// write endpoint on the public internet for a single-user app.
//
// Instead we listen for the `securitypolicyviolation` DOM event and forward it
// through `/api/log/client`, which already exists, already requires auth,
// already rate-limits per user (10/s token bucket), and already surfaces on
// /logs. Zero new attack surface.
//
// The tradeoff, stated plainly: this only sees violations on pages where this
// component is mounted (the (dashboard) route group) and only where enough JS
// booted to attach the listener. It does not see violations on /signin, in the
// iOS app's web views, or on a page whose script-src blocked everything. For
// a single-user dashboard that is the right side of the trade; if the policy
// ever moves to enforcing on a multi-user deployment, revisit.
const CSP_REPORTS_PER_PAGE = 20;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

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

    // A single blocked resource inside a list or a re-rendering chart fires
    // this event once per attempt, so dedupe on (directive, blocked URI) and
    // hard-cap the total. Without both, one violation could burn the whole
    // per-user rate-limit budget and hide everything else.
    const seenViolations = new Set<string>();
    let violationCount = 0;
    const onCspViolation = (ev: SecurityPolicyViolationEvent) => {
      if (violationCount >= CSP_REPORTS_PER_PAGE) return;
      const directive = ev.effectiveDirective || ev.violatedDirective;
      const blockedUri = truncate(ev.blockedURI, 256);
      const key = `${directive}|${blockedUri}`;
      if (seenViolations.has(key)) return;
      seenViolations.add(key);
      violationCount += 1;
      clog.warn("csp-violation", {
        // `disposition` is "report" while the policy is report-only and
        // "enforce" once it flips — the single most useful field for knowing
        // whether a report means "would have broken" or "did break".
        disposition: ev.disposition,
        directive,
        blocked_uri: blockedUri,
        document_uri: truncate(ev.documentURI, 256),
        source_file: ev.sourceFile ? truncate(ev.sourceFile, 256) : undefined,
        line: ev.lineNumber || undefined,
        column: ev.columnNumber || undefined,
        // Only populated when the policy carries `report-sample`; capped hard
        // because it echoes page content back into the log.
        sample: ev.sample ? truncate(ev.sample, 120) : undefined,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("click", onClick, true);
    document.addEventListener("securitypolicyviolation", onCspViolation);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("securitypolicyviolation", onCspViolation);
    };
  }, []);

  useEffect(() => {
    if (!pathname) return;
    clog.event("pageview", { path: pathname }, `pageview:${pathname}`);
  }, [pathname]);

  return null;
}
