import Foundation

struct PlansResponse: Decodable {
    let plans: [WorkoutPlan]
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

    struct Day: Decodable, Hashable, Identifiable {
        let name: String
        let focus: String?
        let intensity: Intensity
        let exercises: [Exercise]

        var id: String { name }
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

    struct Exercise: Decodable, Hashable, Identifiable {
        let name: String
        let scheme: String
        let note: String?

        var id: String { name + scheme }
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
