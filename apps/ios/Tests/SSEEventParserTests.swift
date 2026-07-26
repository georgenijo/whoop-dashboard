import Foundation
import XCTest
@testable import Coach

final class SSEEventParserTests: XCTestCase {
    func testIgnoresCommentsAndUnknownFields() {
        var parser = SSEEventParser()

        XCTAssertNil(parser.consume(": heartbeat"))
        XCTAssertNil(parser.consume("retry: 1000"))
        XCTAssertNil(parser.consume("id: 42"))
        XCTAssertNil(parser.consume("event: done"))
        XCTAssertNil(parser.consume(#"data: {"reply":"ready"}"#))

        XCTAssertEqual(
            parser.consume(""),
            SSEEventFrame(name: "done", data: #"{"reply":"ready"}"#)
        )
    }

    func testNormalizesCRLFAndJoinsMultilineDataWithNewlines() {
        var parser = SSEEventParser()

        XCTAssertNil(parser.consume("event: text_delta\r"))
        XCTAssertNil(parser.consume(#"data: {"text":"# + "\r"))
        XCTAssertNil(parser.consume(#"data: "hello"}"# + "\r"))

        let frame = parser.consume("\r")
        XCTAssertEqual(frame, SSEEventFrame(name: "text_delta", data: "{\"text\":\n\"hello\"}"))

        guard let frame else {
            return XCTFail("Expected a complete frame")
        }
        do {
            let event = try ChatService.decodeEvent(
                frame.name,
                Data(frame.data.utf8),
                JSONDecoder()
            )
            guard case .textDelta(let text)? = event else {
                return XCTFail("Expected a text delta")
            }
            XCTAssertEqual(text, "hello")
        } catch {
            XCTFail("Expected multiline JSON to decode: \(error)")
        }
    }

    func testDispatchesConsecutiveEventsIndependently() {
        var parser = SSEEventParser()

        _ = parser.consume("event: text_delta")
        _ = parser.consume(#"data: {"text":"one"}"#)
        XCTAssertEqual(
            parser.consume(""),
            SSEEventFrame(name: "text_delta", data: #"{"text":"one"}"#)
        )

        _ = parser.consume("event: done")
        _ = parser.consume(#"data: {"reply":"one"}"#)
        XCTAssertEqual(
            parser.consume(""),
            SSEEventFrame(name: "done", data: #"{"reply":"one"}"#)
        )
    }

    func testDiscardsUnterminatedEventAtEOF() {
        var parser = SSEEventParser()

        _ = parser.consume("event: done")
        _ = parser.consume(#"data: {"reply":"complete"}"#)

        XCTAssertNil(parser.finish())
        XCTAssertNil(parser.finish())
    }

    func testUsesDefaultEventNameWhenEventFieldIsMissing() {
        var parser = SSEEventParser()

        _ = parser.consume(#"data: {"ignored":true}"#)

        XCTAssertEqual(
            parser.consume(""),
            SSEEventFrame(name: "message", data: #"{"ignored":true}"#)
        )
    }

    func testUsesDefaultEventNameWhenEventFieldIsEmpty() {
        var parser = SSEEventParser()

        _ = parser.consume("event:")
        _ = parser.consume(#"data: {"ignored":true}"#)

        XCTAssertEqual(
            parser.consume(""),
            SSEEventFrame(name: "message", data: #"{"ignored":true}"#)
        )
    }

    func testMalformedRecognizedEventThrowsWithoutNeedingPayloadLogging() {
        XCTAssertThrowsError(
            try ChatService.decodeEvent(
                "text_delta",
                Data(#"{"unexpected":"value"}"#.utf8),
                JSONDecoder()
            )
        )
    }

    func testUnknownEventIsIgnored() throws {
        let event = try ChatService.decodeEvent(
            "future_event",
            Data(#"{"anything":true}"#.utf8),
            JSONDecoder()
        )

        XCTAssertNil(event)
    }
}
