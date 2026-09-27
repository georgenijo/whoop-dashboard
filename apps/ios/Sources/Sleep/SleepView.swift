import SwiftUI

struct SleepView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading

    enum Phase {
        case loading
        case loaded(SleepPayload)
        case error(String)
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                RangePicker(selection: $range)
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, Theme.Spacing.xs)
                    .background(Theme.Palette.bg0.opacity(0.92))
            }
            .navigationTitle("Sleep")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(.hidden, for: .navigationBar)
            .task(id: range) { await load(showSpinner: true) }
            .refreshable { await load(showSpinner: false) }
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
                        unit: "h",
                        colorHex: "#4d7cff",
                        points: payload.durationTrend.map {
                            TrendPoint(date: $0.date, raw: $0.rawHours, ma7: $0.ma7, ma30: nil)
                        },
                        style: .bars,
                        precision: 1
                    )
                    TrendChartView(
                        title: "Performance",
                        unit: "%",
                        colorHex: "#7b61ff",
                        points: payload.performanceTrend
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


    @MainActor
    private func load(showSpinner: Bool) async {
        let hadLoaded: Bool
        if case .loaded = phase { hadLoaded = true } else { hadLoaded = false }
        if showSpinner, !hadLoaded { phase = .loading }
        do {
            let payload = try await SleepService(api: api).load(range: range)
            guard !Task.isCancelled else { return }
            phase = .loaded(payload)
        } catch APIError.unauthorized {
            if !hadLoaded, !Task.isCancelled { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadLoaded, !Task.isCancelled { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadLoaded, !Task.isCancelled { phase = .error("Server error (\(code))") }
        } catch {
            if !hadLoaded, !Task.isCancelled { phase = .error("Could not load") }
        }
    }
}

#Preview { SleepView() }
