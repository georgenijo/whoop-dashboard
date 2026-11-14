import Foundation

/// Pure formatting for the Plans screens, kept out of the views for tests.
enum PlansPresentation {
    /// "Mon" and "Nov 9" for a calendar date like "2026-11-09".
    static func dayParts(_ date: String) -> (weekday: String, day: String)? {
        guard let parsed = ChartDate.parse(String(date.prefix(10))) else { return nil }
        return (
            parsed.formatted(.dateTime.weekday(.abbreviated)),
            parsed.formatted(.dateTime.month(.abbreviated).day())
        )
    }

    /// "Nov 9 – Nov 15" for the first and last day of a week. Weekdays are
    /// named elsewhere ("Tue", "Thu"), never reduced to one letter.
    static func weekRange(_ days: [PlanRecovery.Day]) -> String? {
        guard let first = days.first.flatMap({ dayParts($0.date) }),
              let last = days.last.flatMap({ dayParts($0.date) }) else { return nil }
        return "\(first.day) – \(last.day)"
    }

    static func instant(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    static func monthDay(_ iso: String) -> String? {
        instant(iso)?.formatted(.dateTime.month(.abbreviated).day())
    }

    /// Sessions are the days that have something to do; rest days stay in the
    /// list but are not numbered.
    static func isSession(_ day: WorkoutPlan.Day) -> Bool {
        day.intensity != .rest && !day.exercises.isEmpty
    }

    /// 1-based session numbers aligned with `days`; nil for rest days.
    static func sessionNumbers(_ days: [WorkoutPlan.Day]) -> [Int?] {
        var next = 0
        return days.map { day in
            guard isSession(day) else { return nil }
            next += 1
            return next
        }
    }

    static func sessionCount(_ plan: WorkoutPlan) -> Int {
        plan.plan.days.filter(isSession).count
    }

    static func countText(_ plan: WorkoutPlan) -> String {
        let count = sessionCount(plan)
        return "\(count) session\(count == 1 ? "" : "s")"
    }

    static func authorText(_ author: WorkoutPlan.Author) -> String? {
        switch author {
        case .coach: return "by Coach"
        case .user: return "by you"
        case .unknown: return nil
        }
    }

    /// "4 sessions · by Coach · updated Nov 2"
    static func savedMeta(_ plan: WorkoutPlan) -> String {
        var parts = [countText(plan)]
        if let author = authorText(plan.createdBy) { parts.append(author) }
        if let updated = monthDay(plan.updatedAt) { parts.append("updated \(updated)") }
        return parts.joined(separator: " · ")
    }

    /// "Made by Coach on Nov 2 · updated Nov 9"
    static func provenance(_ plan: WorkoutPlan) -> String? {
        var parts: [String] = []
        let created = monthDay(plan.createdAt)
        switch (plan.createdBy, created) {
        case (.coach, let date?): parts.append("Made by Coach on \(date)")
        case (.user, let date?): parts.append("Made by you on \(date)")
        case (.coach, nil): parts.append("Made by Coach")
        case (.user, nil): parts.append("Made by you")
        case (.unknown, let date?): parts.append("Created \(date)")
        case (.unknown, nil): break
        }
        if let updated = monthDay(plan.updatedAt), updated != created { parts.append("updated \(updated)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The first few exercise names, then how many more.
    static func exerciseSummary(_ day: WorkoutPlan.Day, limit: Int = 4) -> String {
        let names = day.exercises.map(\.name)
        guard names.count > limit else { return names.joined(separator: ", ") }
        return names.prefix(limit).joined(separator: ", ") + " +\(names.count - limit)"
    }

    static func percent(_ value: Double) -> String { "\(Int(value.rounded()))%" }

    static func signedPercent(_ value: Double) -> String {
        let rounded = Int(value.rounded())
        return rounded > 0 ? "+\(rounded)%" : "\(rounded)%"
    }

    /// Coach drafts. Both only pre-fill the composer; nothing is sent.
    static func swapDraft(planTitle: String, score: Double) -> String {
        "My recovery is \(percent(score)) today. Swap today's session in my \"\(planTitle)\" plan for a Zone 2 session and tell me why."
    }

    static func askDraft(planTitle: String, score: Double?) -> String {
        if let score {
            return "My recovery is \(percent(score)) today. Is today's session in my \"\(planTitle)\" plan still the right call?"
        }
        return "Is today's session in my \"\(planTitle)\" plan still the right call?"
    }

    static func adjustDraft(planTitle: String) -> String {
        "I'd like to adjust my \"\(planTitle)\" plan. Ask what I want to change first."
    }

    static let newPlanDraft = "Help me build a training plan that adjusts to my recovery. Ask about my goals, schedule and available equipment first."
}
