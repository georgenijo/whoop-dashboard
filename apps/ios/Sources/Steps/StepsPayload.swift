import Foundation

struct StepsPayload: Decodable {
    let rangeLabel: String
    let kpi: [KPITile]
    let stepsTrend: [TrendPoint]
    let today: Today

    struct Today: Decodable {
        let date: String
        let steps: Double?
        let vs7dAvg: Double?

        enum CodingKeys: String, CodingKey {
            case date, steps
            case vs7dAvg = "vs_7d_avg"
        }
    }

    enum CodingKeys: String, CodingKey {
        case rangeLabel = "range_label"
        case kpi
        case stepsTrend = "steps_trend"
        case today
    }
}
