import XCTest
@testable import Coach

final class APIDateDecodingTests: XCTestCase {
    func testAllBackendFormatsRepresentSameInstant() throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = APIDateDecoding.strategy()
        let input = Data(#"["2026-11-10T12:30:00.000Z","2026-11-10T12:30:00Z","2026-11-10 12:30:00","2026-11-10T07:30:00-05:00"]"#.utf8)
        let dates = try decoder.decode([Date].self, from: input)
        XCTAssertEqual(dates.count, 4)
        XCTAssertTrue(dates.allSatisfy { $0 == dates[0] })
    }

    func testInvalidDateThrowsRatherThanSilentlyBecomingNow() {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = APIDateDecoding.strategy()
        XCTAssertThrowsError(try decoder.decode([Date].self, from: Data(#"["invalid"]"#.utf8)))
    }
}
