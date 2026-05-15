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
                RangeSelectorView(selection: $range)
                    .padding(.top, 8)
                    .onChange(of: range) { _, _ in
                        Task { await load(showSpinner: true) }
                    }
                content
            }
            .navigationTitle("Sleep")
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
                VStack(spacing: 16) {
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
                        colorHex: "#4dabf7",
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
                        colorHex: "#a78bfa",
                        points: payload.performanceTrend,
                        showRollingToggle: true,
                        enableMa30: false
                    )
                }
                .padding()
            }
        case .error(let msg):
            VStack(spacing: 12) {
                Text(msg).font(.footnote).foregroundStyle(.secondary)
                Button("Retry") { Task { await load(showSpinner: true) } }
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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
