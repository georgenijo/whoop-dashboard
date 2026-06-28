import Foundation

struct StatsPayload: Decodable {
    let rangeLabel: String
    let allTime: AllTime
    let yoy: YoY
    let bySport: [SportCount]
    let records: [Record]
    let trend: [TrendMonth]
    let historyFloor: String

    struct AllTime: Decodable {
        let workouts: Int
        let activeSeconds: Double?
        let distanceM: Double?
        let kilojoules: Double?

        enum CodingKeys: String, CodingKey {
            case workouts
            case activeSeconds = "active_seconds"
            case distanceM = "distance_m"
            case kilojoules
        }
    }

    struct YoY: Decodable {
        let year: Int
        let priorYear: Int
        let periodLabel: String
        let metrics: [Metric]

        enum CodingKeys: String, CodingKey {
            case year
            case priorYear = "prior_year"
            case periodLabel = "period_label"
            case metrics
        }

        struct Metric: Decodable, Identifiable {
            let key: String
            let label: String
            let current: Double?
            let prior: Double?
            let delta: Double?
            let unit: String
            let spark: [Double]

            var id: String { key }
        }
    }

    struct SportCount: Decodable, Identifiable {
        let sport: String
        let count: Int
        let colorHex: String

        var id: String { sport }

        enum CodingKeys: String, CodingKey {
            case sport, count
            case colorHex = "color_hex"
        }
    }

    struct Record: Decodable, Identifiable {
        let key: String
        let label: String
        let valueDisplay: String
        let meta: String?

        var id: String { key }

        enum CodingKeys: String, CodingKey {
            case key, label, meta
            case valueDisplay = "value_display"
        }
    }

    struct TrendMonth: Decodable, Identifiable {
        let month: String
        let count: Int
        let avgStrain: Double?
        let partial: Bool

        var id: String { month }

        enum CodingKeys: String, CodingKey {
            case month, count, partial
            case avgStrain = "avg_strain"
        }
    }

    enum CodingKeys: String, CodingKey {
        case rangeLabel = "range_label"
        case allTime = "all_time"
        case yoy
        case bySport = "by_sport"
        case records
        case trend
        case historyFloor = "history_floor"
    }
}
