export default function CoachLoading() {
  return (
    <section className="animate-pulse" aria-label="Loading Coach" aria-busy="true">
      <div className="card min-h-96 bg-white/[0.03]">
        <div className="h-4 w-24 rounded bg-white/10" />
        <div className="mt-8 space-y-4">
          <div className="h-16 w-3/4 rounded bg-white/[0.06]" />
          <div className="ml-auto h-12 w-2/3 rounded bg-white/[0.06]" />
          <div className="h-16 w-4/5 rounded bg-white/[0.06]" />
        </div>
      </div>
      <div className="mt-4 h-12 rounded bg-white/[0.05]" />
    </section>
  );
}
