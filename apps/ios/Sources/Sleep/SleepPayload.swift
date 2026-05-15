import Foundation

struct SleepPayload: Decodable {
    let rangeLabel: String
    let kpi: [KPITile]
    let latestSleep: LatestSleep?
    let durationTrend: [DurationPoint]
    let performanceTrend: [TrendPoint]

    struct LatestSleep: Decodable {
        let date: String
        let stages: Stages?
        let needBreakdown: NeedBreakdown?

        struct Stages: Decodable {
            let lightMs: Double
            let deepMs: Double
            let remMs: Double
            let awakeMs: Double

            enum CodingKeys: String, CodingKey {
                case lightMs = "light_ms"
                case deepMs = "deep_ms"
                case remMs = "rem_ms"
                case awakeMs = "awake_ms"
            }
        }

        struct NeedBreakdown: Decodable {
            let baselineMs: Double
            let debtMs: Double
            let strainMs: Double
            let napMs: Double

            enum CodingKeys: String, CodingKey {
                case baselineMs = "baseline_ms"
                case debtMs = "debt_ms"
                case strainMs = "strain_ms"
                case napMs = "nap_ms"
            }
        }

        enum CodingKeys: String, CodingKey {
            case date, stages
            case needBreakdown = "need_breakdown"
        }
    }

    struct DurationPoint: Decodable, Hashable {
        let date: String
        let rawHours: Double?
        let ma7: Double?

        enum CodingKeys: String, CodingKey {
            case date
            case rawHours = "raw_hours"
            case ma7
        }
    }

    enum CodingKeys: String, CodingKey {
        case rangeLabel = "range_label"
        case kpi
        case latestSleep = "latest_sleep"
        case durationTrend = "duration_trend"
        case performanceTrend = "performance_trend"
    }
}
