import XCTest
@testable import Coach

final class CoachModelSelectionTests: XCTestCase {
    func testEffectiveEffortMatchesServerWithoutChangingSavedPreference() throws {
        let catalog = try JSONDecoder().decode(AnthropicModelCatalogPayload.self, from: Data(#"{"status":"ready","models":[{"id":"claude-sonnet-5-5","display_name":"Sonnet 5.5","thinking":"adaptive","efforts":["low","medium","high"],"max_tokens":64000}]}"#.utf8))
        var selection = CoachModelSelection.fallback
        selection.modelPref = "anthropic:claude-sonnet-5-5"
        selection.anthropicModels = catalog.models
        selection.effort = .off
        XCTAssertEqual(selection.effectiveEffort, .high)
        XCTAssertEqual(selection.effort, .off)
        selection.effort = .max
        XCTAssertEqual(selection.effectiveEffort, .high)
        selection.effort = .medium
        XCTAssertEqual(selection.effectiveEffort, .medium)
    }

    func testAnthropicCatalogPreservesServerCapabilities() throws {
        let catalog = try JSONDecoder().decode(AnthropicModelCatalogPayload.self, from: Data("""
        {"status":"ready","models":[{"id":"claude-sonnet-5-5","display_name":"Claude Sonnet 5.5","thinking":"adaptive","efforts":["medium","high"]}]}
        """.utf8))
        let selection = CoachModelSelection(
            modelPref: "anthropic:claude-sonnet-5-5", effort: .off,
            cursorStatus: .notConfigured, cursorModels: [],
            anthropicStatus: catalog.status, anthropicModels: catalog.models
        )
        XCTAssertEqual(selection.selectedOption.label, "Claude Sonnet 5.5")
        XCTAssertEqual(selection.supportedEfforts, [.medium, .high])
        XCTAssertFalse(selection.supportedEfforts.contains(.off))
        XCTAssertEqual(selection.options.count, 1)
    }

    func testCatalogFailureDoesNotAdvertiseInventedModelsOrEfforts() {
        let selection = CoachModelSelection(
            modelPref: "anthropic:claude-sonnet-5-5", effort: .high,
            cursorStatus: .unavailable, cursorModels: []
        )
        XCTAssertEqual(selection.options.map(\.id), ["anthropic:claude-sonnet-5-5"])
        XCTAssertEqual(selection.triggerLabel, "Sonnet 5.5")
        XCTAssertTrue(selection.supportedEfforts.isEmpty)
    }

    func testEffortLabelsMatchSupportedServerValues() {
        XCTAssertEqual(
            CoachEffort.allCases.map(\.rawValue),
            ["off", "low", "medium", "high", "xhigh", "max"]
        )
        XCTAssertEqual(
            CoachEffort.allCases.map(\.label),
            ["None", "Low", "Medium", "High", "Extra high", "Max"]
        )
    }

    func testCatalogBuildsProviderGroupedOptions() {
        let selection = CoachModelSelection(
            modelPref: "cursor:composer-2.5",
            effort: .high,
            cursorStatus: .ready,
            cursorModels: [
                CursorCoachModel(
                    id: "composer-2.5",
                    displayName: "Composer 2.5",
                    description: "Fast"
                )
            ]
        )

        XCTAssertEqual(
            selection.options,
            [
                CoachModelOption(
                    id: "cursor:composer-2.5",
                    label: "Composer 2.5",
                    detail: "Fast",
                    provider: .cursor
                ),
            ]
        )
        XCTAssertEqual(selection.selectedOption.label, "Composer 2.5")
        XCTAssertEqual(selection.triggerLabel, "Composer 2.5")
    }

    func testSelectedCursorModelRemainsVisibleWhenCatalogIsUnavailable() {
        let selection = CoachModelSelection(
            modelPref: "cursor:previous-model",
            effort: .medium,
            cursorStatus: .unavailable,
            cursorModels: []
        )

        XCTAssertEqual(selection.options.count, 1)
        XCTAssertEqual(selection.selectedOption.id, "cursor:previous-model")
        XCTAssertEqual(selection.selectedOption.provider, .cursor)
    }

    func testUnknownPreferenceFallsBackToClaude() {
        let selection = CoachModelSelection(
            modelPref: "unsupported",
            effort: .low,
            cursorStatus: .notConfigured,
            cursorModels: []
        )

        XCTAssertEqual(selection.selectedOption, .claude)
        XCTAssertEqual(selection.triggerLabel, "Sonnet 4.6")
    }

    func testSelectedAnthropicModelKeepsItsIdentity() {
        let selection = CoachModelSelection(
            modelPref: "anthropic:claude-opus-4-6",
            effort: .xhigh,
            cursorStatus: .notConfigured,
            cursorModels: []
        )
        XCTAssertEqual(selection.selectedOption.id, "anthropic:claude-opus-4-6")
        XCTAssertEqual(selection.selectedOption.provider, .anthropic)
        XCTAssertEqual(selection.triggerLabel, "Opus 4.6")
    }

    func testSettingsPayloadDecodesExtraHighEffort() throws {
        let data = Data("""
        {"model_pref":"anthropic:claude-opus-4-6","coach_effort":"xhigh","cursor_available":false}
        """.utf8)
        let payload = try JSONDecoder().decode(CoachSettingsPayload.self, from: data)
        XCTAssertEqual(payload.modelPref, "anthropic:claude-opus-4-6")
        XCTAssertEqual(payload.coachEffort, .xhigh)
    }

    func testSettingsPayloadDecodesServerFieldNames() throws {
        let data = Data(
            """
            {
              "model_pref": "anthropic:claude-sonnet-4-6",
              "coach_effort": "max",
              "cursor_available": true
            }
            """.utf8
        )

        let payload = try JSONDecoder().decode(CoachSettingsPayload.self, from: data)

        XCTAssertEqual(payload.modelPref, CoachModelOption.claude.id)
        XCTAssertEqual(payload.coachEffort, .max)
        XCTAssertEqual(payload.cursorModelParams, [:])
        XCTAssertTrue(payload.cursorAvailable)
    }

    func testCatalogDecodesCursorReasoningParametersAndDefaults() throws {
        let data = Data(
            """
            {
              "status": "ready",
              "models": [{
                "id": "gpt-5.5",
                "display_name": "GPT-5.5",
                "description": null,
                "parameters": [{
                  "id": "effort",
                  "display_name": "Reasoning",
                  "values": [
                    {"value": "medium", "display_name": "Medium"},
                    {"value": "high", "display_name": "High"}
                  ]
                }],
                "variants": [{
                  "params": [{"id": "effort", "value": "medium"}],
                  "display_name": "Medium",
                  "description": null,
                  "is_default": true
                }]
              }]
            }
            """.utf8
        )

        let payload = try JSONDecoder().decode(
            CursorModelCatalogPayload.self,
            from: data
        )
        let model = try XCTUnwrap(payload.models.first)

        XCTAssertEqual(model.reasoningParameter?.id, "effort")
        XCTAssertEqual(
            model.defaultParameters,
            [CursorModelParameterSelection(id: "effort", value: "medium")]
        )
    }

    func testBooleanCursorReasoningUsesOnOffPresentation() {
        let parameter = CursorModelParameterDefinition(
            id: "thinking",
            displayName: "Reasoning",
            values: [
                CursorModelParameterValue(value: "true", displayName: nil),
                CursorModelParameterValue(value: "false", displayName: nil),
            ]
        )

        XCTAssertEqual(parameter.booleanValues?.on.value, "true")
        XCTAssertEqual(parameter.booleanValues?.off.value, "false")
        XCTAssertEqual(parameter.displayLabel(for: "true"), "Reasoning on")
        XCTAssertEqual(parameter.displayLabel(for: "false"), "Reasoning off")

        let selection = CoachModelSelection(
            modelPref: "cursor:claude-opus-5",
            effort: .high,
            cursorStatus: .ready,
            cursorModels: [
                CursorCoachModel(
                    id: "claude-opus-5",
                    displayName: "Opus 5",
                    description: nil,
                    parameters: [parameter],
                    variants: []
                )
            ],
            cursorModelParams: [
                "claude-opus-5": [
                    CursorModelParameterSelection(id: "thinking", value: "true")
                ]
            ]
        )
        XCTAssertEqual(selection.selectedCursorReasoningLabel, "Reasoning on")
    }
}
