"use client";

import type { CSSProperties } from "react";
import { Activity, Flame, HeartPulse, Moon, type LucideIcon } from "lucide-react";

const SUGGESTIONS: Array<{ text: string; hint: string; icon: LucideIcon; accent: string }> = [
  { text: "How is my recovery trending this week?", hint: "Recovery", icon: HeartPulse, accent: "var(--d-recovery)" },
  { text: "What does my sleep quality look like?", hint: "Sleep", icon: Moon, accent: "var(--d-sleep)" },
  { text: "Am I overtraining based on my strain?", hint: "Strain", icon: Flame, accent: "var(--d-strain)" },
  { text: "What should I focus on to improve HRV?", hint: "HRV", icon: Activity, accent: "var(--d-hrv)" },
];

export default function SuggestionChips({
  onSelect,
  disabled = false,
}: {
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="coach-suggestions">
      {SUGGESTIONS.map(({ text, hint, icon: Icon, accent }, index) => (
        <button
          key={text}
          type="button"
          className="coach-suggestion"
          style={{ "--metric-accent": accent, "--stagger": index } as CSSProperties}
          onClick={() => onSelect(text)}
          disabled={disabled}
        >
          <span className="coach-suggestion-icon" aria-hidden="true">
            <Icon size={15} strokeWidth={1.9} />
          </span>
          <span className="coach-suggestion-hint" aria-hidden="true">{hint}</span>
          <span className="coach-suggestion-text">{text}</span>
        </button>
      ))}
    </div>
  );
}
