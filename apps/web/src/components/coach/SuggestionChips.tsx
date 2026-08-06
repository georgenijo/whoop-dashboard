"use client";

const SUGGESTIONS = [
  "How is my recovery trending this week?",
  "What does my sleep quality look like?",
  "Am I overtraining based on my strain?",
  "What should I focus on to improve HRV?",
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
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className="coach-suggestion"
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
