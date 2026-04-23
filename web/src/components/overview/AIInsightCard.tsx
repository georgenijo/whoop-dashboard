type Props = {
  hasData: boolean;
};

export default function AIInsightCard({ hasData }: Props) {
  return (
    <div className="ai-card" aria-label="AI insight">
      <div className="ai-head">
        <div className="ai-dot" aria-hidden />
        <span className="ai-tag">AI Insight</span>
        <span className="ai-when">Coming soon</span>
      </div>
      {hasData ? (
        <>
          <p>
            AI-generated daily insight will appear here in a future phase. The Streamlit app
            already generates insights via the Claude CLI — the port will re-use that pipeline
            and surface the output in this card.
          </p>
          <h3>What to expect</h3>
          <ul>
            <li>A short, clinical read on today&apos;s recovery, HRV, and sleep.</li>
            <li>Action items grounded in actual data points — no fluff.</li>
            <li>Flagged anomalies (e.g. RHR elevation, strain debt).</li>
          </ul>
        </>
      ) : (
        <>
          <p>
            Connect Whoop to unlock AI-generated insights about your recovery, sleep, and
            strain.
          </p>
          <h3>First sync</h3>
          <ul>
            <li>Authorize via Whoop OAuth.</li>
            <li>Daily sync populates the local database.</li>
            <li>Insights surface here after the Phase 2 AI integration.</li>
          </ul>
        </>
      )}
    </div>
  );
}
