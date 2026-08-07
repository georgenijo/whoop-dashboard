import XCTest
@testable import Coach

final class CoachModelSelectionTests: XCTestCase {
    func testEffortLabelsMatchSupportedServerValues() {
        XCTAssertEqual(
            CoachEffort.allCases.map(\.rawValue),
            ["off", "low", "medium", "high", "max"]
        )
        XCTAssertEqual(
            CoachEffort.allCases.map(\.label),
            ["None", "Low", "Medium", "High", "Max"]
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
                .claude,
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

        XCTAssertEqual(selection.options.count, 2)
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
}
