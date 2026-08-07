import Foundation

enum CoachEffort: String, Codable, CaseIterable, Identifiable {
    case off
    case low
    case medium
    case high
    case max

    var id: String { rawValue }

    var label: String {
        switch self {
        case .off: return "None"
        case .low: return "Low"
        case .medium: return "Medium"
        case .high: return "High"
        case .max: return "Max"
        }
    }

    var detail: String {
        switch self {
        case .off: return "No extended reasoning"
        case .low: return "Fastest"
        case .medium: return "Balanced"
        case .high: return "Thorough"
        case .max: return "Deepest"
        }
    }
}

enum CoachModelProvider: String {
    case anthropic = "Anthropic"
    case cursor = "Cursor"
}

struct CoachModelOption: Identifiable, Equatable {
    let id: String
    let label: String
    let detail: String?
    let provider: CoachModelProvider

    static let claude = CoachModelOption(
        id: "anthropic:claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        detail: "Balanced reasoning for thoughtful health coaching.",
        provider: .anthropic
    )
}

struct CoachSettingsPayload: Decodable {
    let modelPref: String
    let coachEffort: CoachEffort
    let cursorAvailable: Bool

    enum CodingKeys: String, CodingKey {
        case modelPref = "model_pref"
        case coachEffort = "coach_effort"
        case cursorAvailable = "cursor_available"
    }
}

enum CursorModelCatalogStatus: String, Decodable {
    case ready
    case notConfigured = "not_configured"
    case invalidKey = "invalid_key"
    case unavailable

    var title: String {
        switch self {
        case .ready: return ""
        case .notConfigured: return "Connect Cursor for more models"
        case .invalidKey: return "Cursor key needs attention"
        case .unavailable: return "Cursor catalog is offline"
        }
    }

    var detail: String {
        switch self {
        case .ready: return ""
        case .notConfigured:
            return "Add a Cursor API key in Settings to unlock its model catalog."
        case .invalidKey:
            return "The configured key was rejected, so only Claude is available."
        case .unavailable:
            return "Claude is available while model discovery recovers."
        }
    }
}

struct CursorModelCatalogPayload: Decodable {
    let status: CursorModelCatalogStatus
    let models: [CursorCoachModel]
}

struct CursorCoachModel: Decodable, Identifiable {
    let id: String
    let displayName: String
    let description: String?

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case description
    }
}

struct CoachModelSelection {
    var modelPref: String
    var effort: CoachEffort
    var cursorStatus: CursorModelCatalogStatus
    var cursorModels: [CursorCoachModel]

    static let fallback = CoachModelSelection(
        modelPref: CoachModelOption.claude.id,
        effort: .high,
        cursorStatus: .unavailable,
        cursorModels: []
    )

    var options: [CoachModelOption] {
        var result = [CoachModelOption.claude]
        result.append(
            contentsOf: cursorModels.map {
                CoachModelOption(
                    id: "cursor:\($0.id)",
                    label: $0.displayName,
                    detail: $0.description,
                    provider: .cursor
                )
            }
        )

        if modelPref.hasPrefix("cursor:"),
            !result.contains(where: { $0.id == modelPref }) {
            let rawID = String(modelPref.dropFirst("cursor:".count))
            result.append(
                CoachModelOption(
                    id: modelPref,
                    label: rawID,
                    detail: "Previously selected Cursor model.",
                    provider: .cursor
                )
            )
        }
        return result
    }

    var selectedOption: CoachModelOption {
        options.first(where: { $0.id == modelPref }) ?? .claude
    }

    var triggerLabel: String {
        selectedOption.label.replacingOccurrences(of: "Claude ", with: "")
    }
}

struct CoachModelSelectionService {
    let api: APIClient

    func load() async throws -> CoachModelSelection {
        let loadedSettings: CoachSettingsPayload = try await api.get("/api/settings")
        let loadedCatalog = await loadCatalog()
        return CoachModelSelection(
            modelPref: loadedSettings.modelPref,
            effort: loadedSettings.coachEffort,
            cursorStatus: loadedCatalog.status,
            cursorModels: loadedCatalog.models
        )
    }

    func selectModel(_ modelPref: String) async throws -> CoachSettingsPayload {
        try await api.post(
            "/api/settings",
            body: CoachSettingsUpdate(modelPref: modelPref, coachEffort: nil)
        )
    }

    func selectEffort(_ effort: CoachEffort) async throws -> CoachSettingsPayload {
        try await api.post(
            "/api/settings",
            body: CoachSettingsUpdate(modelPref: nil, coachEffort: effort)
        )
    }

    private func loadCatalog() async -> CursorModelCatalogPayload {
        do {
            return try await api.get("/api/me/cursor-models")
        } catch {
            return CursorModelCatalogPayload(status: .unavailable, models: [])
        }
    }
}

private struct CoachSettingsUpdate: Encodable {
    let modelPref: String?
    let coachEffort: CoachEffort?

    enum CodingKeys: String, CodingKey {
        case modelPref = "model_pref"
        case coachEffort = "coach_effort"
    }
}
