import Foundation

struct StrainPayload: Decodable {
    let rangeLabel: String
    let kpi: [KPITile]
    let today: Today
    let strainTrend: [TrendPoint]
    let avgHrTrend: [TrendPoint]

    struct Today: Decodable {
        let date: String
        let totalKilojoule: Double?
        let totalKcal: Double?
        let avgHr: Double?
        let maxHr: Double?
        let workoutCount: Int
        let workouts: [TodayWorkout]

        enum CodingKeys: String, CodingKey {
            case date
            case totalKilojoule = "total_kilojoule"
            case totalKcal = "total_kcal"
            case avgHr = "avg_hr"
            case maxHr = "max_hr"
            case workoutCount = "workout_count"
            case workouts
        }
    }

    struct TodayWorkout: Decodable, Identifiable {
        let id: String
        let sport: String?
        let startTimeIso: String?
        let durationSec: Double?
        let distanceM: Double?
        let avgHr: Double?
        let maxHr: Double?
        let strain: Double?

        enum CodingKeys: String, CodingKey {
            case id, sport, strain
            case startTimeIso = "start_time_iso"
            case durationSec = "duration_sec"
            case distanceM = "distance_m"
            case avgHr = "avg_hr"
            case maxHr = "max_hr"
        }
    }

    enum CodingKeys: String, CodingKey {
        case rangeLabel = "range_label"
        case kpi
        case today
        case strainTrend = "strain_trend"
        case avgHrTrend = "avg_hr_trend"
    }
}
