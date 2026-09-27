import Foundation
import XCTest
@testable import Coach

final class HomeDigestTests: XCTestCase {
    private let sample = """
    ## Key Findings
    - **Recovery collapsed** 32% in 7 days (66.7% → 45.7%) — not a blip, a trend requiring immediate action
    - Chronic sleep debt is the root cause: averaging ~5.8h against a ~10h need

    ## Trends
    - Declining: Recovery, HRV

    ## Action Items
    1. Add 90 minutes of sleep tonight — non-negotiable. Set a hard bedtime.
    2. Skip or heavily reduce soccer this week — you've logged back-to-back strain
    3. Investigate the disturbances — 8-15 nightly is abnormal.
    4. A fourth item that should be dropped

    ## Watch Out
    - Nothing concerning
    """

    func testDigestPicksHeadlineAndLeadingClauses() {
        let digest = InsightDigest(markdown: sample)
        XCTAssertEqual(digest.headline, "**Recovery collapsed** 32% in 7 days (66.7% → 45.7%)")
        XCTAssertEqual(digest.actions, [
            "Add 90 minutes of sleep tonight",
            "Skip or heavily reduce soccer this week",
            "Investigate the disturbances"
        ])
        XCTAssertEqual(digest.sectionCount, 4)
    }

    func testShortClauseIsNotCutTooEarly() {
        XCTAssertEqual(InsightDigest.leadingClause("Sleep: get to bed by 10pm every night this week"),
                       "Sleep: get to bed by 10pm every night this week")
    }

    func testLongItemIsTruncatedOnWordBoundary() {
        let long = String(repeating: "word ", count: 40)
        let cut = InsightDigest.leadingClause(long)
        XCTAssertTrue(cut.hasSuffix("…"))
        XCTAssertLessThanOrEqual(cut.count, 112)
    }

    func testUnbalancedEmphasisIsStripped() {
        let cut = InsightDigest.leadingClause("**Sleep more every single night — really** please")
        XCTAssertFalse(cut.contains("**"))
    }

    func testUnstructuredTextStillProducesHeadline() {
        let digest = InsightDigest(markdown: "Recovery is steady and HRV is up this week.")
        XCTAssertEqual(digest.headline, "Recovery is steady and HRV is up this week")
        XCTAssertTrue(digest.actions.isEmpty)
    }

    func testKPIRowsAreBalanced() {
        XCTAssertEqual(KPIStripView.rowSizes(count: 7, columns: 3), [3, 2, 2])
        XCTAssertEqual(KPIStripView.rowSizes(count: 6, columns: 3), [3, 3])
        XCTAssertEqual(KPIStripView.rowSizes(count: 4, columns: 3), [2, 2])
        XCTAssertEqual(KPIStripView.rowSizes(count: 2, columns: 3), [2])
        XCTAssertEqual(KPIStripView.rowSizes(count: 0, columns: 3), [])
    }

    func testDeltaLabelSplitsAndGroups() {
        let d = KPIDeltaText(KPITile.Delta(label: "↓ 35585 vs yesterday", dir: .down))
        XCTAssertEqual(d.amount, "↓ 35,585")
        XCTAssertEqual(d.context, "vs yesterday")
        let flat = KPIDeltaText(KPITile.Delta(label: "— baseline", dir: .flat))
        XCTAssertEqual(flat.amount, "no change")
        let gap = KPIDeltaText(KPITile.Delta(label: "↑ 4.3 vs 2 days ago", dir: .up))
        XCTAssertEqual(gap.shortContext, "vs 2d ago")
    }
}
