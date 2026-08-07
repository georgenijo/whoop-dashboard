import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Welcome · Whoop+ Dashboard",
  description: "Set up your dashboard, coach, and Whoop connection.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "oklch(20% 0.004 70)",
};

// Separate root layout for the (onboarding) route group — mirrors (auth)/.
// Crossing into or out of this group triggers a full page reload (Next.js
// multi-root-layout behaviour), so wizard navigation that leaves /welcome
// uses `window.location.href` instead of `router.push`.
export default function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-design-system="quiet-instrument"
      data-theme="dark"
      data-density="comfortable"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{ colorScheme: "dark" }}
    >
      <body>{children}</body>
    </html>
  );
}
