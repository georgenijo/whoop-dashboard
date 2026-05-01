"use client";

const SUGGESTIONS = [
  "How is my recovery trending this week?",
  "What does my sleep quality look like?",
  "Am I overtraining based on my strain?",
  "What should I focus on to improve HRV?",
];

export default function SuggestionChips({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <div className="coach-suggestions">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className="coach-suggestion"
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
