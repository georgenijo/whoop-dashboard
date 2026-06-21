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
        case loaded([WorkoutPlan])
        case error(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Plans") {
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
            guard newPhase == .active, !isLoading else { return }
            if let last = lastFetched, Date().timeIntervalSince(last) < Self.staleInterval { return }
            Task { await load(showSpinner: false) }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let plans):
            if plans.isEmpty {
                emptyState
            } else {
                PlansContent(plans: plans)
            }
        case .error(let message):
            VStack(spacing: 12) {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("Retry") { Task { await load(showSpinner: true) } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Palette.recovery)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Theme.Palette.recovery.opacity(0.12))
                    .frame(width: 80, height: 80)
                Image(systemName: "figure.strengthtraining.traditional")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(Theme.Palette.recovery)
            }
            Text("No plans yet")
                .font(Theme.FontStyle.sans(16, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
            Text("Ask the coach to build you a recovery-tuned split.")
                .font(Theme.FontStyle.sans(12))
                .foregroundStyle(Theme.Palette.fg2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
            let plans = try await PlansService(api: api).load()
            phase = .loaded(plans)
            lastFetched = Date()
        } catch APIError.unauthorized {
            if !hadData { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadData { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadData { phase = .error("Server error (\(code))") }
        } catch APIError.decode {
            if !hadData { phase = .error("Bad response from server") }
        } catch APIError.badResponse {
            if !hadData { phase = .error("Bad response from server") }
        } catch {
            if !hadData { phase = .error("Could not load plans") }
        }
    }
}

struct PlansContent: View {
    let plans: [WorkoutPlan]

    private var activePlan: WorkoutPlan? {
        plans.first(where: { $0.isActive }) ?? plans.first
    }

    private var savedPlans: [WorkoutPlan] {
        guard let active = activePlan else { return plans }
        return plans.filter { $0.id != active.id }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                if let active = activePlan {
                    TodaySessionHero(plan: active)
                    WeekReadinessStrip(plan: active)
                }

                if !savedPlans.isEmpty {
                    Text("SAVED SPLITS")
                        .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg3)
                        .padding(.top, 6)
                        .padding(.leading, 4)

                    VStack(spacing: 8) {
                        ForEach(savedPlans) { plan in
                            NavigationLink {
                                PlanDetailView(plan: plan)
                            } label: {
                                SplitRow(plan: plan)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding()
        }
    }
}

private func todayDay(in plan: WorkoutPlan) -> WorkoutPlan.Day? {
    guard !plan.plan.days.isEmpty else { return nil }
    let weekday = Calendar.current.component(.weekday, from: Date())
    let index = (weekday - 1) % plan.plan.days.count
    return plan.plan.days[index]
}

private struct TodaySessionHero: View {
    let plan: WorkoutPlan

    private var day: WorkoutPlan.Day? { todayDay(in: plan) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("TODAY'S SESSION")
                    .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                if let score = plan.recoveryContext?.recoveryScore {
                    ZonePill(score: score, prefix: "\(Int(score.rounded()))%")
                } else if let day {
                    IntensityTag(intensity: day.intensity)
                }
            }

            if let day {
                Text(day.name)
                    .font(Theme.FontStyle.sans(21, weight: .bold))
                    .foregroundStyle(Theme.Palette.fg0)
                    .padding(.top, 12)

                if let line = sessionLine(day) {
                    Text(line)
                        .font(Theme.FontStyle.sans(12.5))
                        .foregroundStyle(Theme.Palette.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                }

                HStack(spacing: 8) {
                    MetaTag(text: "\(day.exercises.count) lifts")
                    IntensityTag(intensity: day.intensity)
                    if let focus = day.focus {
                        MetaTag(text: focus)
                    }
                }
                .padding(.top, 14)
            } else {
                Text("Rest day")
                    .font(Theme.FontStyle.sans(21, weight: .bold))
                    .foregroundStyle(Theme.Palette.fg0)
                    .padding(.top, 12)
            }
        }
        .glassCard(tint: .recovery, padding: 18)
    }

    private func sessionLine(_ day: WorkoutPlan.Day) -> String? {
        if let note = plan.recoveryContext?.note { return note }
        if let why = plan.plan.why { return why }
        return day.focus
    }
}

private struct WeekReadinessStrip: View {
    let plan: WorkoutPlan

    private let labels = ["M", "T", "W", "T", "F", "S", "S"]

    private var todayIndex: Int {
        (Calendar.current.component(.weekday, from: Date()) + 5) % 7
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("THIS WEEK")
                .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)

            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    let day = dayForSlot(i)
                    VStack(spacing: 6) {
                        Text(labels[i])
                            .font(Theme.FontStyle.sans(9.5, weight: i == todayIndex ? .bold : .medium))
                            .foregroundStyle(i == todayIndex ? Theme.Palette.fg0 : Theme.Palette.fg3)
                        readinessDot(day: day, isToday: i == todayIndex)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.top, 12)
        }
        .padding(14)
        .background(Color.white.opacity(0.025))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }

    private func dayForSlot(_ i: Int) -> WorkoutPlan.Day? {
        guard !plan.plan.days.isEmpty else { return nil }
        return plan.plan.days[i % plan.plan.days.count]
    }

    @ViewBuilder
    private func readinessDot(day: WorkoutPlan.Day?, isToday: Bool) -> some View {
        let color = day.map { Color(hex: $0.intensity.colorHex) } ?? Theme.Palette.fg4
        Circle()
            .fill(color.opacity(0.18))
            .overlay(
                Circle().strokeBorder(color.opacity(0.5), lineWidth: 1.5)
            )
            .frame(width: 22, height: 22)
            .shadow(color: isToday ? color.opacity(0.5) : .clear, radius: isToday ? 6 : 0)
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
        HStack(spacing: 12) {
            Circle()
                .fill(accent)
                .frame(width: 8, height: 8)
                .shadow(color: accent.opacity(0.6), radius: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(plan.title)
                    .font(Theme.FontStyle.sans(13.5, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                    .lineLimit(1)
                Text(meta)
                    .font(Theme.FontStyle.sans(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.white.opacity(0.025))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .contentShape(Rectangle())
    }
}

private struct MetaTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.FontStyle.sans(10.5, weight: .semibold))
            .foregroundStyle(Theme.Palette.fg2)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.white.opacity(0.05), in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1))
    }
}

private struct IntensityTag: View {
    let intensity: WorkoutPlan.Intensity

    var body: some View {
        let color = Color(hex: intensity.colorHex)
        Text(intensity.label)
            .font(Theme.FontStyle.sans(10.5, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(color.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.35), lineWidth: 1))
    }
}

#Preview("Plans — sample") {
    NavigationStack {
        VStack(spacing: 0) {
            PageHeader("Plans") {
                Circle()
                    .fill(Theme.Palette.recovery)
                    .frame(width: 8, height: 8)
            }
            PlansContent(plans: PlansSample.plans)
        }
    }
    .preferredColorScheme(.dark)
}

#Preview("Plans — live") {
    PlansView()
}
