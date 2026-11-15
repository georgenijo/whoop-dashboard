import SwiftUI

struct PlansView: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var phase: Phase = .loading
    @State private var lastFetched: Date?
    @State private var isLoading = false

    private static let staleInterval: TimeInterval = 300

    enum Phase {
        case loading
        case loaded(PlansResult)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Plans")
        }
        .task { await load(showSpinner: true) }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active, !isLoading else { return }
            if let last = lastFetched, Date().timeIntervalSince(last) < Self.staleInterval { return }
            Task { await load(showSpinner: false) }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            PlansContent(plans: PlansSample.plans, recovery: PlansSample.recovery)
                .redacted(reason: .placeholder)
                .allowsHitTesting(false)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Loading plans")
        case .loaded(let result):
            if result.plans.isEmpty {
                ScrollView {
                    emptyState
                        .inLeadingFoldColumn()
                        .padding(.horizontal, Theme.Spacing.md)
                }
                .measuresFold()
                .refreshable { await load(showSpinner: false) }
            } else {
                PlansContent(plans: result.plans, recovery: result.recovery)
                    .refreshable { await load(showSpinner: false) }
            }
        case .error(let message):
            ScrollView {
                InlineErrorCard(title: "Couldn't load plans", message: message) {
                    Task { await load(showSpinner: true) }
                }
                .inLeadingFoldColumn()
                .padding(Theme.Spacing.md)
            }
            .measuresFold()
            .refreshable { await load(showSpinner: false) }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(Theme.Palette.recovery)
                .frame(width: 44, height: 44)
                .background(Theme.Palette.recovery.opacity(0.14), in: Circle())
            Text("No plans yet")
                .font(Theme.FontStyle.sans(20, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
            Text("Build a training plan that adjusts to your recovery. Saved plans and their exercises appear here.")
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg2)
                .fixedSize(horizontal: false, vertical: true)
            Button("Build a plan with Coach") {
                CoachCompose.request(PlansPresentation.newPlanDraft)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.Palette.accent)
            .frame(minHeight: 44)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(padding: Theme.Spacing.lg)
    }

    @MainActor
    private func load(showSpinner: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        let hadData: Bool
        if case .loaded = phase { hadData = true } else { hadData = false }
        if showSpinner, !hadData { phase = .loading }

        do {
            let result = try await PlansService(api: api).load()
            withAnimation(.snappy) { phase = .loaded(result) }
            lastFetched = Date()
        } catch APIError.unauthorized {
            if !hadData { phase = .error("Your session expired. Sign in again.") }
        } catch APIError.network {
            if !hadData { phase = .error("Check your connection and try again.") }
        } catch APIError.serverError(let code) {
            if !hadData { phase = .error("The server had a problem (\(code)).") }
        } catch APIError.decode {
            if !hadData { phase = .error("The server sent something unexpected.") }
        } catch APIError.badResponse {
            if !hadData { phase = .error("The server sent something unexpected.") }
        } catch {
            if !hadData { phase = .error("Something went wrong.") }
        }
    }
}

struct PlansContent: View {
    let plans: [WorkoutPlan]
    let recovery: PlanRecovery?

    private var heroPlan: WorkoutPlan? {
        plans.first(where: { $0.isActive }) ?? plans.first
    }

    private var heroIsActive: Bool {
        plans.contains(where: { $0.isActive })
    }

    var body: some View {
        ScrollView {
            // Inner display: today's session and the week beside the saved
            // plans, split at the fold.
            FoldColumns {
                if let hero = heroPlan {
                    TodayHero(plan: hero, isActive: heroIsActive, today: recovery?.today)
                }
            } trailing: {
                if let week = recovery?.week, !week.isEmpty {
                    WeekLedger(week: week, todayDate: recovery?.today?.date)
                }
                SavedPlansLedger(plans: plans, recovery: recovery)
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .measuresFold()
        .scrollIndicators(.hidden)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    CoachCompose.request(PlansPresentation.newPlanDraft)
                } label: {
                    Label("New plan with Coach", systemImage: "plus")
                }
                .tint(Theme.Palette.accent)
            }
        }
    }
}

enum CoachCompose {
    static func request(_ draft: String) {
        NotificationCenter.default.post(name: .coachComposeRequested, object: draft)
    }
}

