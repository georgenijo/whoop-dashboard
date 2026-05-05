import type { Metadata, Viewport } from "next";
import { after } from "next/server";
import { headers, cookies } from "next/headers";
import { Suspense } from "react";
import { Geist, Geist_Mono, Playfair_Display, Inter_Tight } from "next/font/google";
import Sidebar from "@/components/chrome/Sidebar";
import TopBar from "@/components/chrome/TopBar";
import BottomNav from "@/components/chrome/BottomNav";
import { addRouteLog } from "@/lib/db";
import { getThemeCookie } from "./theme-cookie";
import "./globals.css";

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

const playfair = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
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
  const cookieStore = await cookies();
  const theme = getThemeCookie(cookieStore);
  const isAtelier = theme === "atelier";

  const requestHeaders = await headers();
  const route = requestHeaders.get("x-whoop-route-log-route");
  const startedAt = requestHeaders.get("x-whoop-route-log-started-at");
  const startMs = Number(requestHeaders.get("x-whoop-route-log-start-ms"));
  const details = requestHeaders.get("x-whoop-route-log-details");

  if (route && startedAt && Number.isFinite(startMs)) {
    after(() => {
      try {
        addRouteLog({
          started_at: startedAt,
          route,
          duration_ms: Math.max(0, Date.now() - startMs),
          status: 200,
          details,
        });
      } catch {
        // Route timing must never affect the rendered page.
      }
    });
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${interTight.variable}`}
      data-theme={isAtelier ? "atelier" : undefined}
      style={{ colorScheme: isAtelier ? "light" : "dark" }}
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
