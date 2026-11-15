import SwiftUI

struct SleepView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange
    @State private var state = TrendsCardState<SleepPayload>()
    /// Bumped by every load (range change, pull-to-refresh, Retry); only the
    /// newest request may commit, so an older refresh can't overwrite a new range.
    @State private var loadGeneration = 0
    /// Fixed 30-day payload for the performance baseline, fetched only when the
    /// range picker is narrower than 30 days.
    @State private var baseline: SleepPayload?

    init(initialRange: DateRange = .d30) {
        _range = State(initialValue: initialRange)
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) { TrendsRangeBar(range: $range, caption: headerCaption) }
            .navigationTitle("Sleep")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        NotificationCenter.default.post(name: .coachComposeRequested, object: "How did I sleep last night, and what would help me sleep better tonight?")
                    } label: {
                        Label("Ask Coach", systemImage: "bubble.left")
                            .labelStyle(.iconOnly)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .task(id: range) { await load() }
            .refreshable { await load() }
    }

    private var headerCaption: String? {
        guard let latest = state.value?.latestSleep else { return nil }
        return "\(TrendsFormat.day(latest.date)) · main sleep"
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
                // Inner display: last night beside need and performance.
                FoldColumns {
                    LedgerGroup {
                        SleepHeroCard(latest: payload.latestSleep)
                        if let stages = payload.latestSleep?.stages {
                            LedgerRule()
                            SleepStageBarView(stages: stages, embedded: true)
                        }
                        SleepPerformanceCard(
                            payload: payload,
                            baselineTrend: SleepLogic.baselineTrend(rangeDays: state.loadedRange?.days, current: payload.performanceTrend, fetched: baseline?.performanceTrend))
                    }
                } trailing: {
                    LedgerGroup {
                        MetricChart(
                            title: "Time in bed",
                            unit: "",
                            accent: Theme.Palette.sleepDeep,
                            points: payload.durationTrend.map { TrendPoint(date: $0.date, raw: $0.rawHours, ma7: $0.ma7, ma30: nil) },
                            style: .bars,
                            height: 150,
                            subtitle: "\(range.days) days",
                            showsLegend: false,
                            format: { TrendsFormat.hoursMinutes(hours: $0) }
                        )
                        .padding(Theme.Spacing.md)
                        LedgerRule()
                        MetricChart(
                            title: "Sleep performance",
                            unit: "%",
                            accent: Theme.Palette.sleepDeep,
                            points: payload.performanceTrend,
                            height: 150,
                            subtitle: "\(range.days) days",
                            showsLegend: false
                        )
                        .padding(Theme.Spacing.md)
                        if let need = payload.latestSleep?.needBreakdown {
                            LedgerRule()
                            SleepNeedBreakdownView(need: need, embedded: true)
                        }
                    }
                }
                .padding(Theme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
            .measuresFold()
        }
    }

    @MainActor
    private func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        let range = range
        state.beginLoad()
        do {
            // The 30-day baseline is refreshed together with the current
            // readings, so pull-to-refresh and Retry recover it too.
            let api = api
            async let base: SleepPayload? = range.days < SleepLogic.baselineDays ? try? SleepService(api: api).load(range: .d30) : nil
            let payload = try await SleepService(api: api).load(range: range)
            let fetchedBaseline = await base
            guard generation == loadGeneration else { return }
            if range.days >= SleepLogic.baselineDays {
                baseline = nil
            } else if let fetchedBaseline {
                baseline = fetchedBaseline
            }
            state.succeed(payload, range: range)
        } catch {
            guard generation == loadGeneration, !Task.isCancelled else { return }
            state.fail(TrendsLoadError.describe(error), range: range)
        }
    }
}

enum SleepLogic {
    static let baselineDays = 30

    /// Performance history a 30-day average may use: the current series when
    /// the range spans 30 days, otherwise the separately fetched one.
    static func baselineTrend(rangeDays: Int?, current: [TrendPoint], fetched: [TrendPoint]?) -> [TrendPoint]? {
        guard let rangeDays else { return nil }
        return rangeDays >= baselineDays ? current : fetched
    }

    static func asleepMs(_ stages: SleepPayload.LatestSleep.Stages) -> Double {
        stages.lightMs + stages.deepMs + stages.remMs
    }

    static func inBedMs(_ stages: SleepPayload.LatestSleep.Stages) -> Double {
        asleepMs(stages) + stages.awakeMs
    }

    /// Time asleep divided by time in bed, as a whole percent.
    static func efficiencyPercent(_ stages: SleepPayload.LatestSleep.Stages) -> Int? {
        let inBed = inBedMs(stages)
        guard inBed > 0 else { return nil }
        return Int((asleepMs(stages) / inBed * 100).rounded())
    }
}

/// Last night: one measure, time asleep, against what the night needed.
private struct SleepHeroCard: View {
    let latest: SleepPayload.LatestSleep?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("Last night")
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                Spacer()
                Text("Time asleep")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            if let stages = latest?.stages {
                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 10))
                layout {
                    Text(TrendsFormat.hoursMinutes(ms: SleepLogic.asleepMs(stages)))
                        .font(Theme.FontStyle.display(56, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if let need = latest?.needBreakdown {
                        Text("of \(TrendsFormat.hoursMinutes(ms: SleepNeedBreakdownView.total(need))) needed")
                            .font(Theme.FontStyle.sans(17))
                            .foregroundStyle(Theme.Palette.fg2)
                    }
                }
                HStack(alignment: .top, spacing: 0) {
                    fact("In bed", TrendsFormat.hoursMinutes(ms: SleepLogic.inBedMs(stages)))
                    if let efficiency = SleepLogic.efficiencyPercent(stages) {
                        fact("Efficiency", "\(efficiency)%", note: "asleep ÷ in bed")
                    }
                }
                .padding(.top, Theme.Spacing.xs)
            } else {
                Text("Sleep stages aren’t available for this night.")
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
            }
        }
        .padding(Theme.Spacing.lg)
        .accessibilityElement(children: .contain)
    }

    private func fact(_ label: String, _ value: String, note: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(Theme.FontStyle.sans(13))
                .foregroundStyle(Theme.Palette.fg2)
            Text(value)
                .font(Theme.FontStyle.mono(22, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
            if let note {
                Text(note)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// One performance number that defines itself, so it isn't confused with
/// "need met" or efficiency.
private struct SleepPerformanceCard: View {
    let payload: SleepPayload
    let baselineTrend: [TrendPoint]?

    private var latest: Double? { payload.performanceTrend.last(where: { $0.raw != nil })?.raw }

    var body: some View {
        if let latest {
            VStack(alignment: .leading, spacing: 0) {
                LedgerRule()
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("Sleep performance")
                            .font(Theme.FontStyle.sans(15, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        Text("time asleep ÷ sleep need")
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        HStack(alignment: .firstTextBaseline, spacing: 2) {
                            Text("\(Int(latest.rounded()))")
                                .font(Theme.FontStyle.mono(40, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg0)
                            Text("%")
                                .font(Theme.FontStyle.mono(15))
                                .foregroundStyle(Theme.Palette.fg2)
                        }
                        if let average = baselineTrend.flatMap({ RecoveryHeroView.thirtyDayAverage($0) }) {
                            Text("30-day average \(Int(average.rounded()))%")
                                .font(Theme.FontStyle.sans(15))
                                .foregroundStyle(Theme.Palette.fg2)
                        }
                    }
                }
                .padding(Theme.Spacing.lg)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

#Preview { NavigationStack { SleepView() } }
