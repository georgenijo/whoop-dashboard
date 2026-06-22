import Foundation

struct PlansResponse: Decodable {
    let plans: [WorkoutPlan]
    let recovery: PlanRecovery?
}

enum RecoveryBand {
    case high
    case mid
    case low

    init(score: Double) {
        switch score {
        case ..<34: self = .low
        case ..<67: self = .mid
        default: self = .high
        }
    }

    init(serverBand: String?, score: Double) {
        switch serverBand?.lowercased() {
        case "high": self = .high
        case "mid", "moderate": self = .mid
        case "low": self = .low
        default: self = RecoveryBand(score: score)
        }
    }

    var label: String {
        switch self {
        case .high: return "Primed"
        case .mid: return "Moderate"
        case .low: return "Compromised"
        }
    }

    var guidance: String {
        switch self {
        case .high: return "Recovered — green light for a hard session."
        case .mid: return "Moderate recovery — a steady session is a good call."
        case .low: return "Low recovery — keep it to mobility or rest."
        }
    }

    var colorHex: String {
        switch self {
        case .high: return "#00d4aa"
        case .mid: return "#ffaa00"
        case .low: return "#ff0043"
        }
    }
}

struct PlanRecovery: Decodable, Hashable {
    let today: Today?
    let week: [Day]

    struct Today: Decodable, Hashable {
        let date: String
        let recoveryScore: Double
        let band: String

        enum CodingKeys: String, CodingKey {
            case date
            case recoveryScore = "recovery_score"
            case band
        }
    }

    struct Day: Decodable, Hashable {
        let date: String
        let recoveryScore: Double

        enum CodingKeys: String, CodingKey {
            case date
            case recoveryScore = "recovery_score"
        }
    }

    enum CodingKeys: String, CodingKey {
        case today, week
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        today = try c.decodeIfPresent(Today.self, forKey: .today)
        week = try c.decodeIfPresent([Day].self, forKey: .week) ?? []
    }

    init(today: Today?, week: [Day]) {
        self.today = today
        self.week = week
    }
}

struct WorkoutPlan: Decodable, Identifiable, Hashable {
    let id: Int
    let title: String
    let tag: String?
    let description: String?
    let createdBy: Author
    let isActive: Bool
    let plan: PlanBody
    let recoveryContext: RecoveryContext?
    let createdAt: String
    let updatedAt: String

    enum Author: String, Decodable, Hashable {
        case coach
        case user
        case unknown

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Author(rawValue: raw) ?? .unknown
        }
    }

    struct PlanBody: Decodable, Hashable {
        let days: [Day]
        let why: String?
    }

    struct Day: Decodable, Hashable {
        let name: String
        let focus: String?
        let intensity: Intensity
        let exercises: [Exercise]
    }

    enum Intensity: String, Decodable, Hashable {
        case hard
        case moderate
        case reduced
        case rest
        case unknown

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Intensity(rawValue: raw) ?? .unknown
        }
    }

    struct Exercise: Decodable, Hashable {
        let name: String
        let scheme: String
        let note: String?
    }

    struct RecoveryContext: Decodable, Hashable {
        let recoveryScore: Double?
        let hrvTrendPct: Double?
        let note: String?

        enum CodingKeys: String, CodingKey {
            case recoveryScore = "recovery_score"
            case hrvTrendPct = "hrv_trend_pct"
            case note
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, title, tag, description, plan
        case createdBy = "created_by"
        case isActive = "is_active"
        case recoveryContext = "recovery_context"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

extension WorkoutPlan.Intensity {
    var label: String {
        switch self {
        case .hard: return "Hard"
        case .moderate: return "Moderate"
        case .reduced: return "Reduced"
        case .rest: return "Rest"
        case .unknown: return "—"
        }
    }

    var colorHex: String {
        switch self {
        case .hard: return "#ff0043"
        case .moderate: return "#ffaa00"
        case .reduced: return "#00aaff"
        case .rest: return "#6b6b74"
        case .unknown: return "#6b6b74"
        }
    }
}
