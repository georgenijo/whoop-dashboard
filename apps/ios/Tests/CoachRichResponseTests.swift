import XCTest
@testable import Coach

final class CoachRichResponseTests: XCTestCase {
    func testDecodesTypedBlocksFromDoneEvent() throws {
        let payload = Data("""
        {
          "reply":"Strong recovery.",
          "presentation_blocks":[{
            "version":1,
            "type":"metric_strip",
            "fallback":"Recovery 78 percent.",
            "metrics":[{
              "label":"Recovery",
              "value":78,
              "display_value":"78%",
              "unit":"%",
              "direction":"up",
              "tone":"positive"
            }]
          }]
        }
        """.utf8)

        let done = try JSONDecoder().decode(SSEDone.self, from: payload)
        XCTAssertEqual(done.reply, "Strong recovery.")
        XCTAssertEqual(done.presentationBlocks.count, 1)
        guard case .metricStrip(let strip) = done.presentationBlocks[0] else {
            return XCTFail("Expected metric strip")
        }
        XCTAssertEqual(strip.metrics[0].displayValue, "78%")
    }

    func testUnknownVersionKeepsReadableFallbackWithoutLosingReply() throws {
        let payload = Data("""
        {
          "reply":"Historical answer stays visible.",
          "presentation_blocks":[{
            "version":2,
            "type":"metric_strip",
            "fallback":"Fallback.",
            "metrics":[]
          }]
        }
        """.utf8)

        let done = try JSONDecoder().decode(SSEDone.self, from: payload)
        XCTAssertEqual(done.reply, "Historical answer stays visible.")
        XCTAssertEqual(done.presentationBlocks.map(\.fallbackText), ["Fallback."])
    }

    func testMalformedBlockFailsClosedOnHistoricalMessage() throws {
        let payload = Data("""
        {
          "id":1,
          "role":"assistant",
          "content":"Markdown fallback.",
          "created_at":"2026-08-18T12:00:00Z",
          "attachments":[],
          "presentation_blocks":[{"version":1,"type":"chart"}]
        }
        """.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let message = try decoder.decode(ChatMessage.self, from: payload)
        XCTAssertEqual(message.content, "Markdown fallback.")
        XCTAssertTrue(message.presentationBlocks.isEmpty)
    }
    func testUnknownAndMalformedBlocksDoNotDiscardValidNeighbors() throws {
        let payload = Data("""
        {"reply":"A complete answer.","presentation_blocks":[
          {"version":1,"type":"metric_strip","fallback":"Recovery 78%","metrics":[]},
          {"version":2,"type":"future","fallback":"New analysis in readable form."},
          {"version":1,"type":"chart"},
          null,
          {"version":1,"type":"action_plan","fallback":"Rest today.","title":"Today","sections":[]}
        ]}
        """.utf8)
        let done = try JSONDecoder().decode(SSEDone.self, from: payload)
        XCTAssertEqual(done.presentationBlocks.map(\.fallbackText), [
            "Recovery 78%", "New analysis in readable form.", "Rest today."
        ])
    }

    func testDoneEventCarriesCompleteAnswerWithoutHistoryFetch() throws {
        let payload = Data("""
        {"reply":"Rest today.","work_log":{
          "version":1,"status":"complete","duration_ms":1500,"notes":["Checked recovery"],"tools":[]
        },"presentation_blocks":[
          {"version":1,"type":"action_plan","fallback":"Rest today.","title":"Today","sections":[]}
        ]}
        """.utf8)
        let event = try ChatService.decodeEvent("done", payload, JSONDecoder())
        guard case .done(let reply, let workLog, let blocks)? = event else {
            return XCTFail("Expected a self-contained completed turn")
        }
        XCTAssertEqual(reply, "Rest today.")
        XCTAssertEqual(workLog?.notes, ["Checked recovery"])
        XCTAssertEqual(blocks.map(\.fallbackText), ["Rest today."])
    }

    func testParallelSameNameToolEventsPreserveServerIdentifiers() throws {
        let decoder = JSONDecoder()
        let first = try ChatService.decodeEvent("tool_use_start", Data(#"{"id":"call-a","name":"query_sleep"}"#.utf8), decoder)
        let second = try ChatService.decodeEvent("tool_use_start", Data(#"{"id":"call-b","name":"query_sleep"}"#.utf8), decoder)
        guard case .toolUseStart(let firstID, let firstName)? = first,
              case .toolUseStart(let secondID, let secondName)? = second else {
            return XCTFail("Expected tool start events")
        }
        XCTAssertEqual(firstName, secondName)
        XCTAssertNotEqual(firstID, secondID)
        let progress = try ChatService.decodeEvent("tool_progress", Data(#"{"id":"call-a","tool":"query_sleep","stage":"reading","message":"Reading 30 days"}"#.utf8), decoder)
        guard case .toolProgress(let id, _, _, let message)? = progress else { return XCTFail("Expected progress") }
        XCTAssertEqual(id, firstID)
        XCTAssertEqual(message, "Reading 30 days")
    }

}
