"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 5_000;
const MAX_REFRESH_ATTEMPTS = 60;

export default function AIInsightRefreshWatcher() {
  const router = useRouter();

  useEffect(() => {
    let refreshCount = 0;
    const interval = window.setInterval(() => {
      refreshCount += 1;
      router.refresh();
      if (refreshCount >= MAX_REFRESH_ATTEMPTS) {
        window.clearInterval(interval);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}
