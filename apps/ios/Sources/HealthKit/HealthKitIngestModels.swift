import Foundation

struct HealthKitHRSeries: Encodable {
    let intervalSec: Int
    let startOffsetSec: Int
    let bpm: [Int?]

    enum CodingKeys: String, CodingKey {
        case intervalSec = "interval_sec"
        case startOffsetSec = "start_offset_sec"
        case bpm
    }
}

struct HealthKitIngestWorkout: Encodable {
    let externalId: String
    let sport: String
    let start: String
    let end: String
    let sourceName: String?
    let kilojoule: Double?
    let distanceM: Double?
    let avgHr: Int?
    let maxHr: Int?
    let hrSeries: HealthKitHRSeries?

    enum CodingKeys: String, CodingKey {
        case externalId = "external_id"
        case sport
        case start
        case end
        case sourceName = "source_name"
        case kilojoule
        case distanceM = "distance_m"
        case avgHr = "avg_hr"
        case maxHr = "max_hr"
        case hrSeries = "hr_series"
    }
}

struct HealthKitIngestDaily: Encodable {
    let date: String
    let steps: Int
}

struct HealthKitIngestRequest: Encodable {
    let workouts: [HealthKitIngestWorkout]
    let daily: [HealthKitIngestDaily]
}

struct HealthKitIngestResponse: Decodable {
    let matched: Int
    let inserted: Int
    let enriched: Int
    let skipped: Int
    let steps: StepsResult?

    struct StepsResult: Decodable {
        let upserted: Int
        let skipped: Int
    }
}
