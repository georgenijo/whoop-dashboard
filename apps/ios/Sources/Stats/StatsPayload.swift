import Foundation

struct StatsPayload: Decodable {
    let rangeLabel: String
    let allTime: AllTime
    let yoy: YoY
    let bySport: [SportCount]
    let records: [Record]
    let trend: [TrendMonth]
    let historyFloor: String?

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

extension StatsPayload {
    static let placeholder = StatsPayload(
        rangeLabel: "Last 90 days",
        allTime: AllTime(workouts: 871, activeSeconds: 4_078_800, distanceM: 1_697_000, kilojoules: 927_367),
        yoy: YoY(
            year: 2026,
            priorYear: 2025,
            periodLabel: "Jan 1 – Sep 26",
            metrics: [
                .init(key: "workouts", label: "Workouts", current: 221, prior: 65, delta: 156, unit: "", spark: []),
                .init(key: "distance", label: "Distance", current: 47.2, prior: 99.2, delta: -52, unit: "mi", spark: []),
                .init(key: "active_hours", label: "Active hours", current: 153, prior: 86.4, delta: 66.6, unit: "h", spark: []),
                .init(key: "calories", label: "Calories", current: 55_327, prior: 16_155, delta: 39_172, unit: "cal", spark: []),
            ]
        ),
        bySport: [
            .init(sport: "weightlifting", count: 13, colorHex: "#7b61ff"),
            .init(sport: "running", count: 6, colorHex: "#ff7a1a"),
            .init(sport: "soccer", count: 4, colorHex: "#00d4aa"),
        ],
        records: [
            .init(key: "longest_session", label: "Longest session", valueDisplay: "2:10", meta: "walking · Aug 19, 2024"),
            .init(key: "most_calories", label: "Most calories", valueDisplay: "1,972 cal", meta: "soccer · Jul 25, 2026"),
            .init(key: "highest_strain", label: "Highest strain", valueDisplay: "20.0", meta: "soccer · Jul 25, 2026"),
        ],
        trend: [
            .init(month: "2026-07", count: 30, avgStrain: 9.1, partial: false),
            .init(month: "2026-08", count: 24, avgStrain: 8.4, partial: false),
            .init(month: "2026-09", count: 40, avgStrain: 7.4, partial: true),
        ],
        historyFloor: "2019-12-10"
    )
}
