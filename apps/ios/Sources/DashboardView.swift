import SwiftUI

struct DashboardView: View {
    var onOpenSettings: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var phase: Phase = .loading
    @State private var lastFetched: Date?
    @State private var isLoading = false
    @State private var loadGeneration = 0
    @State private var refreshError: String?
    @State private var detail: KPITile.Href?
    /// Date of each accumulating metric's own latest reading (steps, strain).
    @State private var metricDates: [KPITile.Key: String] = [:]

    private static let staleInterval: TimeInterval = 300

    enum Phase {
        case loading
        case loaded(DashboardPayload)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            content
            .navigationTitle("Today")
            .background(Theme.Palette.bg0)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onOpenSettings) {
                        Label("Settings", systemImage: "person.crop.circle")
                            .labelStyle(.iconOnly)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                }
            }
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
        .onReceive(NotificationCenter.default.publisher(for: .coachDataDidSync)) { _ in
            Task { await load(showSpinner: false) }
        }
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
        if case .loaded(let payload) = phase,
           let line = TodayFormat.freshness(dataDate: payload.dataDate, updatedAt: payload.recoveryHero.updatedAt,
                                            isFallback: payload.isFallback) {
            HStack(spacing: 8) {
                Circle()
                    .fill(payload.isFallback ? Theme.Palette.warning : Theme.Palette.recovery)
                    .frame(width: 8, height: 8)
                Text(line)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(payload.isFallback ? Theme.Palette.warning : Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(payload.isFallback ? "Showing latest data. \(line)" : line)
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
                    .accessibilityHidden(true)
            }
            .measuresFold()
            .scrollDisabled(true)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading today")
            .accessibilityAddTraits(.updatesFrequently)
        case .loaded(let payload):
            ScrollView {
                sections(payload, interactive: true)
            }
            .measuresFold()
        case .error(let message):
            ScrollView {
                errorCard(message)
                    .inLeadingFoldColumn()
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.top, Theme.Spacing.xs)
            }
            .measuresFold()
        }
    }

    /// One hierarchy in both poses: dated state and recommendation first,
    /// supporting measurements and historical evidence second.
    private func sections(_ payload: DashboardPayload, interactive: Bool) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            headerCaption
                .inLeadingFoldColumn()
            if let refreshError {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Couldn't refresh", systemImage: "wifi.exclamationmark")
                        .font(Theme.FontStyle.sans(13, weight: .semibold))
                    Text("Showing previously loaded data. " + refreshError)
                        .font(Theme.FontStyle.sans(13))
                    Button("Try again") { Task { await load(showSpinner: false) } }
                        .frame(minHeight: 44)
                }
                .foregroundStyle(Theme.Palette.fg1)
                .glassCard()
            }
            FoldColumns {
                RecoveryHeroView(
                    hero: payload.recoveryHero,
                    trend: payload.recoveryTrend,
                    onTap: interactive ? { detail = .recovery } : nil,
                    showsGuidance: payload.isFallback || payload.aiInsight?.isCurrent != true,
                    isHistorical: payload.isFallback
                )
                if let insight = payload.aiInsight, insight.isCurrent, !payload.isFallback {
                    AIInsightCardView(insight: insight)
                }
                if payload.isFallback {
                    Button {
                        NotificationCenter.default.post(name: .coachComposeRequested, object: "Help me understand my latest data and what is missing before suggesting today's training.")
                    } label: {
                        Label("Review my data with Coach", systemImage: "bubble.left")
                            .font(Theme.FontStyle.sans(15, weight: .medium))
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                }
                if sizeClass == .regular {
                    RecoveryTrendCardView(points: payload.recoveryTrend)
                    records(payload.prs)
                }
            } trailing: {
                KPIStripView(
                    tiles: vitals(payload.kpi),
                    columns: 2,
                    title: "Measurements",
                    inProgress: TodayFormat.partialKeys(metricDates: metricDates, isFallback: payload.isFallback)
                ) { tile in
                    detail = tile.href
                }
                if sizeClass != .regular {
                    RecoveryTrendCardView(points: payload.recoveryTrend)
                    records(payload.prs)
                }
                if let insight = payload.aiInsight, !insight.isCurrent || payload.isFallback {
                    AIInsightCardView(insight: insight, historical: true)
                }
            }
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

    private struct Record: Identifiable {
        let id: String
        let title: String
        let value: Int
        let unit: String
        let note: String
    }

    static func recordItems(_ prs: DashboardPayload.PRs) -> [(id: String, title: String, value: Int, unit: String, note: String)] {
        func day(_ raw: String) -> String {
            ChartDate.parse(raw).map { $0.formatted(.dateTime.month(.abbreviated).day()) } ?? raw
        }
        var items: [(id: String, title: String, value: Int, unit: String, note: String)] = []
        if let r = prs.bestHrv { items.append(("hrv", "Highest HRV", Int(r.value.rounded()), "ms", day(r.date))) }
        if let r = prs.lowestRhr { items.append(("rhr", "Lowest resting HR", Int(r.value.rounded()), "bpm", day(r.date))) }
        if let r = prs.recoveryStreak { items.append(("rec", "Recovery 80%+ streak", r.count, r.count == 1 ? "day" : "days", "ended " + day(r.endDate))) }
        if let r = prs.sleepPerfStreak { items.append(("sleep", "Sleep 85%+ streak", r.count, r.count == 1 ? "day" : "days", "ended " + day(r.endDate))) }
        if let r = prs.loggingStreak { items.append(("log", "Logging streak", r.count, r.count == 1 ? "day" : "days", "through " + day(r.endDate))) }
        return items
    }

    @ViewBuilder
    private func records(_ prs: DashboardPayload.PRs) -> some View {
        let items = Self.recordItems(prs).map { Record(id: $0.id, title: $0.title, value: $0.value, unit: $0.unit, note: $0.note) }
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                LedgerHeader(title: "Personal records")
                LedgerRule()
                LedgerGrid(items: items, columns: 2) { item in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title)
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg2)
                        HStack(alignment: .firstTextBaseline, spacing: 3) {
                            Text("\(item.value)")
                                .font(Theme.FontStyle.mono(22, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg0)
                            Text(item.unit)
                                .font(Theme.FontStyle.mono(11))
                                .foregroundStyle(Theme.Palette.fg2)
                        }
                        Text(item.note)
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .glassCard(padding: 0)
        }
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
            .tint(Theme.Palette.accent)
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
            withAnimation(reduceMotion ? nil : .snappy) { phase = .loaded(payload) }
            refreshError = nil
            lastFetched = Date()
            Task { await loadMetricDates(generation: generation) }
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
        guard generation == loadGeneration else { return }
        if hadLoadedData {
            refreshError = failure
        } else {
            phase = .error(failure)
        }
    }

    /// Each metric's own reading date comes from its detail endpoint, since the
    /// dashboard payload only dates recovery. Unknown dates simply leave the
    /// metric showing its ordinary comparison.
    @MainActor
    private func loadMetricDates(generation: Int) async {
        let api = api
        async let strain = try? StrainService(api: api).load(range: .d7).today.date
        async let steps = try? StepsService(api: api).load(range: .d7).today.date
        let (strainDate, stepsDate) = await (strain, steps)
        guard generation == loadGeneration else { return }
        var dates: [KPITile.Key: String] = [:]
        if let strainDate { dates[.strain] = strainDate }
        if let stepsDate { dates[.steps] = stepsDate }
        metricDates = dates
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
