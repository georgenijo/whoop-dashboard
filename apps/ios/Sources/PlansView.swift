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
            VStack(spacing: 0) {
                PageHeader("Plans")
                content
            }
            .toolbar(.hidden, for: .navigationBar)
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
                        .padding(.horizontal, Theme.Spacing.md)
                }
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
                .padding(Theme.Spacing.md)
            }
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
            Text("Ask the coach to build you a recovery-tuned split. Saved plans show up here with today's session up top.")
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg2)
                .fixedSize(horizontal: false, vertical: true)
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

    private var savedPlans: [WorkoutPlan] {
        guard let hero = heroPlan else { return plans }
        return plans.filter { $0.id != hero.id }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                if let hero = heroPlan {
                    TodaySessionHero(plan: hero, isActive: heroIsActive, today: recovery?.today)

                    if let week = recovery?.week, !week.isEmpty {
                        WeekReadinessStrip(week: week, todayDate: recovery?.today?.date)
                    }
                }

                if !savedPlans.isEmpty {
                    CardLabel("Saved splits")
                        .padding(.top, Theme.Spacing.md)
                        .padding(.leading, 4)

                    VStack(spacing: Theme.Spacing.xs) {
                        ForEach(savedPlans) { plan in
                            NavigationLink {
                                PlanDetailView(plan: plan)
                            } label: {
                                SplitRow(plan: plan)
                            }
                            .buttonStyle(PressableCardStyle())
                        }
                    }
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .scrollIndicators(.hidden)
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

private struct TodaySessionHero: View {
    let plan: WorkoutPlan
    let isActive: Bool
    let today: PlanRecovery.Today?

    private var band: RecoveryBand? {
        guard let today else { return nil }
        return RecoveryBand(serverBand: today.band, score: today.recoveryScore)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                CardLabel(isActive ? "Today's session" : "Most recent plan")
                Spacer()
                if let today {
                    ReadinessPill(score: today.recoveryScore)
                }
            }

            Text(plan.title)
                .font(Theme.FontStyle.sans(24, weight: .bold))
                .foregroundStyle(Theme.Palette.fg0)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)

            if let line = sessionLine {
                Text(line)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg1)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
            }

            HStack(spacing: Theme.Spacing.xs) {
                MetaTag(text: "\(plan.plan.days.count)-day")
                if let tag = plan.tag {
                    MetaTag(text: tag)
                }
            }
            .padding(.top, 14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(tint: .recovery, padding: Theme.Spacing.lg)
        .accessibilityElement(children: .combine)
    }

    private var sessionLine: String? {
        if let band { return band.guidance }
        if let why = plan.plan.why { return why }
        return plan.description
    }
}

private struct ReadinessPill: View {
    let score: Double

    var body: some View {
        let zone = RecoveryZone(score: score)
        HStack(spacing: 6) {
            Circle()
                .fill(zone.color)
                .frame(width: 6, height: 6)
            Text("\(Int(score.rounded()))%")
                .font(Theme.FontStyle.mono(12, weight: .semibold))
            Text(zone.label)
                .font(Theme.FontStyle.sans(12, weight: .medium))
        }
        .foregroundStyle(zone.color)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(zone.color.opacity(0.14), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Recovery \(Int(score.rounded())) percent, \(zone.label)")
    }
}

private struct WeekReadinessStrip: View {
    let week: [PlanRecovery.Day]
    let todayDate: String?

    private var slots: [PlanRecovery.Day] { Array(week.suffix(7)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardLabel("This week")

            HStack(spacing: 0) {
                ForEach(Array(slots.enumerated()), id: \.offset) { _, day in
                    let isToday = day.date == todayDate
                    VStack(spacing: 8) {
                        Text(weekdayLabel(day.date))
                            .font(Theme.FontStyle.sans(11, weight: isToday ? .bold : .medium))
                            .foregroundStyle(isToday ? Theme.Palette.fg0 : Theme.Palette.fg3)
                        readinessDot(score: day.recoveryScore, isToday: isToday)
                        Text("\(Int(day.recoveryScore.rounded()))")
                            .font(Theme.FontStyle.mono(11, weight: isToday ? .semibold : .regular))
                            .foregroundStyle(isToday ? Theme.Palette.fg1 : Theme.Palette.fg3)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(weekdayLabel(day.date)), recovery \(Int(day.recoveryScore.rounded())) percent")
                }
            }
            .padding(.top, 14)
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private func weekdayLabel(_ date: String) -> String {
        let prefix = String(date.prefix(10))
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: prefix) else { return "·" }
        let names = ["S", "M", "T", "W", "T", "F", "S"]
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let weekday = cal.component(.weekday, from: d)
        return names[(weekday - 1) % 7]
    }

    @ViewBuilder
    private func readinessDot(score: Double, isToday: Bool) -> some View {
        let color = Color(hex: RecoveryBand(score: score).colorHex)
        Circle()
            .fill(color.opacity(isToday ? 0.35 : 0.18))
            .overlay(
                Circle().strokeBorder(color.opacity(isToday ? 0.9 : 0.5), lineWidth: 1.5)
            )
            .frame(width: 24, height: 24)
    }
}

private struct SplitRow: View {
    let plan: WorkoutPlan

    private var accent: Color {
        Color(hex: plan.plan.days.first.map { $0.intensity.colorHex } ?? "#7b61ff")
    }

    private var meta: String {
        var parts: [String] = ["\(plan.plan.days.count)-day"]
        if let tag = plan.tag { parts.append(tag) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Capsule()
                .fill(accent)
                .frame(width: 4, height: 32)
            VStack(alignment: .leading, spacing: 3) {
                Text(plan.title)
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                    .lineLimit(1)
                Text(meta)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .frame(minHeight: 44)
        .glassCard(padding: Theme.Spacing.md)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct MetaTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.FontStyle.sans(12, weight: .semibold))
            .foregroundStyle(Theme.Palette.fg2)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Color.white.opacity(0.05), in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1))
    }
}

#Preview("Plans — sample") {
    NavigationStack {
        VStack(spacing: 0) {
            PageHeader("Plans")
            PlansContent(plans: PlansSample.plans, recovery: PlansSample.recovery)
        }
        .toolbar(.hidden, for: .navigationBar)
    }
    .preferredColorScheme(.dark)
}

#Preview("Plans — live") {
    PlansView()
}
