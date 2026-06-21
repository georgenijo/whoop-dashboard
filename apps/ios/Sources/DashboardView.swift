import SwiftUI

struct DashboardView: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var phase: Phase = .loading
    @State private var lastFetched: Date?
    @State private var isLoading = false

    private static let staleInterval: TimeInterval = 300

    enum Phase {
        case loading
        case loaded(DashboardPayload)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Today") {
                    Circle()
                        .fill(Theme.Palette.recovery)
                        .frame(width: 8, height: 8)
                        .shadow(color: Theme.Palette.recovery.opacity(0.7), radius: 5)
                }
                content
            }
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load(showSpinner: false) }
        }
        .task { await load(showSpinner: true) }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            guard !isLoading else { return }
            if let last = lastFetched, Date().timeIntervalSince(last) < Self.staleInterval {
                return
            }
            Task { await load(showSpinner: false) }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let payload):
            ScrollView {
                VStack(spacing: Theme.Spacing.sm) {
                    RecoveryHeroView(hero: payload.recoveryHero)
                    KPIStripView(tiles: payload.kpi)
                    if let insight = payload.aiInsight {
                        AIInsightCardView(insight: insight)
                    }
                    RecoveryTrendCardView(points: payload.recoveryTrend)
                }
                .padding()
            }
        case .error(let message):
            VStack(spacing: 12) {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("Retry") {
                    Task { await load(showSpinner: true) }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.Palette.recovery)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @MainActor
    private func load(showSpinner: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        let hadLoadedData: Bool
        if case .loaded = phase { hadLoadedData = true } else { hadLoadedData = false }

        if showSpinner, !hadLoadedData {
            phase = .loading
        }
        do {
            let payload = try await DashboardServiceV2(api: api).load(range: .d30)
            phase = .loaded(payload)
            lastFetched = Date()
        } catch APIError.unauthorized {
            if !hadLoadedData { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadLoadedData { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadLoadedData { phase = .error("Server error (\(code))") }
        } catch APIError.decode {
            if !hadLoadedData { phase = .error("Bad response from server") }
        } catch APIError.badResponse {
            if !hadLoadedData { phase = .error("Bad response from server") }
        } catch {
            if !hadLoadedData { phase = .error("Could not load") }
        }
    }
}

#Preview {
    DashboardView()
}
