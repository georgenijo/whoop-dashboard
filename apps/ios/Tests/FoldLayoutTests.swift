import XCTest
@testable import Coach

final class FoldLayoutTests: XCTestCase {
    /// Geometry measured on the iPhone Duo simulator's inner display in
    /// landscape: an 867 pt content area beside the side rail, with the fold
    /// reported as a 40 pt band at x 455–495.
    private let duoInner = FoldGeometry(width: 867, hinge: 455 ... 495)

    func testGutterIsTheHingeBandOnInnerDisplay() throws {
        let split = try XCTUnwrap(FoldSplit.compute(fold: duoInner, inset: 16))
        XCTAssertEqual(split.leading, 439)   // 16 → 455
        XCTAssertEqual(split.gutter, 40)     // 455 → 495, the fold
        XCTAssertEqual(split.trailing, 356)  // 495 → 851
        XCTAssertEqual(16 + split.leading + split.gutter + split.trailing + 16, duoInner.width)
    }

    func testNoFoldSplitsEvenly() throws {
        let split = try XCTUnwrap(FoldSplit.compute(fold: FoldGeometry(width: 900, hinge: nil), inset: 16))
        XCTAssertEqual(split.leading, split.trailing)
        XCTAssertEqual(split.gutter, FoldSplit.defaultGutter)
        XCTAssertEqual(split.leading + split.gutter + split.trailing, 900 - 32)
    }

    func testOffCentreHingeThatStarvesAColumnFallsBackToEvenSplit() throws {
        // A hinge near the trailing edge would leave a sliver; use equal columns.
        let split = try XCTUnwrap(FoldSplit.compute(fold: FoldGeometry(width: 867, hinge: 700 ... 740), inset: 16))
        XCTAssertEqual(split.leading, split.trailing)
    }

    func testCompactWidthsStaySingleColumn() {
        // iPhone Duo outer display content width, and any phone.
        XCTAssertNil(FoldSplit.compute(fold: FoldGeometry(width: 386, hinge: nil), inset: 16))
        XCTAssertNil(FoldSplit.compute(fold: FoldGeometry(width: 402, hinge: nil), inset: 16))
        XCTAssertNil(FoldSplit.compute(fold: .none, inset: 16))
    }

    func testReadableTypeScaleFloorsAndPreservesHierarchy() {
        let readable = Theme.FontStyle.readable
        XCTAssertEqual(readable(8), Theme.FontStyle.minimumSize)
        XCTAssertEqual(readable(9.5), 12)
        XCTAssertEqual(readable(11), 13)
        XCTAssertEqual(readable(15), 17)
        // Display numerals are left as designed.
        XCTAssertEqual(readable(30), 30)
        XCTAssertEqual(readable(64), 64)
        // Strictly increasing above the floor, so relative hierarchy holds.
        let sizes: [CGFloat] = [10, 11, 12, 13, 15, 17, 20, 22]
        XCTAssertEqual(sizes.map(readable), sizes.map(readable).sorted())
        XCTAssertEqual(Set(sizes.map(readable)).count, sizes.count)
    }
}
