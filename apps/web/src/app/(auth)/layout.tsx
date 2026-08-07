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
  title: "Sign in · Whoop+ Dashboard",
  description:
    "Sign in to access your dashboard, coach, and connected services.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "oklch(20% 0.004 70)",
};

export default function AuthLayout({
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
