import Foundation

struct WorkoutsPayload: Decodable {
    let rangeLabel: String
    let totalCount: Int
    let truncated: Bool
    let sportFrequency: [SportFreq]
    let zoneBreakdownRecent: [ZoneBreakdown]
    let distanceRecent: [DistanceRow]
    let workouts: [WorkoutRow]

    struct SportFreq: Decodable, Identifiable {
        let sport: String
        let sessions: Int
        let kj: Double
        let durationMin: Double
        let colorHex: String

        var id: String { sport }

        enum CodingKeys: String, CodingKey {
            case sport, sessions, kj
            case durationMin = "duration_min"
            case colorHex = "color_hex"
        }
    }

    struct ZoneBreakdown: Decodable, Identifiable {
        let workoutId: String
        let date: String
        let sport: String?
        let zones: Zones

        var id: String { workoutId }

        struct Zones: Decodable {
            let z0Pct: Double
            let z1Pct: Double
            let z2Pct: Double
            let z3Pct: Double
            let z4Pct: Double
            let z5Pct: Double
            let totalMs: Double

            enum CodingKeys: String, CodingKey {
                case z0Pct = "z0_pct"
                case z1Pct = "z1_pct"
                case z2Pct = "z2_pct"
                case z3Pct = "z3_pct"
                case z4Pct = "z4_pct"
                case z5Pct = "z5_pct"
                case totalMs = "total_ms"
            }
        }

        enum CodingKeys: String, CodingKey {
            case workoutId = "workout_id"
            case date, sport, zones
        }
    }

    struct DistanceRow: Decodable, Identifiable {
        let workoutId: String
        let date: String
        let sport: String?
        let distanceKm: Double

        var id: String { workoutId }

        enum CodingKeys: String, CodingKey {
            case workoutId = "workout_id"
            case date, sport
            case distanceKm = "distance_km"
        }
    }

    struct WorkoutRow: Decodable, Identifiable {
        let id: String
        let date: String
        let sport: String?
        let durationSec: Double?
        let avgHr: Double?
        let maxHr: Double?
        let strain: Double?
        let kilojoule: Double?
        let distanceM: Double?
        let startUtc: String?
        let endUtc: String?

        enum CodingKeys: String, CodingKey {
            case id, date, sport, strain, kilojoule
            case durationSec = "duration_sec"
            case avgHr = "avg_hr"
            case maxHr = "max_hr"
            case distanceM = "distance_m"
            case startUtc = "start_utc"
            case endUtc = "end_utc"
        }
    }

    enum CodingKeys: String, CodingKey {
        case rangeLabel = "range_label"
        case totalCount = "total_count"
        case truncated
        case sportFrequency = "sport_frequency"
        case zoneBreakdownRecent = "zone_breakdown_recent"
        case distanceRecent = "distance_recent"
        case workouts
    }
}
