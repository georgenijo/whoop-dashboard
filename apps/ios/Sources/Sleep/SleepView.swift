import SwiftUI

struct SleepView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange
    @State private var state = TrendsCardState<SleepPayload>()
    /// Bumped by every load (range change, pull-to-refresh, Retry); only the
    /// newest request may commit, so an older refresh can't overwrite a new range.
    @State private var loadGeneration = 0

    init(initialRange: DateRange = .d30) {
        _range = State(initialValue: initialRange)
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) { TrendsRangeBar(range: $range) }
            .navigationTitle("Sleep")
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
            TrendsDetailLoading(titles: ["Sleep", "Last night", "Sleep need"])
        case .failed(let message):
            TrendsDetailError(title: "Sleep", message: message) { Task { await load() } }
        case .loaded(let payload):
            ScrollView {
                VStack(spacing: Theme.Spacing.sm) {
                    SleepHeroCard(payload: payload)
                    if let latest = payload.latestSleep, let stages = latest.stages {
                        SleepStageDonutView(stages: stages, date: latest.date)
                    }
                    if let latest = payload.latestSleep, let need = latest.needBreakdown {
                        SleepNeedBreakdownView(need: need, asleepMs: latest.stages.map { $0.lightMs + $0.deepMs + $0.remMs })
                    }
                    TrendChartView(
                        title: "Sleep performance",
                        unit: "%",
                        colorHex: "#7b61ff",
                        points: payload.performanceTrend
                    )
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
            let payload = try await SleepService(api: api).load(range: range)
            guard generation == loadGeneration else { return }
            state.succeed(payload, range: range)
        } catch {
            guard generation == loadGeneration, !Task.isCancelled else { return }
            state.fail(TrendsLoadError.describe(error), range: range)
        }
    }
}

private struct SleepHeroCard: View {
    let payload: SleepPayload

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            MetricChart(
                title: "In bed",
                unit: "",
                accent: Theme.Palette.sleepDeep,
                points: payload.durationTrend.map { TrendPoint(date: $0.date, raw: $0.rawHours, ma7: $0.ma7, ma30: nil) },
                style: .bars,
                height: 190,
                format: { TrendsFormat.hoursMinutes(hours: $0) }
            )
            TrendsStatGrid(tiles: tiles)
                .padding(.top, Theme.Spacing.sm)
                .overlay(alignment: .top) {
                    Rectangle().fill(Theme.Palette.borderSubtle).frame(height: 1)
                }
        }
        .glassCard(tint: .sleep, padding: Theme.Spacing.md)
    }

    private var tiles: [TrendsStat] {
        let nights = payload.durationTrend.compactMap { p in p.rawHours.map { (date: p.date, hours: $0) } }
        let longest = nights.max { $0.hours < $1.hours }
        let full = nights.filter { $0.hours >= 7 }.count
        return [
            TrendsStat(
                id: "avg7",
                label: "7-day avg",
                value: payload.durationTrend.last(where: { $0.ma7 != nil })?.ma7.map { TrendsFormat.hoursMinutes(hours: $0) } ?? "—",
                caption: "rolling"
            ),
            TrendsStat(
                id: "long",
                label: "Longest",
                value: longest.map { TrendsFormat.hoursMinutes(hours: $0.hours) } ?? "—",
                caption: longest.map { TrendsFormat.day($0.date) }
            ),
            TrendsStat(
                id: "7h",
                label: "7h+ nights",
                value: nights.isEmpty ? "—" : "\(full)",
                caption: nights.isEmpty ? nil : "of \(nights.count)"
            )
        ]
    }
}

#Preview { NavigationStack { SleepView() } }
