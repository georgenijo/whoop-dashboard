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
            .safeAreaInset(edge: .top, spacing: 0) { TrendsRangeBar(range: $range, caption: headerCaption) }
            .navigationTitle("Recovery")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        NotificationCenter.default.post(name: .coachComposeRequested, object: "What moved my recovery today, and what should I do about it?")
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
        guard let payload = state.value else { return nil }
        return RecoveryLogic.caption(payload)
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
                    // Inner display: score and its drivers beside the signal trends.
                    FoldColumns {
                        LedgerGroup {
                            RecoveryHeroCard(payload: payload)
                                .id(Focus.score)
                            LedgerRule()
                            RecoveryFactorsCardView(factors: RecoveryLogic.factors(payload), embedded: true)
                        }
                    } trailing: {
                        LedgerGroup {
                            RecoverySeriesCard(title: "Recovery", unit: "%", accent: Theme.Palette.recovery,
                                               points: payload.recoveryTrend, days: range.days, yDomain: 0 ... 100,
                                               showsZoneBands: true, embedded: true)
                            LedgerRule()
                            HRVTrendCardView(trend: payload.hrvTrend, days: range.days, embedded: true)
                                .id(Focus.hrv)
                            LedgerRule()
                            RecoverySeriesCard(title: "Resting heart rate", unit: "bpm", accent: Theme.Palette.rhr,
                                               points: payload.rhrTrend, days: range.days, embedded: true)
                                .id(Focus.rhr)
                            if let spo2 = payload.spo2Trend {
                                LedgerRule()
                                Spo2TrendCardView(trend: spo2, days: range.days, embedded: true)
                                    .id(Focus.spo2)
                            }
                        }
                    }
                    .padding(Theme.Spacing.md)
                }
                .scrollContentBackground(.hidden)
                .measuresFold()
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

/// Score first: the number, the zone in words, the difference from the
/// 30-day average, the scale, then guidance.
private struct RecoveryHeroCard: View {
    let payload: RecoveryPayload
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var today: KPITile? { payload.kpi.first { $0.key == .recovery } }
    private var latestDate: String? { payload.recoveryTrend.last(where: { $0.raw != nil })?.date }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text(TrendsStats.freshness(dateKey: latestDate))
                .font(Theme.FontStyle.sans(15, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
            if let score = today?.value {
                let zone = RecoveryZone(score: score)
                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Spacing.sm))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: Theme.Spacing.lg))
                layout {
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text("\(Int(score.rounded()))")
                            .font(Theme.FontStyle.mono(56, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        Text("%")
                            .font(Theme.FontStyle.sans(18))
                            .foregroundStyle(Theme.Palette.fg2)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Rectangle().fill(zone.color).frame(width: 10, height: 10)
                                .accessibilityHidden(true)
                            Text(zone.bandName)
                                .font(Theme.FontStyle.sans(20, weight: .semibold))
                                .foregroundStyle(zone.color)
                        }
                        if let baseline = RecoveryHeroView.thirtyDayAverage(payload.recoveryTrend) {
                            let text = RecoveryHeroView.baselineText(score: score, baseline: baseline)
                            (Text(text.delta).font(Theme.FontStyle.mono(15, weight: .medium)).foregroundColor(Theme.Palette.fg0)
                                + Text(" " + text.rest).font(Theme.FontStyle.sans(15)).foregroundColor(Theme.Palette.fg2))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                ZoneScale(score: score)
                Text(zone.guidance)
                    .font(Theme.FontStyle.sans(17))
                    .foregroundStyle(Theme.Palette.fg1)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No recovery score yet.")
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
            }
        }
        .padding(Theme.Spacing.lg)
        .accessibilityElement(children: .combine)
    }
}

enum RecoveryLogic {
    /// "Sat, Nov 14 · after 5h 18m asleep" from the latest recovery day and the
    /// sleep tile, when both exist.
    static func caption(_ payload: RecoveryPayload) -> String? {
        guard let date = payload.recoveryTrend.last(where: { $0.raw != nil })?.date else { return nil }
        var parts = [TrendsFormat.day(date)]
        if let hours = payload.kpi.first(where: { $0.key == .sleep })?.value {
            parts.append("after \(TrendsFormat.hoursMinutes(hours: hours)) asleep")
        }
        return parts.joined(separator: " · ")
    }

    static func factors(_ payload: RecoveryPayload) -> [RecoveryFactorsCardView.Factor] {
        let averages: [KPITile.Key: [TrendPoint]] = [
            .hrv: payload.hrvTrend.points,
            .rhr: payload.rhrTrend,
            .spo2: (payload.spo2Trend?.points ?? []).map { TrendPoint(date: $0.date, raw: $0.value, ma7: nil, ma30: nil) }
        ]
        return payload.kpi.filter { $0.key != .recovery }.map { tile in
            let value: String
            var unit = tile.unit
            if let v = tile.value {
                if tile.key == .sleep {
                    value = TrendsFormat.hoursMinutes(hours: v)
                    unit = ""
                } else {
                    value = v.formatted(.number.precision(.fractionLength(tile.precision)))
                }
            } else {
                value = "—"
                unit = ""
            }
            let average = averages[tile.key].flatMap { RecoveryHeroView.thirtyDayAverage($0) }
                .map { $0.formatted(.number.precision(.fractionLength(tile.precision))) }
            return .init(
                label: displayLabel(tile),
                value: value,
                delta: tile.delta.map { KPIDeltaText($0).amount },
                direction: .init(api: tile.delta?.dir),
                color: tile.key.accent,
                unit: unit,
                average: average
            )
        }
    }

    private static func displayLabel(_ tile: KPITile) -> String {
        switch tile.key {
        case .rhr: return "Resting HR"
        case .spo2: return "SpO₂"
        default: return tile.label
        }
    }
}

#Preview { NavigationStack { RecoveryView() } }
