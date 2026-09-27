import SwiftUI

struct RecoveryView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading
    /// Bumped by every load (range change, pull-to-refresh, Retry); only the
    /// newest request may commit, so an older refresh can't overwrite a new range.
    @State private var loadGeneration = 0

    enum Phase {
        case loading
        case loaded(RecoveryPayload)
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
            .navigationTitle("Recovery")
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
                    RecoveryReceiptHeroView(
                        score: payload.recoveryScoreFromKPI,
                        timestampLabel: payload.rangeLabel,
                        factors: payload.receiptFactors
                    )
                    TrendChartView(
                        title: "Recovery score",
                        unit: "%",
                        colorHex: "#00d4aa",
                        points: payload.recoveryTrend,
                        yDomain: 0 ... 100
                    )
                    HRVTrendCardView(trend: payload.hrvTrend)
                    TrendChartView(
                        title: "Resting heart rate",
                        unit: "bpm",
                        colorHex: "#ff6b6b",
                        points: payload.rhrTrend
                    )
                    if let spo2 = payload.spo2Trend {
                        Spo2TrendCardView(trend: spo2)
                    }
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
        loadGeneration += 1
        let generation = loadGeneration
        let hadLoaded: Bool
        if case .loaded = phase { hadLoaded = true } else { hadLoaded = false }
        if showSpinner, !hadLoaded { phase = .loading }
        do {
            let payload = try await RecoveryService(api: api).load(range: range)
            guard generation == loadGeneration else { return }
            phase = .loaded(payload)
        } catch APIError.unauthorized {
            if !hadLoaded, generation == loadGeneration { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadLoaded, generation == loadGeneration { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadLoaded, generation == loadGeneration { phase = .error("Server error (\(code))") }
        } catch {
            if !hadLoaded, generation == loadGeneration { phase = .error("Could not load") }
        }
    }
}

private extension RecoveryPayload {
    var recoveryScoreFromKPI: Double? {
        kpi.first(where: { $0.key == .recovery })?.value
    }

    var receiptFactors: [RecoveryReceiptHeroView.Factor] {
        kpi.filter { $0.key != .recovery }.map { tile in
            let direction: RecoveryReceiptHeroView.Factor.Direction = {
                switch tile.delta?.dir {
                case .up: return .up
                case .down: return tile.key == .rhr ? .up : .down
                case .flat: return .flat
                case .none: return .neutral
                }
            }()
            let valueLabel: String = {
                guard let v = tile.value else { return "—" }
                let formatted = String(format: "%.\(tile.precision)f", v)
                return tile.unit.isEmpty ? formatted : "\(formatted) \(tile.unit)"
            }()
            return RecoveryReceiptHeroView.Factor(
                label: tile.label,
                value: valueLabel,
                delta: tile.delta?.label,
                direction: direction,
                color: Color(hex: tile.colorHex)
            )
        }
    }
}

#Preview { RecoveryView() }
