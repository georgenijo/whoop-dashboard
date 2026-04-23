import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/chrome/Sidebar";
import TopBar from "@/components/chrome/TopBar";
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

export const metadata: Metadata = {
  title: "Whoop+ Dashboard",
  description:
    "Personal health command center — recovery, sleep, strain, and AI insight.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{ colorScheme: "dark" }}
    >
      <body>
        <div className="aurora" aria-hidden />
        <div className="app">
          <Sidebar />
          <main className="main">
            <TopBar title="Overview" />
            <div className="content">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
