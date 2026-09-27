import SwiftUI

struct StepsView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading

    enum Phase {
        case loading
        case loaded(StepsPayload)
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
            .navigationTitle("Steps")
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
                    StepsTodayCard(today: payload.today, rangeLabel: payload.rangeLabel)
                    TrendChartView(
                        title: "Daily steps",
                        unit: "steps",
                        colorHex: "#5ac8fa",
                        points: payload.stepsTrend,
                        style: .bars
                    )
                    Text("Apple Health · synced by Coach iOS")
                        .font(Theme.FontStyle.mono(10.5))
                        .foregroundStyle(Theme.Palette.fg3)
                        .frame(maxWidth: .infinity, alignment: .leading)
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
                    .tint(Theme.Palette.info)
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
            let payload = try await StepsService(api: api).load(range: range)
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

private struct StepsTodayCard: View {
    let today: StepsPayload.Today
    let rangeLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("TODAY")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(formatted(today.steps))
                    .font(Theme.FontStyle.display(38, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .monospacedDigit()
                Text("steps")
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.info)
            }
            if today.steps != nil, let average = today.vs7dAvg {
                Text("7-day average \(formatted(average)) steps · \(rangeLabel)")
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
            } else {
                Text("No Apple Health steps synced for today")
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(padding: Theme.Spacing.md)
    }

    private func formatted(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.number.precision(.fractionLength(0)))
    }
}

#Preview { StepsView() }
