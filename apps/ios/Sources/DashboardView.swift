import SwiftUI

struct DashboardView: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var phase: Phase = .loading
    @State private var lastFetched: Date?
    @State private var isLoading = false
    @State private var loadGeneration = 0
    @State private var detail: KPITile.Href?

    private static let staleInterval: TimeInterval = 300

    enum Phase {
        case loading
        case loaded(DashboardPayload)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Today") { headerCaption }
                content
            }
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load(showSpinner: false) }
            .navigationDestination(item: $detail) { href in
                switch href {
                case .recovery: RecoveryView()
                case .sleep: SleepView()
                case .strain: StrainView()
                case .steps: StepsView()
                }
            }
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
    private var headerCaption: some View {
        if case .loaded(let payload) = phase, let date = payload.dataDate.flatMap(ChartDate.parse) {
            let label = date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            HStack(spacing: 6) {
                Circle()
                    .fill(payload.isFallback ? Theme.Palette.warning : Theme.Palette.recovery)
                    .frame(width: 6, height: 6)
                Text(payload.isFallback ? "Latest · \(label)" : label)
                    .font(Theme.FontStyle.mono(11, weight: .medium))
                    .foregroundStyle(payload.isFallback ? Theme.Palette.warning : Theme.Palette.fg2)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(payload.isFallback ? "Showing latest data from \(label)" : "Data for \(label)")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ScrollView {
                sections(Self.placeholder, interactive: false)
                    .redacted(reason: .placeholder)
                    .allowsHitTesting(false)
            }
            .scrollDisabled(true)
            .accessibilityLabel("Loading today")
        case .loaded(let payload):
            ScrollView {
                sections(payload, interactive: true)
            }
        case .error(let message):
            ScrollView {
                errorCard(message)
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.top, Theme.Spacing.xs)
            }
        }
    }

    private func sections(_ payload: DashboardPayload, interactive: Bool) -> some View {
        VStack(spacing: Theme.Spacing.sm) {
            RecoveryHeroView(
                hero: payload.recoveryHero,
                trend: payload.recoveryTrend,
                onTap: interactive ? { detail = .recovery } : nil
            )
            KPIStripView(tiles: vitals(payload.kpi), columns: 3) { tile in
                detail = tile.href
            }
            if let insight = payload.aiInsight {
                AIInsightCardView(insight: insight)
            }
            RecoveryTrendCardView(points: payload.recoveryTrend)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.top, Theme.Spacing.xxs)
        .padding(.bottom, Theme.Spacing.xl)
        .sensoryFeedback(.selection, trigger: detail)
    }

    /// The hero already carries recovery, so the grid shows the six vitals
    /// that explain it.
    private func vitals(_ tiles: [KPITile]) -> [KPITile] {
        let order: [KPITile.Key] = [.hrv, .rhr, .sleep, .strain, .steps, .spo2]
        return order.compactMap { key in tiles.first { $0.key == key } }
    }

    private func errorCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(spacing: 8) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg2)
                Text("Couldn't load today")
                    .font(Theme.FontStyle.sans(17, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
            }
            Text(message)
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg2)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await load(showSpinner: true) }
            } label: {
                Text("Retry")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.Palette.recovery.opacity(0.9))
            .foregroundStyle(Theme.Palette.bg0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(padding: Theme.Spacing.lg)
    }

    @MainActor
    private func load(showSpinner: Bool) async {
        loadGeneration += 1
        let generation = loadGeneration
        isLoading = true
        defer { if generation == loadGeneration { isLoading = false } }

        let hadLoadedData: Bool
        if case .loaded = phase { hadLoadedData = true } else { hadLoadedData = false }

        if showSpinner, !hadLoadedData {
            phase = .loading
        }

        let failure: String
        do {
            let payload = try await DashboardServiceV2(api: api).load(range: .d30)
            guard generation == loadGeneration else { return }
            withAnimation(.snappy) { phase = .loaded(payload) }
            lastFetched = Date()
            return
        } catch APIError.unauthorized {
            failure = "Your session expired. Sign in again."
        } catch APIError.network(let err) {
            failure = err.localizedDescription
        } catch APIError.serverError(let code) {
            failure = "The server returned an error (\(code))."
        } catch APIError.decode, APIError.badResponse {
            failure = "The server sent a response the app couldn't read."
        } catch {
            failure = "Something went wrong. Pull down or tap Retry."
        }
        guard generation == loadGeneration, !hadLoadedData else { return }
        phase = .error(failure)
    }

    private static let placeholder: DashboardPayload = {
        let tile = { (key: KPITile.Key, label: String, value: Double, unit: String) in
            KPITile(key: key, label: label, value: value, unit: unit, precision: 0,
                    delta: .init(label: "↑ 0 vs yesterday", dir: .flat), href: nil, colorHex: "#6b6b74")
        }
        let trend = (0..<30).map { i in
            TrendPoint(date: ChartDate.key(Date().addingTimeInterval(Double(i - 29) * 86_400)),
                       raw: 60, ma7: 60, ma30: nil)
        }
        return DashboardPayload(
            dataDate: nil,
            isFallback: false,
            recoveryHero: .init(score: nil, hrvMs: nil, rhrBpm: nil, updatedAt: nil),
            aiInsight: .init(
                text: "## Key Findings\n- Placeholder finding text that fills a line\n## Action Items\n- First placeholder action item\n- Second placeholder action",
                createdAt: nil,
                isStale: false
            ),
            kpi: [
                tile(.hrv, "HRV", 50, "ms"), tile(.rhr, "RHR", 55, "bpm"), tile(.sleep, "Sleep", 7, "h"),
                tile(.strain, "Strain", 10, ""), tile(.steps, "Steps", 8000, ""), tile(.spo2, "SpO2", 96, "%")
            ],
            prs: .init(bestHrv: nil, lowestRhr: nil, recoveryStreak: nil, sleepPerfStreak: nil, loggingStreak: nil),
            recoveryTrend: trend
        )
    }()
}

#Preview {
    DashboardView()
}
