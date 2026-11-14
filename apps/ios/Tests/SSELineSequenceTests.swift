import Foundation
import XCTest
@testable import Coach

final class SSELineSequenceTests: XCTestCase {
    private func lines(_ string: String) async throws -> [String] {
        let stream = AsyncStream<UInt8> { continuation in
            for byte in string.utf8 { continuation.yield(byte) }
            continuation.finish()
        }
        var result: [String] = []
        for try await line in SSELineSequence(base: stream) { result.append(line) }
        return result
    }

    func testPreservesBlankLinesAndMultibyteContent() async throws {
        let result = try await lines("event: text_delta\ndata: {\"text\":\"睡眠 🌙\"}\n\nevent: done\ndata: {}\n\n")
        XCTAssertEqual(result, ["event: text_delta", "data: {\"text\":\"睡眠 🌙\"}", "", "event: done", "data: {}", ""])
    }

    func testCRLFAndBareCRProduceExactlyOneBoundary() async throws {
        let crlf = try await lines("event: done\r\ndata: {}\r\n\r\n")
        let cr = try await lines("event: done\rdata: {}\r\r")
        XCTAssertEqual(crlf, ["event: done", "data: {}", ""])
        XCTAssertEqual(cr, crlf)
    }

    func testBOMAndUnterminatedFinalLine() async throws {
        let result = try await lines("\u{FEFF}event: done\ndata: {}")
        XCTAssertEqual(result, ["event: done", "data: {}"])
        var parser = SSEEventParser()
        for line in result { XCTAssertNil(parser.consume(line)) }
        XCTAssertNil(parser.finish())
    }

    func testRealByteFramingDeliversIndependentEvents() async throws {
        let result = try await lines("event: text_delta\ndata: {\"text\":\"hello\"}\n\nevent: done\ndata: {\"reply\":\"hello\"}\n\n")
        var parser = SSEEventParser()
        let events = result.compactMap { parser.consume($0) }
        XCTAssertEqual(events.map(\.name), ["text_delta", "done"])
        guard case .done(let reply, _, _)? = try ChatService.decodeEvent(events[1].name, Data(events[1].data.utf8), JSONDecoder()) else {
            return XCTFail("Missing terminal done event")
        }
        XCTAssertEqual(reply, "hello")
    }
    func testOversizedLineIsBoundedAndRemainsRecoverable() async {
        struct RepeatedBytes: AsyncSequence {
            typealias Element = UInt8
            struct AsyncIterator: AsyncIteratorProtocol {
                var remaining = 4 * 1024 * 1024 + 1
                mutating func next() async -> UInt8? {
                    guard remaining > 0 else { return nil }
                    remaining -= 1
                    return 65
                }
            }
            func makeAsyncIterator() -> AsyncIterator { AsyncIterator() }
        }
        do {
            for try await _ in SSELineSequence(base: RepeatedBytes()) {}
            XCTFail("Oversized line must abort")
        } catch {
            XCTAssertTrue(error is SSEFramingError)
            XCTAssertTrue(ChatView.isTransportDrop(error), "Accepted turns must reconcile before any retry")
        }
    }

}
