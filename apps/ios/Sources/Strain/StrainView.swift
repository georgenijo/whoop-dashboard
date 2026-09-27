import SwiftUI

struct StrainView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange
    @State private var state = TrendsCardState<StrainPayload>()
    /// Bumped by every load (range change, pull-to-refresh, Retry); only the
    /// newest request may commit, so an older refresh can't overwrite a new range.
    @State private var loadGeneration = 0

    init(initialRange: DateRange = .d30) {
        _range = State(initialValue: initialRange)
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) { TrendsRangeBar(range: $range) }
            .navigationTitle("Strain")
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
            TrendsDetailLoading(titles: ["Strain", "Activity", "Avg heart rate"])
        case .failed(let message):
            TrendsDetailError(title: "Strain", message: message) { Task { await load() } }
        case .loaded(let payload):
            ScrollView {
                VStack(spacing: Theme.Spacing.sm) {
                    StrainHeroCard(payload: payload)
                    StrainTodayCard(today: payload.today, range: range)
                    TrendChartView(
                        title: "Avg heart rate",
                        unit: "bpm",
                        colorHex: "#ff6b6b",
                        points: payload.avgHrTrend
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
            let payload = try await StrainService(api: api).load(range: range)
            guard generation == loadGeneration else { return }
            state.succeed(payload, range: range)
        } catch {
            guard generation == loadGeneration, !Task.isCancelled else { return }
            state.fail(TrendsLoadError.describe(error), range: range)
        }
    }
}

/// The single place the latest strain appears: headline and trend from the
/// chart, plus where it sits on Whoop's 0–21 scale.
private struct StrainHeroCard: View {
    let payload: StrainPayload

    private var tile: KPITile? { payload.kpi.first { $0.key == .strain } }
    private var latestDate: String? { payload.strainTrend.last(where: { $0.raw != nil })?.date }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            MetricChart(
                title: "Strain",
                unit: "",
                accent: Theme.Palette.strain,
                points: payload.strainTrend,
                style: .bars,
                precision: 1,
                yDomain: 0 ... 21,
                height: 190
            )
            if let score = tile?.value {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(TrendsStats.freshness(dateKey: latestDate)) · \(StrainBand.zone(score))")
                            .font(Theme.FontStyle.sans(15, weight: .semibold))
                            .foregroundStyle(Theme.Palette.fg1)
                        Spacer(minLength: 0)
                        TrendsDeltaLabel(delta: tile?.delta)
                    }
                    StrainBand(score: score)
                }
                .padding(.top, Theme.Spacing.sm)
                .overlay(alignment: .top) {
                    Rectangle().fill(Theme.Palette.borderSubtle).frame(height: 1)
                }
            }
        }
        .glassCard(tint: .strain, padding: Theme.Spacing.md)
    }
}

private struct StrainBand: View {
    let score: Double

    static func zone(_ score: Double) -> String {
        switch score {
        case ..<10: return "Light"
        case ..<14: return "Moderate"
        case ..<18: return "High"
        default: return "All out"
        }
    }

    private static let knob: CGFloat = 14

    /// Knob centre and tick labels share one mapping: value/21 across the
    /// track, inset by the knob radius so both ends stay on screen.
    private static func x(_ value: Double, width: CGFloat) -> CGFloat {
        knob / 2 + (width - knob) * CGFloat(TrendsStrainScale.fraction(value))
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .topLeading) {
                Capsule()
                    .fill(LinearGradient(colors: [Theme.Palette.recovery, Theme.Palette.warning, Theme.Palette.danger],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: w - Self.knob, height: 6)
                    .position(x: w / 2, y: Self.knob / 2)
                Circle()
                    .fill(Theme.Palette.fg0)
                    .frame(width: Self.knob, height: Self.knob)
                    .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                    .position(x: Self.x(score, width: w), y: Self.knob / 2)
                ForEach(TrendsStrainScale.ticks, id: \.self) { tick in
                    Text("\(Int(tick))")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                        .fixedSize()
                        .position(x: Self.x(tick, width: w), y: Self.knob + 14)
                }
            }
        }
        .frame(height: 36)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Strain scale")
        .accessibilityValue(String(format: "%.1f of 21", score))
    }
}

private struct StrainTodayCard: View {
    let today: StrainPayload.Today
    let range: DateRange

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            TrendsCardLabel(TrendsStats.freshness(dateKey: today.date),
                            trailing: "\(today.workoutCount) workout\(today.workoutCount == 1 ? "" : "s")")
            TodayKpisView(today: today)
            if !today.workouts.isEmpty {
                TodayWorkoutsListView(workouts: today.workouts)
                    .padding(.top, 4)
                    .overlay(alignment: .top) {
                        Rectangle().fill(Theme.Palette.borderSubtle).frame(height: 1)
                    }
            }
            NavigationLink {
                WorkoutsView(initialRange: range)
            } label: {
                HStack {
                    Text("All workouts")
                        .font(Theme.FontStyle.sans(15, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                    Spacer()
                    TrendsChevron()
                }
                .frame(minHeight: 44)
                .padding(.horizontal, Theme.Spacing.sm)
                .background(RoundedRectangle(cornerRadius: Theme.Radius.lg).fill(Theme.Palette.bg3.opacity(0.7)))
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
            }
            .buttonStyle(TrendsCardPressStyle())
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

#Preview { NavigationStack { StrainView() } }
