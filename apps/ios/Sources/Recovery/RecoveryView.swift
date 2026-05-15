import SwiftUI

struct RecoveryView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading
    @State private var isLoading = false

    enum Phase {
        case loading
        case loaded(RecoveryPayload)
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
            .navigationTitle("Recovery")
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
                    TrendChartView(
                        title: "Recovery score",
                        subtitle: payload.rangeLabel,
                        unit: "%",
                        colorHex: "#00d4aa",
                        points: payload.recoveryTrend
                    )
                    HRVTrendCardView(trend: payload.hrvTrend, rangeLabel: payload.rangeLabel)
                    TrendChartView(
                        title: "Resting heart rate",
                        subtitle: payload.rangeLabel,
                        unit: "bpm",
                        colorHex: "#ff8c61",
                        points: payload.rhrTrend
                    )
                    if let spo2 = payload.spo2Trend {
                        Spo2TrendCardView(trend: spo2)
                    }
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
            let payload = try await RecoveryService(api: api).load(range: range)
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

#Preview { RecoveryView() }
