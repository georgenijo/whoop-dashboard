import SwiftUI

struct DashboardView: View {
    var onOpenSettings: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var phase: Phase = .loading
    @State private var lastFetched: Date?
    @State private var isLoading = false
    @State private var loads = DashboardLoadCoordinator()
    @State private var briefIsWriting = false
    @State private var refreshError: String?
    @State private var showsHistory = false
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
        .task(id: pollKey) { await pollWhileWriting() }
        .onReceive(NotificationCenter.default.publisher(for: .coachDataDidSync)) { _ in
            Task { await load(showSpinner: false) }
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            guard !isLoading else { return }
            if briefIsWriting { Task { await load(showSpinner: false) }; return }
            if let last = lastFetched, Date().timeIntervalSince(last) < Self.staleInterval {
                return
            }
            Task { await load(showSpinner: false) }
        }
    }

    @ViewBuilder
    private func headerCaption(_ payload: DashboardPayload) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let line = TodayFormat.freshness(dataDate: payload.dataDate, updatedAt: payload.recoveryHero.updatedAt,
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
            if refreshError != nil {
                Button { Task { await load(showSpinner: false) } } label: {
                    Label("Couldn't refresh · Retry", systemImage: "exclamationmark.circle")
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.warning)
                        .frame(minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityHint(refreshError ?? "")
            }
        }
    }

    private var content: some View {
        // Read the viewport and fold in the same layout pass. A cached width
        // can briefly retain the open display's columns after the view shrinks.
        GeometryReader { viewport in
            let fold = FoldGeometry(width: viewport.size.width, hinge: FoldGeometry.hinge(in: viewport))
            Group {
                switch phase {
                case .loading:
                    ScrollView {
                        sections(Self.placeholder, interactive: false)
                            .frame(width: viewport.size.width, alignment: .leading)
                            .redacted(reason: .placeholder)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    .scrollDisabled(true)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Loading today")
                    .accessibilityAddTraits(.updatesFrequently)
                case .loaded(let payload):
                    ScrollView {
                        sections(payload, interactive: true)
                            .frame(width: viewport.size.width, alignment: .leading)
                    }
                case .error(let message):
                    ScrollView {
                        errorCard(message)
                            .inLeadingFoldColumn()
                            .padding(.horizontal, Theme.Spacing.md)
                            .padding(.top, Theme.Spacing.xs)
                            .frame(width: viewport.size.width, alignment: .leading)
                    }
                }
            }
            .environment(\.foldGeometry, fold)
        }
    }

    /// One hierarchy in both poses: dated state and recommendation first,
    /// supporting measurements and historical evidence second.
    func sections(_ payload: DashboardPayload, interactive: Bool) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            headerCaption(payload)
                .inLeadingFoldColumn()
            let brief = TodayBriefContent(
                insight: payload.aiInsight, isFallback: payload.isFallback, isRefreshing: payload.insightRefreshing)
            // A current brief leads. Without one the readings lead and the brief
            // is a single compact row, so nothing pushes the numbers off screen.
            if brief.leadsToday {
                FoldColumns(spacing: Theme.Spacing.md) {
                    TodayBriefView(content: brief)
                    historyDisclosure(payload)
                } trailing: {
                    signals(payload, interactive: interactive)
                }
            } else if brief.rowAboveReadings {
                FoldColumns(spacing: Theme.Spacing.md) {
                    TodayBriefRow(content: brief, above: true)
                    signals(payload, interactive: interactive)
                } trailing: {
                    VStack(alignment: .leading, spacing: 0) {
                        if let previous = brief.previous { TodayPreviousRow(previous: previous) }
                        historyDisclosure(payload)
                    }
                }
            } else {
                FoldColumns(spacing: Theme.Spacing.md) {
                    signals(payload, interactive: interactive)
                } trailing: {
                    VStack(alignment: .leading, spacing: 0) {
                        TodayBriefRow(content: brief)
                        if let previous = brief.previous { TodayPreviousRow(previous: previous) }
                        historyDisclosure(payload)
                    }
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.top, Theme.Spacing.xxs)
        .padding(.bottom, Theme.Spacing.xl)
        .sensoryFeedback(.selection, trigger: detail)
    }

    private func signals(_ payload: DashboardPayload, interactive: Bool) -> some View {
        TodaySignalsView(
            payload: payload,
            inProgress: TodayFormat.partialKeys(metricDates: metricDates, isFallback: payload.isFallback)
        ) { href in
            if interactive { detail = href }
        }
    }

    private func historyDisclosure(_ payload: DashboardPayload) -> some View {
        DisclosureGroup(isExpanded: $showsHistory) {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                RecoveryTrendCardView(points: payload.recoveryTrend)
                records(payload.prs)
            }
            .padding(.top, Theme.Spacing.sm)
        } label: {
            Text("History & personal records")
                .font(Theme.FontStyle.sans(13, weight: .medium))
                .foregroundStyle(Theme.Palette.fg2)
                .frame(minHeight: 44, alignment: .leading)
        }
        .tint(Theme.Palette.fg3)
        .overlay(alignment: .top) { LedgerRule() }
        .accessibilityIdentifier("today-history")
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
    private func load(showSpinner: Bool, polling: Bool = false) async {
        let generation: Int
        if polling {
            guard let token = loads.beginPoll() else { return }
            generation = token
        } else {
            generation = loads.beginExplicit()
        }
        isLoading = true
        defer {
            if !polling { loads.endExplicit() }
            if loads.isCurrent(generation) { isLoading = false }
        }

        let hadLoadedData: Bool
        if case .loaded = phase { hadLoadedData = true } else { hadLoadedData = false }

        if showSpinner, !hadLoadedData {
            phase = .loading
        }

        let failure: String
        do {
            let payload = try await DashboardServiceV2(api: api).load(range: .d30)
            guard loads.isCurrent(generation) else { return }
            withAnimation(reduceMotion ? nil : .snappy) { phase = .loaded(payload) }
            briefIsWriting = TodayBriefContent(
                insight: payload.aiInsight, isFallback: payload.isFallback, isRefreshing: payload.insightRefreshing
            ).shouldPoll
            refreshError = nil
            lastFetched = Date()
            Task { await loadMetricDates(generation: generation) }
            return
        } catch where APIError.isCancellation(error) || Task.isCancelled {
            // Abandoned, not failed: keep whatever is on screen and say nothing.
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
        guard loads.shouldSurfaceFailure(token: generation, polling: polling) else { return }
        if hadLoadedData {
            refreshError = failure
        } else {
            phase = .error(failure)
        }
    }

    private struct PollKey: Equatable {
        let active: Bool
        let writing: Bool
        let suspended: Bool
    }

    /// Polling is suspended while an explicit load is in flight and re-armed
    /// (a fresh schedule) when it settles, because the key changes both times.
    private var pollKey: PollKey {
        PollKey(active: scenePhase == .active, writing: briefIsWriting, suspended: loads.explicitInFlight > 0)
    }

    /// Bounded: at most four re-fetches at 6, 12, 24 and 48 seconds from arming,
    /// ending early once the brief is no longer being written. SwiftUI cancels
    /// this task when the key changes or the view goes away.
    @MainActor
    private func pollWhileWriting() async {
        let key = pollKey
        guard key.writing, key.active, !key.suspended else { return }
        var schedule = BriefPollSchedule()
        schedule.arm(at: Date())
        while let deadline = schedule.nextDeadline {
            let wait = deadline.timeIntervalSinceNow
            if wait > 0 {
                do { try await Task.sleep(for: .seconds(wait)) } catch { return }
            }
            if Task.isCancelled { return }
            schedule.recordAttempt()
            await load(showSpinner: false, polling: true)
            if Task.isCancelled || !briefIsWriting { return }
        }
    }

    /// Each metric's own reading date comes from its detail endpoint, since the
    /// dashboard payload only dates recovery. Unknown dates simply leave the
    /// metric showing its ordinary comparison.
    @MainActor
    private func loadMetricDates(generation: Int) async {
        let api = api
        async let strain = try? StrainService(api: api).load(range: .d7).strainTrend
        async let steps = try? StepsService(api: api).load(range: .d7).stepsTrend
        let (strainTrend, stepsTrend) = await (strain, steps)
        let strainDate = strainTrend.flatMap(TrendsStats.latestReadingDate)
        let stepsDate = stepsTrend.flatMap(TrendsStats.latestReadingDate)
        guard loads.isCurrent(generation) else { return }
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
