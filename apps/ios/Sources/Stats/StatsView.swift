import SwiftUI

struct StatsView: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    // 90 days by default: the monthly chart needs at least three months to say anything.
    @State private var range: DateRange = .d90
    @State private var phase: Phase = .loading
    @State private var loadedRange: DateRange?
    @State private var lastFetched: Date?
    @State private var isLoading = false
    @State private var loadGeneration = 0

    private static let staleInterval: TimeInterval = 300

    enum Phase {
        case loading
        case loaded(StatsPayload)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Stats")
                content
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task(id: range) { await load() }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active, !isLoading else { return }
            if let last = lastFetched, Date().timeIntervalSince(last) < Self.staleInterval { return }
            Task { await load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            StatsContent(payload: .placeholder, range: $range, isRefreshing: false)
                .redacted(reason: .placeholder)
                .allowsHitTesting(false)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Loading stats")
        case .loaded(let payload):
            if payload.allTime.workouts == 0 {
                emptyState
            } else {
                StatsContent(payload: payload, range: $range, loadedRange: loadedRange,
                             isRefreshing: isLoading && loadedRange != range)
                    .refreshable { await load() }
            }
        case .error(let message):
            ScrollView {
                InlineErrorCard(title: "Couldn't load stats", message: message) { Task { await load() } }
                    .padding(Theme.Spacing.md)
            }
            .refreshable { await load() }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                Text("No stats yet")
                    .font(Theme.FontStyle.sans(20, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
            } icon: {
                Image(systemName: "chart.bar.fill")
                    .foregroundStyle(Theme.Palette.recovery)
            }
        } description: {
            Text("Log some workouts and your all-time totals, records and year-over-year comparisons will show up here.")
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg2)
        }
    }

    @MainActor
    private func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        let requested = range
        isLoading = true
        defer { if generation == loadGeneration { isLoading = false } }

        let hasData: Bool
        if case .loaded = phase { hasData = true } else { hasData = false }

        do {
            let payload = try await StatsService(api: api).load(range: requested)
            guard generation == loadGeneration else { return }
            withAnimation(.snappy) {
                phase = .loaded(payload)
                loadedRange = requested
            }
            lastFetched = Date()
        } catch {
            guard generation == loadGeneration, !Task.isCancelled else { return }
            if hasData {
                if let loadedRange, loadedRange != requested { range = loadedRange }
            } else {
                phase = .error(Self.message(for: error))
            }
        }
    }

    private static func message(for error: Error) -> String {
        switch error {
        case APIError.unauthorized: return "Your session expired. Sign in again."
        case APIError.network: return "Check your connection and try again."
        case APIError.serverError(let code): return "The server had a problem (\(code))."
        case APIError.decode, APIError.badResponse: return "The server sent something unexpected."
        default: return "Something went wrong."
        }
    }
}

private struct StatsContent: View {
    let payload: StatsPayload
    @Binding var range: DateRange
    var loadedRange: DateRange?
    let isRefreshing: Bool

    private var windowDays: Int { (loadedRange ?? range).days }

    private var hasWindowData: Bool { !payload.bySport.isEmpty || !payload.trend.isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                AllTimeHero(allTime: payload.allTime, historyFloor: payload.historyFloor)
                if !payload.yoy.metrics.isEmpty {
                    YearOverYearCard(yoy: payload.yoy, historyFloor: payload.historyFloor)
                }
                if !payload.records.isEmpty {
                    RecordsCard(records: payload.records)
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Recent activity")
                            .font(Theme.FontStyle.sans(20, weight: .semibold))
                            .foregroundStyle(Theme.Palette.fg0)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        if isRefreshing {
                            ProgressView()
                                .controlSize(.small)
                                .tint(Theme.Palette.fg2)
                        }
                    }
                    RangePicker(selection: $range)
                }
                .padding(.top, Theme.Spacing.lg)

                Group {
                    if hasWindowData {
                        if !payload.bySport.isEmpty {
                            SportBreakdownCard(items: payload.bySport, days: windowDays)
                        }
                        if !payload.trend.isEmpty {
                            MonthlyVolumeCard(trend: payload.trend, windowDays: windowDays)
                        }
                    } else {
                        QuietWindowCard(days: windowDays)
                    }
                }
                .opacity(isRefreshing ? 0.45 : 1)
                .animation(.snappy, value: isRefreshing)
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .scrollContentBackground(.hidden)
        .scrollIndicators(.hidden)
    }
}

private struct QuietWindowCard: View {
    let days: Int

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "moon.zzz")
                .font(.system(size: 18))
                .foregroundStyle(Theme.Palette.fg3)
            Text("No workouts in the last \(days) days.")
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg2)
            Spacer(minLength: 0)
        }
        .glassCard()
    }
}

struct InlineErrorCard: View {
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.warning)
                Text(title)
                    .font(Theme.FontStyle.sans(17, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
            }
            Text(message)
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg2)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: retry) {
                Text("Retry")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Capsule().fill(Theme.Palette.bg4))
                    .overlay(Capsule().strokeBorder(Theme.Palette.borderStrong, lineWidth: 0.5))
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }
}

#Preview("Stats — sample") {
    @Previewable @State var range: DateRange = .d90
    StatsContent(payload: .placeholder, range: $range, isRefreshing: false)
        .background(Color.black)
        .preferredColorScheme(.dark)
}
