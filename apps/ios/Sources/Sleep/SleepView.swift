import SwiftUI

struct SleepView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading
    @State private var isLoading = false

    enum Phase {
        case loading
        case loaded(SleepPayload)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Sleep") { rangeMenu }
                content
            }
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
                    KPIStripView(tiles: payload.kpi)
                    if let latest = payload.latestSleep, let stages = latest.stages {
                        SleepStageDonutView(stages: stages, date: latest.date)
                    }
                    if let latest = payload.latestSleep, let need = latest.needBreakdown {
                        SleepNeedBreakdownView(need: need)
                    }
                    TrendChartView(
                        title: "Duration",
                        subtitle: payload.rangeLabel,
                        unit: "h",
                        colorHex: "#0055ff",
                        points: payload.durationTrend.map {
                            TrendPoint(date: $0.date, raw: $0.rawHours, ma7: $0.ma7, ma30: nil)
                        },
                        showRollingToggle: true,
                        enableMa30: false
                    )
                    TrendChartView(
                        title: "Performance",
                        subtitle: payload.rangeLabel,
                        unit: "%",
                        colorHex: "#7b61ff",
                        points: payload.performanceTrend,
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
            let payload = try await SleepService(api: api).load(range: range)
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

#Preview { SleepView() }
