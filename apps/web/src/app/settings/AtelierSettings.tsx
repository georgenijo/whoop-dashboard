"use client";

import type { Theme } from "@/app/theme-cookie";
import ThemeStage from "@/components/settings/atelier/ThemeStage";
import SyncSection from "@/components/settings/atelier/SyncSection";
import CoachSection from "@/components/settings/atelier/CoachSection";

function PlaceholderSection({ roman, title, copy }: { roman: string; title: string; copy: string }) {
  return (
    <section className="atelier-placeholder-section">
      <div className="atelier-sec-rule">
        <span className="atelier-sec-roman">{roman}</span>
        <span className="atelier-sec-title">{title}</span>
      </div>
      <div className="atelier-placeholder-card">
        <span className="atelier-placeholder-dash">—</span>
        <span className="atelier-placeholder-copy">{copy}</span>
      </div>
    </section>
  );
}

type Props = { initialTheme: Theme };

export default function AtelierSettings({ initialTheme }: Props) {
  return (
    <div className="atelier-settings-shell">
      <h1 className="atelier-settings-title">
        Settings, <em>calibrated by hand</em>.
      </h1>
      <ThemeStage initialTheme={initialTheme} />
      <SyncSection />
      <CoachSection />
      <PlaceholderSection roman="IV." title="Notifications" copy="Push channels — coming soon." />
      <PlaceholderSection roman="V." title="Account" copy="Multi-user is on the roadmap." />
    </div>
  );
}
