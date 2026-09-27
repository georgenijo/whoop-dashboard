import SwiftUI

enum TrendsRoute: Hashable {
    case recovery(DateRange, RecoveryView.Focus)
    case sleep(DateRange)
    case strain(DateRange)
    case steps(DateRange)
    case workouts(DateRange)
}

/// One scrolling instrument panel: every key series readable in place, one
/// range control driving all of it, each card opening its detail page at the
/// same range.
struct TrendsView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var recovery = TrendsCardState<RecoveryPayload>()
    @State private var sleep = TrendsCardState<SleepPayload>()
    @State private var strain = TrendsCardState<StrainPayload>()
    @State private var steps = TrendsCardState<StepsPayload>()
    @State private var workouts = TrendsCardState<WorkoutsPayload>()
    @State private var generations: [Card: Int] = [:]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Trends")
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        recoveryCards
                        sleepCard
                        strainCard
                        stepsCard
                        workoutsCard
                    }
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.top, Theme.Spacing.xs)
                    .padding(.bottom, Theme.Spacing.xl)
                    .animation(.snappy(duration: 0.3), value: range)
                }
                .scrollContentBackground(.hidden)
                .safeAreaInset(edge: .top, spacing: 0) {
                    TrendsRangeBar(range: $range)
                }
                .refreshable { await loadAll() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: TrendsRoute.self) { route in
                destination(route)
            }
            .task(id: range) { await loadAll() }
        }
    }

    @ViewBuilder
    private var recoveryCards: some View {
        switch recovery.phase {
        case .loading:
            TrendsChartPlaceholder(title: "Recovery", chartHeight: 120)
            TrendsChartPlaceholder(title: "HRV", chartHeight: 120)
            TrendsChartPlaceholder(title: "Resting heart rate", chartHeight: 120)
        case .failed(let message):
            TrendsErrorCard(title: "Recovery", message: message) {
                Task { await load(.recovery, $recovery, range: range) { try await RecoveryService(api: api).load(range: $0) } }
            }
        case .loaded(let p):
            let today = p.kpi.first { $0.key == .recovery }
            link(.recovery(range, .score)) {
                TrendsHubCard(title: "Recovery", unit: "%", accent: Theme.Palette.recovery,
                              points: p.recoveryTrend, yDomain: 0 ... 100,
                              context: [today?.value.map { RecoveryZone(score: $0).label }, today?.delta?.label]) {
                    if let score = today?.value {
                        Text(RecoveryZone(score: score).label)
                            .font(Theme.FontStyle.mono(11, weight: .semibold))
                            .foregroundStyle(RecoveryZone(score: score).color)
                    }
                    TrendsDeltaLabel(delta: today?.delta)
                }
            }
            let hrv = p.kpi.first { $0.key == .hrv }
            link(.recovery(range, .hrv)) {
                TrendsHubCard(title: "HRV", unit: "ms", accent: Theme.Palette.hrv,
                              points: p.hrvTrend.points,
                              markers: p.hrvTrend.anomalies.map { .init(date: $0.date, label: "") },
                              context: [hrv?.delta?.label, lowDays(p.hrvTrend.anomalies.count)]) {
                    TrendsDeltaLabel(delta: hrv?.delta)
                    if let low = lowDays(p.hrvTrend.anomalies.count) {
                        Text(low)
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.danger)
                    }
                }
            }
            let rhr = p.kpi.first { $0.key == .rhr }
            link(.recovery(range, .rhr)) {
                TrendsHubCard(title: "Resting heart rate", unit: "bpm", accent: Theme.Palette.rhr,
                              points: p.rhrTrend,
                              context: [rhr?.delta?.label]) {
                    TrendsDeltaLabel(delta: rhr?.delta)
                }
            }
        }
    }

    @ViewBuilder
    private var sleepCard: some View {
        switch sleep.phase {
        case .loading:
            TrendsChartPlaceholder(title: "Sleep", chartHeight: 120)
        case .failed(let message):
            TrendsErrorCard(title: "Sleep", message: message) {
                Task { await load(.sleep, $sleep, range: range) { try await SleepService(api: api).load(range: $0) } }
            }
        case .loaded(let p):
            let tile = p.kpi.first { $0.key == .sleep }
            let performance = p.performanceTrend.last(where: { $0.raw != nil })?.raw
            link(.sleep(range)) {
                TrendsHubCard(title: "Sleep", unit: "", accent: Theme.Palette.sleepDeep,
                              points: p.durationTrend.map { TrendPoint(date: $0.date, raw: $0.rawHours, ma7: $0.ma7, ma30: nil) },
                              style: .bars,
                              format: { TrendsFormat.hoursMinutes(hours: $0) },
                              context: [tile?.delta?.label, performance.map { "Performance \(Int($0.rounded()))%" }]) {
                    TrendsDeltaLabel(delta: tile?.delta)
                    if let performance {
                        Text("Performance \(Int(performance.rounded()))%")
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg2)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var strainCard: some View {
        switch strain.phase {
        case .loading:
            TrendsChartPlaceholder(title: "Strain", chartHeight: 120)
        case .failed(let message):
            TrendsErrorCard(title: "Strain", message: message) {
                Task { await load(.strain, $strain, range: range) { try await StrainService(api: api).load(range: $0) } }
            }
        case .loaded(let p):
            let tile = p.kpi.first { $0.key == .strain }
            let kcal = p.today.totalKcal.map { kcalLabel($0, dateKey: p.today.date) }
            link(.strain(range)) {
                TrendsHubCard(title: "Strain", unit: "", accent: Theme.Palette.strain,
                              points: p.strainTrend, style: .bars, precision: 1,
                              context: [tile?.delta?.label, kcal]) {
                    TrendsDeltaLabel(delta: tile?.delta)
                    if let kcal {
                        Text(kcal)
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg2)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var stepsCard: some View {
        switch steps.phase {
        case .loading:
            TrendsChartPlaceholder(title: "Steps", chartHeight: 120)
        case .failed(let message):
            TrendsErrorCard(title: "Steps", message: message) {
                Task { await load(.steps, $steps, range: range) { try await StepsService(api: api).load(range: $0) } }
            }
        case .loaded(let p):
            let tile = p.kpi.first { $0.key == .steps }
            let avg = TrendsStats.recentAverage(p.stepsTrend).map { "7-day avg \($0.formatted(.number.precision(.fractionLength(0))))" }
            link(.steps(range)) {
                TrendsHubCard(title: "Steps", unit: "", accent: Theme.Palette.info,
                              points: p.stepsTrend, style: .bars,
                              context: [tile?.delta?.label, avg]) {
                    TrendsDeltaLabel(delta: tile?.delta)
                    if let avg {
                        Text(avg)
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg2)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var workoutsCard: some View {
        switch workouts.phase {
        case .loading:
            TrendsChartPlaceholder(title: "Workouts", chartHeight: 40)
        case .failed(let message):
            TrendsErrorCard(title: "Workouts", message: message) {
                Task { await load(.workouts, $workouts, range: range) { try await WorkoutsService(api: api).load(range: $0) } }
            }
        case .loaded(let p):
            link(.workouts(range)) {
                WorkoutsSummaryCard(payload: p)
            }
        }
    }

    private func link<Label: View>(_ route: TrendsRoute, @ViewBuilder label: () -> Label) -> some View {
        NavigationLink(value: route) {
            label()
        }
        .buttonStyle(TrendsCardPressStyle())
        .accessibilityHint("Opens details")
    }

    @ViewBuilder
    private func destination(_ route: TrendsRoute) -> some View {
        switch route {
        case .recovery(let r, let focus): RecoveryView(initialRange: r, focus: focus)
        case .sleep(let r): SleepView(initialRange: r)
        case .strain(let r): StrainView(initialRange: r)
        case .steps(let r): StepsView(initialRange: r)
        case .workouts(let r): WorkoutsView(initialRange: r)
        }
    }

    // MARK: Loading

    private func loadAll() async {
        let range = range
        let api = api
        async let r: Void = load(.recovery, $recovery, range: range) { try await RecoveryService(api: api).load(range: $0) }
        async let s: Void = load(.sleep, $sleep, range: range) { try await SleepService(api: api).load(range: $0) }
        async let st: Void = load(.strain, $strain, range: range) { try await StrainService(api: api).load(range: $0) }
        async let sp: Void = load(.steps, $steps, range: range) { try await StepsService(api: api).load(range: $0) }
        async let w: Void = load(.workouts, $workouts, range: range) { try await WorkoutsService(api: api).load(range: $0) }
        _ = await (r, s, st, sp, w)
    }

    /// Each card owns its own state: one slow or failing endpoint never blanks
    /// the rest. Per-card generations mean only the newest request for a card
    /// may commit. `TrendsCardState` keeps old data only for a same-range
    /// refresh failure; a failed range change shows the card's Retry state so
    /// the hub never silently mixes ranges.
    @MainActor
    private func load<T>(_ key: Card, _ state: Binding<TrendsCardState<T>>, range: DateRange,
                         _ fetch: @escaping (DateRange) async throws -> T) async {
        let generation = (generations[key] ?? 0) + 1
        generations[key] = generation
        state.wrappedValue.beginLoad()
        do {
            let value = try await fetch(range)
            guard generations[key] == generation else { return }
            state.wrappedValue.succeed(value, range: range)
        } catch {
            guard generations[key] == generation, !Task.isCancelled else { return }
            state.wrappedValue.fail(TrendsLoadError.describe(error), range: range)
        }
    }

    private func lowDays(_ n: Int) -> String? {
        n == 0 ? nil : "\(n) low day\(n == 1 ? "" : "s")"
    }

    private func kcalLabel(_ kcal: Double, dateKey: String) -> String {
        let fresh = TrendsStats.freshness(dateKey: dateKey)
        let when = fresh == "Today" ? "today" : "on \(TrendsFormat.day(dateKey))"
        return "\(Int(kcal.rounded())) kcal \(when)"
    }

    private enum Card: Hashable { case recovery, sleep, strain, steps, workouts }
}

#Preview {
    TrendsView()
        .preferredColorScheme(.dark)
}
