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
    static let delays: [TimeInterval] = [6, 12, 24, 48]

    static func delay(afterAttempt attempt: Int) -> TimeInterval? {
        delays.indices.contains(attempt) ? delays[attempt] : nil
    }
}
