import SwiftUI

struct StrainView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading
    @State private var isLoading = false

    enum Phase {
        case loading
        case loaded(StrainPayload)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Strain") { rangeMenu }
                content
            }
            .background(Theme.Palette.bg)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load(showSpinner: false) }
        }
        .task { await load(showSpinner: true) }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let payload):
            ScrollView {
                VStack(spacing: Theme.Spacing.sm) {
                    StrainHeroView(score: payload.todayStrain, label: payload.rangeLabel)
                    TodayKpisView(today: payload.today)
                    if !payload.today.workouts.isEmpty {
                        TodayWorkoutsListView(workouts: payload.today.workouts)
                    }
                    NavigationLink {
                        WorkoutsView()
                            .toolbarBackground(.hidden, for: .navigationBar)
                    } label: {
                        AllWorkoutsRow()
                    }
                    .buttonStyle(.plain)
                    TrendChartView(
                        title: "Daily strain",
                        subtitle: payload.rangeLabel,
                        unit: "score",
                        colorHex: "#ffaa00",
                        points: payload.strainTrend,
                        showRollingToggle: true,
                        enableMa30: false
                    )
                    TrendChartView(
                        title: "Avg heart rate",
                        subtitle: payload.rangeLabel,
                        unit: "bpm",
                        colorHex: "#ff6b6b",
                        points: payload.avgHrTrend,
                        showRollingToggle: true,
                        enableMa30: false
                    )
                }
                .padding(Theme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
        case .error(let msg):
            VStack(spacing: 12) {
                Text(msg)
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
                Button("Retry") { Task { await load(showSpinner: true) } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Palette.brandStrain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var rangeMenu: some View {
        Menu {
            ForEach(DateRange.allCases) { r in
                Button {
                    range = r
                    Task { await load(showSpinner: true) }
                } label: {
                    Label(r.label, systemImage: range == r ? "checkmark" : "")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(range.label)
                    .font(Theme.FontStyle.mono(11, weight: .medium))
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(Theme.Palette.brandStrain)
        }
    }

    @MainActor
    private func load(showSpinner: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        let hadLoaded: Bool
        if case .loaded = phase { hadLoaded = true } else { hadLoaded = false }
        if showSpinner, !hadLoaded { phase = .loading }
        do {
            let payload = try await StrainService(api: api).load(range: range)
            phase = .loaded(payload)
        } catch APIError.unauthorized {
            if !hadLoaded { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadLoaded { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadLoaded { phase = .error("Server error (\(code))") }
        } catch {
            if !hadLoaded { phase = .error("Could not load") }
        }
    }
}

private struct StrainHeroView: View {
    let score: Double?
    let label: String

    var body: some View {
        VStack(spacing: 6) {
            Text("STRAIN")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)

            ZStack {
                if let score {
                    Text(String(format: "%.1f", score))
                        .font(Theme.FontStyle.display(80, weight: .medium))
                        .foregroundStyle(Theme.Palette.strain)
                        .monospacedDigit()
                } else {
                    Text("—")
                        .font(Theme.FontStyle.display(80, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg2)
                }
            }

            Text("OF 21")
                .font(Theme.FontStyle.mono(10))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg3)

            if let score {
                StrainBand(score: score)
                    .padding(.top, 14)
            }
        }
        .frame(maxWidth: .infinity)
        .glassCard(tint: .strain, padding: Theme.Spacing.lg)
    }
}

private struct StrainBand: View {
    let score: Double

    var body: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Theme.Palette.recovery, Theme.Palette.warning, Theme.Palette.danger],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: 6)

                GeometryReader { geo in
                    Circle()
                        .fill(Theme.Palette.fg0)
                        .frame(width: 14, height: 14)
                        .offset(x: max(0, min(geo.size.width - 14, geo.size.width * CGFloat(score / 21) - 7)),
                                y: -4)
                }
                .frame(height: 6)
            }
            HStack {
                Text("0").foregroundStyle(Theme.Palette.fg3)
                Spacer()
                Text("10").foregroundStyle(Theme.Palette.fg3)
                Spacer()
                Text("15").foregroundStyle(Theme.Palette.fg3)
                Spacer()
                Text("18").foregroundStyle(Theme.Palette.fg3)
                Spacer()
                Text("21").foregroundStyle(Theme.Palette.fg3)
            }
            .font(Theme.FontStyle.mono(9.5))
        }
    }
}

private struct AllWorkoutsRow: View {
    var body: some View {
        HStack {
            Image(systemName: "list.bullet.rectangle")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.Palette.strain)
                .frame(width: 28)
            Text("All workouts")
                .font(Theme.FontStyle.sans(13.5, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

private extension StrainPayload {
    var todayStrain: Double? {
        kpi.first(where: { $0.key == .strain })?.value
    }
}

#Preview { StrainView() }
