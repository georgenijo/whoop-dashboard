"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AIInsightRefreshWatcher() {
  const router = useRouter();

  useEffect(() => {
    let refreshCount = 0;
    const interval = window.setInterval(() => {
      refreshCount += 1;
      router.refresh();
      if (refreshCount >= 6) {
        window.clearInterval(interval);
      }
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}
