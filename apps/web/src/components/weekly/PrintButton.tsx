"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      className="wr-print"
      onClick={() => window.print()}
      data-track="weekly:print"
    >
      Print
    </button>
  );
}
