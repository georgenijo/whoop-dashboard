import Foundation

struct DashboardPayload: Decodable {
    let dataDate: String?
    let isFallback: Bool
    let recoveryHero: RecoveryHero
    let aiInsight: AIInsight?
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
        case kpi
        case prs
        case recoveryTrend = "recovery_trend"
    }
}
