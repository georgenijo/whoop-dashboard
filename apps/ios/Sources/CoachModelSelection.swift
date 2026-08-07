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
    let cursorModelParams: [String: [CursorModelParameterSelection]]
    let cursorAvailable: Bool

    enum CodingKeys: String, CodingKey {
        case modelPref = "model_pref"
        case coachEffort = "coach_effort"
        case cursorModelParams = "cursor_model_params"
        case cursorAvailable = "cursor_available"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        modelPref = try container.decode(String.self, forKey: .modelPref)
        coachEffort = try container.decode(CoachEffort.self, forKey: .coachEffort)
        cursorModelParams = try container.decodeIfPresent(
            [String: [CursorModelParameterSelection]].self,
            forKey: .cursorModelParams
        ) ?? [:]
        cursorAvailable = try container.decode(Bool.self, forKey: .cursorAvailable)
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

struct CursorModelParameterSelection: Codable, Equatable {
    let id: String
    let value: String
}

struct CursorModelParameterValue: Decodable, Equatable, Identifiable {
    let value: String
    let displayName: String?

    var id: String { value }

    enum CodingKeys: String, CodingKey {
        case value
        case displayName = "display_name"
    }
}

struct CursorModelParameterDefinition: Decodable, Equatable {
    let id: String
    let displayName: String?
    let values: [CursorModelParameterValue]

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case values
    }

    var isReasoning: Bool {
        let normalizedID = id.lowercased()
        let normalizedName = (displayName ?? "").lowercased()
        return ["thinking", "reasoning", "effort", "thought_level"]
            .contains(normalizedID)
            || normalizedName.contains("thinking")
            || normalizedName.contains("reasoning")
            || normalizedName.contains("thought")
            || normalizedName.contains("effort")
    }

    var booleanValues: (on: CursorModelParameterValue, off: CursorModelParameterValue)? {
        guard values.count == 2 else { return nil }
        guard
            let on = values.first(where: { $0.value.lowercased() == "true" }),
            let off = values.first(where: { $0.value.lowercased() == "false" })
        else { return nil }
        return (on, off)
    }

    func displayLabel(for value: String) -> String {
        if let booleanValues {
            if value == booleanValues.on.value { return "Reasoning on" }
            if value == booleanValues.off.value { return "Reasoning off" }
        }
        return values.first(where: { $0.value == value })?.displayName ?? value
    }
}

struct CursorModelVariant: Decodable, Equatable {
    let params: [CursorModelParameterSelection]
    let displayName: String
    let description: String?
    let isDefault: Bool

    enum CodingKeys: String, CodingKey {
        case params
        case displayName = "display_name"
        case description
        case isDefault = "is_default"
    }
}

struct CursorCoachModel: Decodable, Identifiable, Equatable {
    let id: String
    let displayName: String
    let description: String?
    let parameters: [CursorModelParameterDefinition]
    let variants: [CursorModelVariant]

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case description
        case parameters
        case variants
    }

    init(
        id: String,
        displayName: String,
        description: String?,
        parameters: [CursorModelParameterDefinition] = [],
        variants: [CursorModelVariant] = []
    ) {
        self.id = id
        self.displayName = displayName
        self.description = description
        self.parameters = parameters
        self.variants = variants
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        displayName = try container.decode(String.self, forKey: .displayName)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        parameters = try container.decodeIfPresent(
            [CursorModelParameterDefinition].self,
            forKey: .parameters
        ) ?? []
        variants = try container.decodeIfPresent(
            [CursorModelVariant].self,
            forKey: .variants
        ) ?? []
    }

    var reasoningParameter: CursorModelParameterDefinition? {
        parameters.first(where: { $0.isReasoning })
    }

    var defaultParameters: [CursorModelParameterSelection] {
        variants.first(where: { $0.isDefault })?.params ?? variants.first?.params ?? []
    }
}

struct CoachModelSelection {
    var modelPref: String
    var effort: CoachEffort
    var cursorStatus: CursorModelCatalogStatus
    var cursorModels: [CursorCoachModel]
    var cursorModelParams: [String: [CursorModelParameterSelection]] = [:]

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

    func cursorModel(for option: CoachModelOption) -> CursorCoachModel? {
        guard option.provider == .cursor else { return nil }
        let rawID = String(option.id.dropFirst("cursor:".count))
        return cursorModels.first(where: { $0.id == rawID })
    }

    func cursorParameters(
        for model: CursorCoachModel
    ) -> [CursorModelParameterSelection] {
        cursorModelParams[model.id] ?? model.defaultParameters
    }

    var selectedCursorReasoningLabel: String? {
        guard
            let model = cursorModel(for: selectedOption),
            let reasoning = model.reasoningParameter,
            let selected = cursorParameters(for: model).first(where: {
                $0.id == reasoning.id
            })
        else { return nil }
        return reasoning.displayLabel(for: selected.value)
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
            cursorModels: loadedCatalog.models,
            cursorModelParams: loadedSettings.cursorModelParams
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

    func selectCursorParameters(
        modelID: String,
        params: [CursorModelParameterSelection]
    ) async throws -> CoachSettingsPayload {
        try await api.post(
            "/api/settings",
            body: CoachSettingsUpdate(
                modelPref: nil,
                coachEffort: nil,
                cursorModelParams: CursorModelParamsUpdate(
                    modelID: modelID,
                    params: params
                )
            )
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
    let cursorModelParams: CursorModelParamsUpdate?

    enum CodingKeys: String, CodingKey {
        case modelPref = "model_pref"
        case coachEffort = "coach_effort"
        case cursorModelParams = "cursor_model_params"
    }

    init(
        modelPref: String?,
        coachEffort: CoachEffort?,
        cursorModelParams: CursorModelParamsUpdate? = nil
    ) {
        self.modelPref = modelPref
        self.coachEffort = coachEffort
        self.cursorModelParams = cursorModelParams
    }
}

private struct CursorModelParamsUpdate: Encodable {
    let modelID: String
    let params: [CursorModelParameterSelection]

    enum CodingKeys: String, CodingKey {
        case modelID = "model_id"
        case params
    }
}
