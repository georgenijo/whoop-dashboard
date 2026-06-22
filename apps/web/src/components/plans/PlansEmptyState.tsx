import Link from "next/link";

// Shown when the user has no saved plans. Points them at the Coach, which is
// the only author of plans in v1 (no hand-editing in the UI).
export default function PlansEmptyState() {
  return (
    <div className="card">
      <div className="empty-state">
        <div className="title">No plans yet</div>
        <div className="sub">
          Ask the Coach to build you a recovery-tuned training plan — it&apos;ll
          show up here.
        </div>
        <Link href="/coach" className="cta" data-track="nav:/coach">
          Open the Coach
        </Link>
      </div>
    </div>
  );
}
