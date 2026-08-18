import Foundation
import XCTest
@testable import Coach

final class CoachPresentationTests: XCTestCase {
    func testParsesThread150HRVChart() throws {
        let chart = try XCTUnwrap(
            CoachChartSpec.parseMermaid(
                """
                xychart-beta
                    title "Morning HRV (ms) — Jul 19 to Aug 17"
                    x-axis ["7/19","7/22","7/25"]
                    y-axis "ms" 25 --> 55
                    line [43,45,30]
                """
            )
        )

        XCTAssertEqual(chart.kind, .line)
        XCTAssertEqual(chart.title, "Morning HRV (ms) — Jul 19 to Aug 17")
        XCTAssertEqual(chart.unit, "ms")
        XCTAssertEqual(chart.labels, ["7/19", "7/22", "7/25"])
        XCTAssertEqual(chart.values, [43, 45, 30])
        XCTAssertEqual(chart.yMin, 25)
        XCTAssertEqual(chart.yMax, 55)
    }

    func testRejectsUnsupportedAndMismatchedCharts() {
        XCTAssertNil(CoachChartSpec.parseMermaid("flowchart LR\nA --> B"))
        XCTAssertNil(
            CoachChartSpec.parseMermaid(
                """
                xychart-beta
                    x-axis ["a","b"]
                    line [1]
                """
            )
        )
    }

    func testDecodesPersistedWorkLog() throws {
        let data = Data(
            """
            {
              "id": 42,
              "role": "assistant",
              "content": "Your HRV improved.",
              "created_at": "2026-08-18T12:00:00Z",
              "attachments": [],
              "work_log": {
                "version": 1,
                "status": "complete",
                "duration_ms": 20420,
                "notes": ["Pulling your recovery trend."],
                "tools": [{
                  "id": "tool-1",
                  "name": "query_recovery",
                  "input": {"start_date": "2026-08-01"},
                  "state": "complete",
                  "status": "ok",
                  "duration_ms": 127,
                  "rows": 17
                }]
              }
            }
            """.utf8
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let message = try decoder.decode(ChatMessage.self, from: data)

        XCTAssertEqual(message.workLog?.durationMs, 20_420)
        XCTAssertEqual(message.workLog?.tools.first?.name, "query_recovery")
        XCTAssertEqual(message.workLog?.tools.first?.rows, 17)
    }

    func testWorkDurationFormattingMatchesWebDensity() {
        XCTAssertEqual(CoachWorkLogView.duration(127), "127ms")
        XCTAssertEqual(CoachWorkLogView.duration(7_500), "7.5s")
        XCTAssertEqual(CoachWorkLogView.duration(20_420), "20s")
        XCTAssertEqual(CoachWorkLogView.duration(75_000), "1m 15s")
    }
}
