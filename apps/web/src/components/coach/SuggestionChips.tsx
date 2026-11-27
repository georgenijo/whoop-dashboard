"use client";

import type { CSSProperties } from "react";
import { Activity, Flame, HeartPulse, MessageCircle, Moon, type LucideIcon } from "lucide-react";
import {
  coachSuggestions,
  type CoachSuggestionContext,
  type CoachSuggestionKind,
} from "@/lib/coach/suggestions";

const KIND_STYLE: Record<CoachSuggestionKind, { icon: LucideIcon; accent: string }> = {
  recovery: { icon: HeartPulse, accent: "var(--d-recovery)" },
  sleep: { icon: Moon, accent: "var(--d-sleep)" },
  strain: { icon: Flame, accent: "var(--d-strain)" },
  hrv: { icon: Activity, accent: "var(--d-hrv)" },
  general: { icon: MessageCircle, accent: "var(--fg-2)" },
};

export default function SuggestionChips({
  onSelect,
  disabled = false,
  context,
}: {
  onSelect: (text: string) => void;
  disabled?: boolean;
  /** What data the user has today; prompts adapt to it. */
  context?: CoachSuggestionContext;
}) {
  return (
    <div className="coach-suggestions">
      {coachSuggestions(context).map(({ text, hint, kind }, index) => {
        const { icon: Icon, accent } = KIND_STYLE[kind];
        return (
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
        );
      })}
    </div>
  );
}
