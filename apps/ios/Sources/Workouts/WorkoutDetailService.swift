import Foundation

struct WorkoutDetail: Decodable {
    let id: String
    let date: String
    let sport: String?
    let source: String?
    let startLocal: String?
    let endLocal: String?
    let durationSec: Double?
    let strain: Double?
    let avgHr: Int?
    let maxHr: Int?
    let kilojoule: Double?
    let distanceM: Double?
    let zones: Zones?
    let hrSeries: HRSeries?
    let profile: Profile?
    let derived: Derived?

    struct Zones: Decodable {
        let z0Ms: Double
        let z1Ms: Double
        let z2Ms: Double
        let z3Ms: Double
        let z4Ms: Double
        let z5Ms: Double

        enum CodingKeys: String, CodingKey {
            case z0Ms = "z0_ms"
            case z1Ms = "z1_ms"
            case z2Ms = "z2_ms"
            case z3Ms = "z3_ms"
            case z4Ms = "z4_ms"
            case z5Ms = "z5_ms"
        }

        var asArray: [Double] { [z0Ms, z1Ms, z2Ms, z3Ms, z4Ms, z5Ms] }
        var totalMs: Double { asArray.reduce(0, +) }
    }

    struct HRSeries: Decodable {
        let intervalSec: Double
        let startOffsetSec: Double
        let bpm: [Int?]

        enum CodingKeys: String, CodingKey {
            case intervalSec = "interval_sec"
            case startOffsetSec = "start_offset_sec"
            case bpm
        }
    }

    struct Profile: Decodable {
        let maxHr: Int?
        let restingHr: Int?

        enum CodingKeys: String, CodingKey {
            case maxHr = "max_hr"
            case restingHr = "resting_hr"
        }
    }

    struct Derived: Decodable {
        let cardiacDriftPct: Double?
        let recoveryRateBpm: Double?
        let timeAbove90Sec: Double?
        let trimp: Double?

        enum CodingKeys: String, CodingKey {
            case cardiacDriftPct = "cardiac_drift_pct"
            case recoveryRateBpm = "recovery_rate_bpm"
            case timeAbove90Sec = "time_above_90_sec"
            case trimp
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, date, sport, source, strain, kilojoule, zones, profile, derived
        case startLocal = "start_local"
        case endLocal = "end_local"
        case durationSec = "duration_sec"
        case avgHr = "avg_hr"
        case maxHr = "max_hr"
        case distanceM = "distance_m"
        case hrSeries = "hr_series"
    }
}

final class WorkoutDetailService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load(id: String) async throws -> WorkoutDetail {
        try await api.get("/api/ios/workouts/\(id)")
    }
}
