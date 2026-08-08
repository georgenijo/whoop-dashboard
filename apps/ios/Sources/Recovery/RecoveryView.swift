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
                PageHeader("Recovery") { rangeMenu }
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
                    RecoveryReceiptHeroView(
                        score: payload.recoveryScoreFromKPI,
                        timestampLabel: payload.rangeLabel,
                        factors: payload.receiptFactors
                    )
                    TrendChartView(
                        title: "Recovery score",
                        subtitle: payload.rangeLabel,
                        unit: "%",
                        colorHex: "#00d4aa",
                        points: payload.recoveryTrend,
                        showRollingToggle: false,
                        enableMa30: false
                    )
                    HRVTrendCardView(trend: payload.hrvTrend, rangeLabel: payload.rangeLabel)
                    TrendChartView(
                        title: "Resting heart rate",
                        subtitle: payload.rangeLabel,
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
