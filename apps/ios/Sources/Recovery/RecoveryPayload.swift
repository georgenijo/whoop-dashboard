import Foundation

struct RecoveryPayload: Decodable {
    let rangeLabel: String
    let kpi: [KPITile]
    let recoveryTrend: [TrendPoint]
    let hrvTrend: HRVTrend
    let rhrTrend: [TrendPoint]
    let spo2Trend: Spo2Trend?

    struct HRVTrend: Decodable {
        let points: [TrendPoint]
        let anomalies: [Anomaly]

        struct Anomaly: Decodable {
            let date: String
            let baselineMs: Double
            let pctBelow: Double

            enum CodingKeys: String, CodingKey {
                case date
                case baselineMs = "baseline_ms"
                case pctBelow = "pct_below"
            }
        }
    }

    struct Spo2Trend: Decodable {
        let points: [Spo2Point]
        let avg: Double?
        let lowest: Double?
        let best: Double?
        let yMin: Double
        let yMax: Double

        struct Spo2Point: Decodable {
            let date: String
            let value: Double?
        }

        enum CodingKeys: String, CodingKey {
            case points, avg, lowest, best
            case yMin = "y_min"
            case yMax = "y_max"
        }
    }

    enum CodingKeys: String, CodingKey {
        case rangeLabel = "range_label"
        case kpi
        case recoveryTrend = "recovery_trend"
        case hrvTrend = "hrv_trend"
        case rhrTrend = "rhr_trend"
        case spo2Trend = "spo2_trend"
    }
}
