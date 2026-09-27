import SwiftUI

struct StepsView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange
    @State private var state = TrendsCardState<StepsPayload>()
    /// Bumped by every load (range change, pull-to-refresh, Retry); only the
    /// newest request may commit, so an older refresh can't overwrite a new range.
    @State private var loadGeneration = 0

    init(initialRange: DateRange = .d30) {
        _range = State(initialValue: initialRange)
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) { TrendsRangeBar(range: $range) }
            .navigationTitle("Steps")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(.hidden, for: .navigationBar)
            .task(id: range) { await load() }
            .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            TrendsDetailLoading(titles: ["Steps"])
        case .failed(let message):
            TrendsDetailError(title: "Steps", message: message) { Task { await load() } }
        case .loaded(let payload):
            ScrollView {
                VStack(spacing: Theme.Spacing.sm) {
                    StepsHeroCard(payload: payload)
                    Text("Apple Health · synced by Coach iOS")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
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
        let range = range
        state.beginLoad()
        do {
            let payload = try await StepsService(api: api).load(range: range)
            guard generation == loadGeneration else { return }
            state.succeed(payload, range: range)
        } catch {
            guard generation == loadGeneration, !Task.isCancelled else { return }
            state.fail(TrendsLoadError.describe(error), range: range)
        }
    }
}

private struct StepsHeroCard: View {
    let payload: StepsPayload

    private var days: [(date: String, steps: Double)] {
        payload.stepsTrend.compactMap { p in p.raw.map { (p.date, $0) } }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            MetricChart(
                title: "Steps",
                unit: "",
                accent: Theme.Palette.info,
                points: payload.stepsTrend,
                style: .bars,
                height: 200
            )
            if payload.today.steps == nil {
                Text("No Apple Health steps synced for today yet.")
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
            }
            TrendsStatGrid(tiles: tiles, columns: 2)
                .padding(.top, Theme.Spacing.sm)
                .overlay(alignment: .top) {
                    Rectangle().fill(Theme.Palette.borderSubtle).frame(height: 1)
                }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private var tiles: [TrendsStat] {
        let values = days.map(\.steps)
        let best = days.max { $0.steps < $1.steps }
        let over10k = values.filter { $0 >= 10_000 }.count
        return [
            TrendsStat(id: "7d", label: "7-day avg", value: format(TrendsStats.recentAverage(payload.stepsTrend)),
                       caption: "rolling"),
            TrendsStat(id: "total", label: "Total", value: format(values.isEmpty ? nil : values.reduce(0, +)), caption: payload.rangeLabel),
            TrendsStat(id: "best", label: "Best day", value: format(best?.steps),
                       caption: best.map { TrendsFormat.day($0.date) }),
            TrendsStat(id: "10k", label: "10k+ days", value: values.isEmpty ? "—" : "\(over10k)",
                       caption: values.isEmpty ? nil : "of \(values.count) days")
        ]
    }

    private func format(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.number.precision(.fractionLength(0)))
    }
}

#Preview { NavigationStack { StepsView() } }
