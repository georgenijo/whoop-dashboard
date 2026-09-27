import SwiftUI

struct RecoveryView: View {
    enum Focus: Hashable { case score, hrv, rhr, spo2 }

    @Environment(\.api) private var api
    @State private var range: DateRange
    @State private var state = TrendsCardState<RecoveryPayload>()
    /// Bumped by every load (range change, pull-to-refresh, Retry); only the
    /// newest request may commit, so an older refresh can't overwrite a new range.
    @State private var loadGeneration = 0
    @State private var didFocus = false
    private let focus: Focus

    init(initialRange: DateRange = .d30, focus: Focus = .score) {
        _range = State(initialValue: initialRange)
        self.focus = focus
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) { TrendsRangeBar(range: $range) }
            .navigationTitle("Recovery")
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
            TrendsDetailLoading(titles: ["Recovery", "Latest signals", "HRV"])
        case .failed(let message):
            TrendsDetailError(title: "Recovery", message: message) { Task { await load() } }
        case .loaded(let payload):
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: Theme.Spacing.sm) {
                        RecoveryHeroCard(payload: payload)
                            .id(Focus.score)
                        RecoveryFactorsCardView(factors: payload.factors)
                        HRVTrendCardView(trend: payload.hrvTrend)
                            .id(Focus.hrv)
                        TrendChartView(
                            title: "Resting heart rate",
                            unit: "bpm",
                            colorHex: "#ff6b6b",
                            points: payload.rhrTrend
                        )
                        .id(Focus.rhr)
                        if let spo2 = payload.spo2Trend {
                            Spo2TrendCardView(trend: spo2)
                                .id(Focus.spo2)
                        }
                    }
                    .padding(Theme.Spacing.md)
                }
                .scrollContentBackground(.hidden)
                .task {
                    guard !didFocus else { return }
                    didFocus = true
                    guard focus != .score else { return }
                    try? await Task.sleep(for: .milliseconds(120))
                    withAnimation(.snappy) { proxy.scrollTo(focus, anchor: .top) }
                }
            }
        }
    }

    @MainActor
    private func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        let range = range
        state.beginLoad()
        do {
            let payload = try await RecoveryService(api: api).load(range: range)
            guard generation == loadGeneration else { return }
            state.succeed(payload, range: range)
        } catch {
            guard generation == loadGeneration, !Task.isCancelled else { return }
            state.fail(TrendsLoadError.describe(error), range: range)
        }
    }
}

/// The one place the recovery score appears: headline, zone, guidance, trend.
private struct RecoveryHeroCard: View {
    let payload: RecoveryPayload

    private var today: KPITile? { payload.kpi.first { $0.key == .recovery } }
    private var latestDate: String? { payload.recoveryTrend.last(where: { $0.raw != nil })?.date }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            MetricChart(
                title: "Recovery",
                unit: "%",
                accent: Theme.Palette.recovery,
                points: payload.recoveryTrend,
                yDomain: 0 ... 100,
                height: 190
            )
            if let score = today?.value {
                let zone = RecoveryZone(score: score)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: Theme.Spacing.xs) {
                        Circle()
                            .fill(zone.color)
                            .frame(width: 7, height: 7)
                        Text("\(TrendsStats.freshness(dateKey: latestDate)) · \(zone.label)")
                            .font(Theme.FontStyle.sans(15, weight: .semibold))
                            .foregroundStyle(zone.color)
                        Spacer(minLength: 0)
                        TrendsDeltaLabel(delta: today?.delta)
                    }
                    Text(zone.guidance)
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg1)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, Theme.Spacing.sm)
                .overlay(alignment: .top) {
                    Rectangle().fill(Theme.Palette.borderSubtle).frame(height: 1)
                }
            }
        }
        .glassCard(tint: .recovery, padding: Theme.Spacing.md)
    }
}

private extension RecoveryPayload {
    var factors: [RecoveryFactorsCardView.Factor] {
        kpi.filter { $0.key != .recovery }.map { tile in
            let direction = RecoveryFactorsCardView.Factor.Direction(api: tile.delta?.dir)
            let value: String = {
                guard let v = tile.value else { return "—" }
                if tile.key == .sleep { return TrendsFormat.hoursMinutes(hours: v) }
                let formatted = v.formatted(.number.precision(.fractionLength(tile.precision)))
                return tile.unit.isEmpty ? formatted : "\(formatted) \(tile.unit)"
            }()
            return .init(
                label: tile.label,
                value: value,
                delta: tile.delta?.label,
                direction: direction,
                color: Color(hex: tile.colorHex)
            )
        }
    }
}

#Preview { NavigationStack { RecoveryView() } }
