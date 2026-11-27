// Coach empty-state prompts, chosen from what data the user has today
// (issue #593). Pure and client-safe; the server builds the context
// (`suggestion-context.ts`) and the page hands it to `SuggestionChips`.

export type CoachSuggestionContext = {
  /** Last night's sleep (wake day = today) is scored. */
  sleepScored: boolean;
  /** Today's recovery is scored. */
  recoveryScored: boolean;
  /** Workouts logged today. */
  workoutsToday: number;
  /** Any recovery or sleep history at all. */
  hasHistory: boolean;
};

export type CoachSuggestionKind = "recovery" | "sleep" | "strain" | "hrv" | "general";

export type CoachSuggestion = {
  text: string;
  hint: string;
  kind: CoachSuggestionKind;
};

/** Context-free fallback (and what an established user sees before today scores). */
export const DEFAULT_SUGGESTION_CONTEXT: CoachSuggestionContext = {
  sleepScored: false,
  recoveryScored: false,
  workoutsToday: 0,
  hasHistory: true,
};

export function coachSuggestions(
  context: CoachSuggestionContext = DEFAULT_SUGGESTION_CONTEXT,
): CoachSuggestion[] {
  if (!context.hasHistory) {
    return [
      { text: "What can you help me with once my Whoop data syncs?", hint: "Coach", kind: "general" },
      { text: "Which Whoop metrics should I pay attention to?", hint: "Basics", kind: "general" },
    ];
  }
  const suggestions: CoachSuggestion[] = [];
  suggestions.push(
    context.recoveryScored
      ? { text: "What's behind today's recovery score?", hint: "Recovery", kind: "recovery" }
      : { text: "How is my recovery trending this week?", hint: "Recovery", kind: "recovery" },
  );
  // Only ask about last night once it has actually been scored.
  if (context.sleepScored) {
    suggestions.push({ text: "How did I sleep last night?", hint: "Sleep", kind: "sleep" });
  }
  suggestions.push(
    context.workoutsToday > 0
      ? {
          text:
            context.workoutsToday === 1
              ? "How hard was today's workout?"
              : "How hard were today's workouts?",
          hint: "Strain",
          kind: "strain",
        }
      : { text: "Am I overtraining based on my strain?", hint: "Strain", kind: "strain" },
  );
  suggestions.push({ text: "What should I focus on to improve HRV?", hint: "HRV", kind: "hrv" });
  if (!context.sleepScored) {
    suggestions.push({ text: "How has my sleep been this week?", hint: "Sleep", kind: "sleep" });
  }
  return suggestions.slice(0, 4);
}
