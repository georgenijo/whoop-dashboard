import type { Metadata, Viewport } from "next";
import { after } from "next/server";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/chrome/Sidebar";
import TopBar from "@/components/chrome/TopBar";
import BottomNav from "@/components/chrome/BottomNav";
import ClientLogBootstrap from "@/components/ClientLogBootstrap";
import WebVitalsReporter from "@/components/WebVitalsReporter";
import ErrorBoundary from "@/components/ErrorBoundary";
import { addRouteLog } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import "../globals.css";
import "../../styles/quiet-instrument.css";

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
  title: "Coach",
  description:
    "Personal health data, training insight, and AI coaching.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "oklch(20% 0.004 70)",
};

// Plain (non-component, non-hook) helper so the render-timing math lives
// outside anything the react-hooks/purity rule treats as a component body.
// It's only ever invoked from inside `after()` (post-response), so calling
// Date.now() here can never be observed during render.
function logRouteRender(args: {
  userId: number;
  startedAt: string;
  route: string;
  startMs: number;
  details: string | null;
  layoutStartMs: number;
}) {
  try {
    const now = Date.now();
    const renderMs = Math.max(0, now - args.layoutStartMs);
    addRouteLog({
      user_id: args.userId,
      started_at: args.startedAt,
      route: args.route,
      duration_ms: Math.max(0, now - args.startMs),
      status: 200,
      details: args.details,
      // response_bytes stays NULL: Next.js 16's `after()` runs after the
      // streamed response is closed and exposes no rendered byte count.
      response_bytes: null,
      render_ms: renderMs,
    });
  } catch {
    // Route timing must never affect the rendered page.
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Date.now() here violates React purity, but the value is only consumed
  // inside `after()` (post-response), so a re-render can't observe drift.
  // eslint-disable-next-line react-hooks/purity
  const layoutStartMs = Date.now();
  const requestHeaders = await headers();

  // Every page in this route group requires a signed-in user. Pages also
  // call requireAuthOrSignin() themselves (defense in depth, left as-is) —
  // this layout-level check exists to close the gap for pages that don't
  // (e.g. settings/page.tsx, a "use client" component that can't call a
  // server-only auth helper directly) and covers any future page in the
  // group by default rather than opt-in.
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: requestHeaders }),
  );

  const route = requestHeaders.get("x-whoop-route-log-route");
  const startedAt = requestHeaders.get("x-whoop-route-log-started-at");
  const startMs = Number(requestHeaders.get("x-whoop-route-log-start-ms"));
  const details = requestHeaders.get("x-whoop-route-log-details");

  if (route && startedAt && Number.isFinite(startMs)) {
    // This layout requires auth above (redirects otherwise), so `user` is
    // always resolved by the time this fires.
    after(() =>
      logRouteRender({
        userId: user.id,
        startedAt,
        route,
        startMs,
        details,
        layoutStartMs,
      }),
    );
  }

  return (
    <html
      lang="en"
      data-design-system="quiet-instrument"
      data-theme="dark"
      data-density="comfortable"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{ colorScheme: "dark" }}
    >
      <body>
        <ClientLogBootstrap />
        <WebVitalsReporter />
        <div className="app">
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
          <main className="main">
            <Suspense fallback={null}>
              <TopBar />
            </Suspense>
            <div className="content">
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          </main>
        </div>
        <Suspense fallback={null}>
          <BottomNav />
        </Suspense>
      </body>
    </html>
  );
}
