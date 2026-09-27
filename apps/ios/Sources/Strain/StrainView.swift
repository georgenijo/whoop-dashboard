import SwiftUI

struct StrainView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange
    @State private var phase: TrendsLoadable<StrainPayload> = .loading
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
        switch phase {
        case .loading:
            TrendsDetailLoading(titles: ["Strain", "Today", "Avg heart rate"])
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
        if case .failed = phase { phase = .loading }
        do {
            let payload = try await StrainService(api: api).load(range: range)
            guard generation == loadGeneration else { return }
            phase = .loaded(payload)
        } catch {
            guard generation == loadGeneration, !Task.isCancelled, phase.value == nil else { return }
            phase = .failed(TrendsLoadError.describe(error))
        }
    }
}

/// The single place today's strain appears: headline and trend from the
/// chart, plus where today sits on Whoop's 0–21 scale.
private struct StrainHeroCard: View {
    let payload: StrainPayload

    private var tile: KPITile? { payload.kpi.first { $0.key == .strain } }

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
                        Text("Today · \(StrainBand.zone(score))")
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

    var body: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(LinearGradient(colors: [Theme.Palette.recovery, Theme.Palette.warning, Theme.Palette.danger],
                                             startPoint: .leading, endPoint: .trailing))
                        .frame(height: 6)
                    Circle()
                        .fill(Theme.Palette.fg0)
                        .frame(width: 14, height: 14)
                        .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                        .offset(x: max(0, min(geo.size.width - 14, geo.size.width * CGFloat(score / 21) - 7)))
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 14)
            HStack {
                ForEach(["0", "10", "14", "18", "21"], id: \.self) { tick in
                    Text(tick)
                    if tick != "21" { Spacer() }
                }
            }
            .font(Theme.FontStyle.mono(11))
            .foregroundStyle(Theme.Palette.fg3)
        }
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
            TrendsCardLabel("Today",
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
