import Foundation

struct DashboardPayload: Decodable {
    let dataDate: String?
    let isFallback: Bool
    let recoveryHero: RecoveryHero
    let aiInsight: AIInsight?
    /// A brief is being written for this user right now. Absent on servers that predate the field.
    var insightRefreshing = false
    /// Error class of the last failed generation while it is in backoff.
    var insightError: String?
    let kpi: [KPITile]
    let prs: PRs
    let recoveryTrend: [TrendPoint]

    struct RecoveryHero: Decodable {
        let score: Double?
        let hrvMs: Double?
        let rhrBpm: Double?
        let updatedAt: String?

        enum CodingKeys: String, CodingKey {
            case score
            case hrvMs = "hrv_ms"
            case rhrBpm = "rhr_bpm"
            case updatedAt = "updated_at"
        }
    }

    struct AIInsight: Decodable {
        let text: String?
        let createdAt: String?
        let isStale: Bool

        /// Old or undated advice must not read as today's recommendation.
        var isCurrent: Bool {
            !isStale && InsightDate.parse(createdAt).map { Calendar.current.isDateInToday($0) } == true
        }

        enum CodingKeys: String, CodingKey {
            case text
            case createdAt = "created_at"
            case isStale = "is_stale"
        }
    }

    struct PRs: Decodable {
        let bestHrv: ValueDateRow?
        let lowestRhr: ValueDateRow?
        let recoveryStreak: StreakRow?
        let sleepPerfStreak: StreakRow?
        let loggingStreak: StreakRow?

        enum CodingKeys: String, CodingKey {
            case bestHrv = "best_hrv"
            case lowestRhr = "lowest_rhr"
            case recoveryStreak = "recovery_streak"
            case sleepPerfStreak = "sleep_perf_streak"
            case loggingStreak = "logging_streak"
        }
    }

    struct ValueDateRow: Decodable {
        let value: Double
        let date: String
    }

    struct StreakRow: Decodable {
        let count: Int
        let startDate: String
        let endDate: String

        enum CodingKeys: String, CodingKey {
            case count
            case startDate = "start_date"
            case endDate = "end_date"
        }
    }

    enum CodingKeys: String, CodingKey {
        case dataDate = "data_date"
        case isFallback = "is_fallback"
        case recoveryHero = "recovery_hero"
        case aiInsight = "ai_insight"
        case insightRefreshing = "insight_refreshing"
        case insightError = "insight_error"
        case kpi
        case prs
        case recoveryTrend = "recovery_trend"
    }
}

extension DashboardPayload {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dataDate = try c.decodeIfPresent(String.self, forKey: .dataDate)
        isFallback = try c.decode(Bool.self, forKey: .isFallback)
        recoveryHero = try c.decode(RecoveryHero.self, forKey: .recoveryHero)
        aiInsight = try c.decodeIfPresent(AIInsight.self, forKey: .aiInsight)
        insightRefreshing = try c.decodeIfPresent(Bool.self, forKey: .insightRefreshing) ?? false
        insightError = try c.decodeIfPresent(String.self, forKey: .insightError)
        kpi = try c.decode([KPITile].self, forKey: .kpi)
        prs = try c.decode(PRs.self, forKey: .prs)
        recoveryTrend = try c.decode([TrendPoint].self, forKey: .recoveryTrend)
    }
}

/// While the server is writing today's brief, Today re-fetches on a short,
/// bounded schedule and then stops; it never polls indefinitely.
enum BriefRefreshSchedule {
    /// Offsets from the moment polling is armed, not gaps between attempts.
    static let delays: [TimeInterval] = [6, 12, 24, 48]

    static func delay(afterAttempt attempt: Int) -> TimeInterval? {
        delays.indices.contains(attempt) ? delays[attempt] : nil
    }
}

/// Deadlines for brief polling, anchored to when polling was armed so a slow
/// request never pushes later attempts out.
struct BriefPollSchedule {
    private(set) var armedAt: Date?
    private(set) var attempts = 0

    mutating func arm(at date: Date) {
        armedAt = date
        attempts = 0
    }

    mutating func disarm() { armedAt = nil }

    /// Nil when disarmed or after the fourth attempt.
    var nextDeadline: Date? {
        guard let armedAt, let offset = BriefRefreshSchedule.delay(afterAttempt: attempts) else { return nil }
        return armedAt.addingTimeInterval(offset)
    }

    mutating func recordAttempt() { attempts += 1 }
}

/// Decides which dashboard loads may start and whose result is applied.
/// An explicit load (first load, pull to refresh, retry, sync, foreground) is
/// always applied unless a newer one replaced it; a brief poll never starts
/// while an explicit load is in flight, never surfaces a failure, and is
/// discarded if anything newer began after it.
struct DashboardLoadCoordinator {
    private(set) var generation = 0
    private(set) var explicitInFlight = 0

    mutating func beginExplicit() -> Int {
        explicitInFlight += 1
        generation += 1
        return generation
    }

    mutating func endExplicit() {
        explicitInFlight = max(0, explicitInFlight - 1)
    }

    mutating func beginPoll() -> Int? {
        guard explicitInFlight == 0 else { return nil }
        generation += 1
        return generation
    }

    func isCurrent(_ token: Int) -> Bool { token == generation }

    func shouldSurfaceFailure(token: Int, polling: Bool) -> Bool {
        !polling && isCurrent(token)
    }
}
