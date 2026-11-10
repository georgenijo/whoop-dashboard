export default function DashboardLoading() {
  return (
    <div className="animate-pulse" aria-label="Loading dashboard" aria-busy="true">
      <div className="hero">
        <div className="card min-h-48 bg-white/[0.03]">
          <div className="h-4 w-28 rounded bg-white/10" />
          <div className="mt-6 h-24 w-24 rounded-full border-8 border-white/10" />
        </div>
        <div className="ai-card">
          <div className="h-4 w-20 rounded bg-white/10" />
          <div className="mt-6 h-3 w-4/5 rounded bg-white/10" />
          <div className="mt-3 h-3 w-3/5 rounded bg-white/10" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="card h-24 bg-white/[0.03]" key={index} />
        ))}
      </div>
      <div className="mt-4 grid-main">
        <div className="col">
          <div className="card h-64 bg-white/[0.03]" />
          <div className="card h-36 bg-white/[0.03]" />
        </div>
      </div>
    </div>
  );
}
