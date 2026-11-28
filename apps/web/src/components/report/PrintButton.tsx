"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      className="hr-print-btn"
      onClick={() => window.print()}
      data-track="report:print"
    >
      Print / Save as PDF
    </button>
  );
}
