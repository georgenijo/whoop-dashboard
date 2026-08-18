import XCTest
@testable import Coach

final class CoachRichResponseTests: XCTestCase {
    func testDecodesTypedBlocksFromDoneEvent() throws {
        let payload = Data(#"{
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
        }"#.utf8)

        let done = try JSONDecoder().decode(SSEDone.self, from: payload)
        XCTAssertEqual(done.reply, "Strong recovery.")
        XCTAssertEqual(done.presentationBlocks.count, 1)
        guard case .metricStrip(let strip) = done.presentationBlocks[0] else {
            return XCTFail("Expected metric strip")
        }
        XCTAssertEqual(strip.metrics[0].displayValue, "78%")
    }

    func testUnknownVersionFailsClosedWithoutLosingReply() throws {
        let payload = Data(#"{
          "reply":"Historical answer stays visible.",
          "presentation_blocks":[{
            "version":2,
            "type":"metric_strip",
            "fallback":"Fallback.",
            "metrics":[]
          }]
        }"#.utf8)

        let done = try JSONDecoder().decode(SSEDone.self, from: payload)
        XCTAssertEqual(done.reply, "Historical answer stays visible.")
        XCTAssertTrue(done.presentationBlocks.isEmpty)
    }

    func testMalformedBlockFailsClosedOnHistoricalMessage() throws {
        let payload = Data(#"{
          "id":1,
          "role":"assistant",
          "content":"Markdown fallback.",
          "created_at":"2026-08-18T12:00:00Z",
          "attachments":[],
          "presentation_blocks":[{"version":1,"type":"chart"}]
        }"#.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let message = try decoder.decode(ChatMessage.self, from: payload)
        XCTAssertEqual(message.content, "Markdown fallback.")
        XCTAssertTrue(message.presentationBlocks.isEmpty)
    }
}
