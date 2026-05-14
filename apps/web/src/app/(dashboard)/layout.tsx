import type { Metadata, Viewport } from "next";
import { after } from "next/server";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/chrome/Sidebar";
import TopBar from "@/components/chrome/TopBar";
import BottomNav from "@/components/chrome/BottomNav";
import { addRouteLog } from "@/lib/db";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Whoop+ Dashboard",
  description:
    "Personal health command center — recovery, sleep, strain, and AI insight.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05050a",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Snapshot at the very top of the Server Component so the `render_ms`
  // figure captures wall-clock time inside React's render pass (between
  // layout entry and `after()` firing post-stream). This is distinct from
  // `duration_ms`, which includes the proxy-injected start time and
  // therefore covers a couple of extra ms of edge-runtime overhead.
  // Date.now() is "impure" by React's rules-of-purity rule, but the value
  // is consumed inside an `after()` post-response hook (not in rendered
  // output), so a re-render with a different value would have no visible
  // effect — it only changes one logged number.
  // eslint-disable-next-line react-hooks/purity
  const layoutStartMs = Date.now();
  const requestHeaders = await headers();
  const route = requestHeaders.get("x-whoop-route-log-route");
  const startedAt = requestHeaders.get("x-whoop-route-log-started-at");
  const startMs = Number(requestHeaders.get("x-whoop-route-log-start-ms"));
  const details = requestHeaders.get("x-whoop-route-log-details");

  if (route && startedAt && Number.isFinite(startMs)) {
    after(() => {
      try {
        const now = Date.now();
        const renderMs = Math.max(0, now - layoutStartMs);
        // `server_timing` is JSON so it stays cheap to extend later (db_ms,
        // stream_ms, etc.). For now we just capture the render-pass figure
        // — it's what /logs can render today.
        const serverTiming = JSON.stringify({ render_ms: renderMs });
        addRouteLog({
          started_at: startedAt,
          route,
          duration_ms: Math.max(0, now - startMs),
          status: 200,
          details,
          // `response_bytes` stays NULL: Next.js 16's `after()` runs after
          // the streamed response is closed and the framework does not
          // expose the rendered byte count to user code. Documented trim.
          response_bytes: null,
          server_timing: serverTiming,
          // No ISR / CDN cache layer in front of these dynamic dashboard
          // routes; emit a stable marker so the column has signal when a
          // future caching experiment lights it up.
          cache_status: "none",
          render_ms: renderMs,
        });
      } catch {
        // Route timing must never affect the rendered page.
      }
    });
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{ colorScheme: "dark" }}
    >
      <body>
        <div className="aurora" aria-hidden />
        <div className="app">
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
          <main className="main">
            <Suspense fallback={null}>
              <TopBar />
            </Suspense>
            <div className="content">{children}</div>
          </main>
        </div>
        <Suspense fallback={null}>
          <BottomNav />
        </Suspense>
      </body>
    </html>
  );
}
