import SwiftUI

struct WorkoutsView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange
    @State private var phase: TrendsLoadable<WorkoutsPayload> = .loading
    /// Bumped by every load (range change, pull-to-refresh, Retry); only the
    /// newest request may commit, so an older refresh can't overwrite a new range.
    @State private var loadGeneration = 0

    init(initialRange: DateRange = .d30) {
        _range = State(initialValue: initialRange)
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) { TrendsRangeBar(range: $range) }
            .navigationTitle("Workouts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(.hidden, for: .navigationBar)
            .task(id: range) { await load() }
            .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            TrendsDetailLoading(titles: ["Sport breakdown", "Zone breakdown"])
        case .failed(let message):
            TrendsDetailError(title: "Workouts", message: message) { Task { await load() } }
        case .loaded(let payload):
            ScrollView {
                VStack(spacing: Theme.Spacing.sm) {
                    if payload.truncated {
                        HStack(spacing: 8) {
                            Image(systemName: "info.circle")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.Palette.warning)
                            Text("Showing the 500 most recent. Narrow the range to see fewer.")
                                .font(Theme.FontStyle.sans(13))
                                .foregroundStyle(Theme.Palette.fg2)
                            Spacer()
                        }
                        .padding(10)
                        .background(Theme.Palette.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.Palette.warning.opacity(0.22), lineWidth: 1))
                    }
                    SportFrequencyChartView(items: payload.sportFrequency)
                    WorkoutZoneChartView(rows: payload.zoneBreakdownRecent)
                    WorkoutDistanceChartView(rows: payload.distanceRecent)
                    WorkoutsTableView(workouts: payload.workouts)
                }
                .padding(Theme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
        }
    }

    @MainActor
    private func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        if case .failed = phase { phase = .loading }
        do {
            let payload = try await WorkoutsService(api: api).load(range: range)
            guard generation == loadGeneration else { return }
            phase = .loaded(payload)
        } catch {
            guard generation == loadGeneration, !Task.isCancelled, phase.value == nil else { return }
            phase = .failed(TrendsLoadError.describe(error))
        }
    }
}