/// Press feedback for tappable cards: a slight sink and dim, so a card
/// reads as a button without extra chrome.
struct PressableCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

/// Zone shown as a square mark plus words, never colour alone.
private struct BandChip: View {
    let score: Double
    let band: RecoveryBand

    var body: some View {
        HStack(spacing: 6) {
            Rectangle().fill(band.color).frame(width: 9, height: 9)
            Text("Recovery \(PlansPresentation.percent(score)) · \(band.label)")
                .font(Theme.FontStyle.sans(13))
                .foregroundStyle(Theme.Palette.fg1)
                .lineLimit(1)
        }
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Recovery \(Int(score.rounded())) percent, \(band.label)")
    }
}

private struct TodayHero: View {
    let plan: WorkoutPlan
    let isActive: Bool
    let today: PlanRecovery.Today?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var band: RecoveryBand? {
        guard let today else { return nil }
        return RecoveryBand(serverBand: today.band, score: today.recoveryScore)
    }

    private var sessions: [(number: Int, day: WorkoutPlan.Day)] {
        zip(PlansPresentation.sessionNumbers(plan.plan.days), plan.plan.days)
            .compactMap { number, day in number.map { ($0, day) } }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        heroTitle
                        Spacer(minLength: 8)
                        heroChip
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        heroTitle
                        heroChip
                    }
                }

                Text(plan.title)
                    .font(Theme.FontStyle.sans(26, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)
                    .accessibilityAddTraits(.isHeader)

                Text(subtitle)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)

                if let band {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(band.color)
                            .padding(.top, 2)
                            .accessibilityHidden(true)
                        Text(band.guidance)
                            .font(Theme.FontStyle.sans(15))
                            .foregroundStyle(Theme.Palette.fg1)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(Theme.Spacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.Palette.bg2)
                    .overlay(Rectangle().strokeBorder(CoachLedger.rule, lineWidth: 1))
                    .padding(.top, 16)
                } else if let why = plan.plan.why ?? plan.description {
                    Text(why)
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg1)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 16)
                }
            }
            .padding(Theme.Spacing.md)

            ForEach(Array(sessions.enumerated()), id: \.offset) { _, entry in
                CoachLedgerRule()
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("\(entry.number)")
                        .font(Theme.FontStyle.mono(13))
                        .foregroundStyle(Theme.Palette.fg3)
                        .frame(width: 20, alignment: .leading)
                    Text(entry.day.name)
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg0)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    IntensityMark(intensity: entry.day.intensity)
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.vertical, 12)
                .frame(minHeight: 44)
                .accessibilityElement(children: .combine)
            }

            CoachLedgerRule()
            heroActions
        }
        .coachLedgerOutline()
    }

    private var heroTitle: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(isActive ? "Today" : "Most recent plan")
                .font(Theme.FontStyle.sans(15, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            if let date = today.flatMap({ PlansPresentation.dayParts($0.date) }) {
                Text("\(date.weekday), \(date.day)")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
    }

    @ViewBuilder
    private var heroChip: some View {
        if let today, let band {
            BandChip(score: today.recoveryScore, band: band)
        }
    }

    private var subtitle: String {
        var parts = [PlansPresentation.countText(plan)]
        if let tag = plan.tag { parts.append(tag) }
        return parts.joined(separator: " · ")
    }

    private var needsEasierDay: Bool { band == .mid || band == .low }

    private var askDraft: String {
        guard let today else { return PlansPresentation.askDraft(planTitle: plan.title, score: nil) }
        return needsEasierDay
            ? PlansPresentation.swapDraft(planTitle: plan.title, score: today.recoveryScore)
            : PlansPresentation.askDraft(planTitle: plan.title, score: today.recoveryScore)
    }

    @ViewBuilder
    private var heroActions: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 0))
            : AnyLayout(HStackLayout(spacing: 0))
        layout {
            Button {
                CoachCompose.request(askDraft)
            } label: {
                Label(needsEasierDay ? "Swap for Zone 2" : "Ask Coach", systemImage: "bubble.left")
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.accent)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .contentShape(Rectangle())
            }
            .buttonStyle(ChatPressStyle())
            .accessibilityHint("Opens Coach with a draft message. Nothing is sent until you send it.")

            if dynamicTypeSize.isAccessibilitySize {
                CoachLedgerRule()
            } else {
                Rectangle().fill(CoachLedger.rule).frame(width: 1, height: 52)
            }

            NavigationLink {
                PlanDetailView(plan: plan, recovery: today.map { PlanRecovery(today: $0, week: []) })
            } label: {
                HStack(spacing: 6) {
                    Text("Open plan")
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                }
                .font(Theme.FontStyle.sans(15, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
                .frame(maxWidth: .infinity, minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(ChatPressStyle())
        }
    }
}

/// Intensity as a square mark plus its word.
struct IntensityMark: View {
    let intensity: WorkoutPlan.Intensity

    var body: some View {
        HStack(spacing: 6) {
            Rectangle().fill(intensity.color).frame(width: 9, height: 9)
            Text(intensity.label)
                .font(Theme.FontStyle.sans(13))
                .foregroundStyle(Theme.Palette.fg2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(intensity.label) intensity")
    }
}

private struct WeekLedger: View {
    let week: [PlanRecovery.Day]
    let todayDate: String?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var slots: [PlanRecovery.Day] { Array(week.suffix(7)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("This week")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                if let range = PlansPresentation.weekRange(slots) {
                    Text(range)
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                Spacer(minLength: 8)
                if !dynamicTypeSize.isAccessibilitySize {
                    Text("daily recovery")
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            .padding(Theme.Spacing.md)
            .accessibilityAddTraits(.isHeader)

            ForEach(Array(slots.enumerated()), id: \.offset) { _, day in
                CoachLedgerRule()
                row(day)
            }
        }
        .coachLedgerOutline()
    }

    private func row(_ day: PlanRecovery.Day) -> some View {
        let isToday = day.date == todayDate
        let zone = RecoveryZone(score: day.recoveryScore)
        let parts = PlansPresentation.dayParts(day.date)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text(parts?.weekday ?? "·")
                    .font(Theme.FontStyle.sans(15, weight: isToday ? .semibold : .regular))
                    .foregroundStyle(Theme.Palette.fg0)
                Text(parts?.day ?? "")
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            .frame(width: 64, alignment: .leading)
            if isToday {
                Text("Today")
                    .font(Theme.FontStyle.sans(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.accent)
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Rectangle().fill(zone.color).frame(width: 9, height: 9)
                Text("\(Int(day.recoveryScore.rounded()))%")
                    .font(Theme.FontStyle.mono(14, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                Text(zone.label)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 8)
        .frame(minHeight: 48)
        .background(isToday ? Theme.Palette.bg3 : .clear)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(parts?.weekday ?? "") \(parts?.day ?? ""), recovery \(Int(day.recoveryScore.rounded())) percent, \(zone.label)\(isToday ? ", today" : "")")
    }
}

private struct SavedPlansLedger: View {
    let plans: [WorkoutPlan]
    let recovery: PlanRecovery?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Saved plans")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                Spacer()
                Text("\(plans.count)")
                    .font(Theme.FontStyle.mono(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            .padding(Theme.Spacing.md)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            ForEach(plans) { plan in
                CoachLedgerRule()
                NavigationLink {
                    PlanDetailView(plan: plan, recovery: recovery)
                } label: {
                    SavedPlanRow(plan: plan)
                }
                .buttonStyle(ChatPressStyle())
            }
        }
        .coachLedgerOutline()
    }
}

private struct SavedPlanRow: View {
    let plan: WorkoutPlan

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 3) {
                Text(plan.title)
                    .font(Theme.FontStyle.sans(17, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .multilineTextAlignment(.leading)
                Text(PlansPresentation.savedMeta(plan))
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            if plan.isActive { ActiveTag() }
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 12)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct ActiveTag: View {
    var body: some View {
        Text("Active")
            .font(Theme.FontStyle.sans(12, weight: .medium))
            .foregroundStyle(Theme.Palette.recovery)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .overlay(Rectangle().strokeBorder(Theme.Palette.recovery, lineWidth: 1))
    }
}

#Preview("Plans — sample") {
    NavigationStack {
        PlansContent(plans: PlansSample.plans, recovery: PlansSample.recovery)
            .navigationTitle("Plans")
    }
    .preferredColorScheme(.dark)
}

#Preview("Plans — live") {
    PlansView()
}
