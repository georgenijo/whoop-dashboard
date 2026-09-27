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
        XCTAssertTrue(digest.preview.isEmpty)
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
        XCTAssertEqual(d.amount, "↓ " + 35585.0.formatted(.number.precision(.fractionLength(0))))
        XCTAssertEqual(d.context, "vs yesterday")
        let flat = KPIDeltaText(KPITile.Delta(label: "— baseline", dir: .flat))
        XCTAssertEqual(flat.amount, "no change")
        let gap = KPIDeltaText(KPITile.Delta(label: "↑ 4.3 vs 2 days ago", dir: .up))
        XCTAssertEqual(gap.shortContext, "vs 2d ago")
    }

    func testSubheadingsStayInsideTheirParentSection() {
        let md = """
        ## Key Findings
        - HRV is down 12% this week
        ## Action Items
        ### Sleep
        - Be in bed by 10:30pm tonight
        ### Training
        - Keep strain under 12 today
        ## Watch Out
        - Nothing concerning
        """
        let digest = InsightDigest(markdown: md)
        XCTAssertEqual(digest.headline, "HRV is down 12% this week")
        XCTAssertEqual(digest.actions, ["Be in bed by 10:30pm tonight", "Keep strain under 12 today"])
    }

    func testWrapperHeadingDoesNotSwallowSections() {
        let md = """
        # Weekly analysis
        ## Key Findings
        - Recovery averaged 64% over the last week
        ## Action Items
        - Add an extra hour of sleep tonight
        """
        let digest = InsightDigest(markdown: md)
        XCTAssertEqual(digest.headline, "Recovery averaged 64% over the last week")
        XCTAssertEqual(digest.actions, ["Add an extra hour of sleep tonight"])
    }

    func testUnrecognisedSectionsFallBackToBoundedPreview() {
        let md = """
        # Analysis
        ## Recovery
        - Recovery is trending down this week — watch it closely
        - HRV is holding steady around 45ms
        ## Sleep
        - Sleep debt has built up to roughly six hours
        - Disturbances are elevated at 12 per night
        - Bedtime drifted later on four of seven nights
        """
        let digest = InsightDigest(markdown: md)
        XCTAssertEqual(digest.headline, "Recovery is trending down this week")
        XCTAssertTrue(digest.actions.isEmpty)
        XCTAssertEqual(digest.preview, [
            "HRV is holding steady around 45ms",
            "Sleep debt has built up to roughly six hours"
        ])
    }

    func testThirtyDayAverageIgnoresReadingsOlderThanThirtyDays() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let now = calendar.date(from: DateComponents(year: 2026, month: 9, day: 26, hour: 9))!
        func day(_ offset: Int) -> String {
            ChartDate.key(calendar.date(byAdding: .day, value: -offset, to: now)!)
        }
        let recent = (0..<10).map { TrendPoint(date: day($0 * 2), raw: 60, ma7: nil, ma30: nil) }
        let old = (0..<20).map { TrendPoint(date: day(31 + $0), raw: 10, ma7: nil, ma30: nil) }
        XCTAssertEqual(RecoveryHeroView.thirtyDayAverage(old.reversed() + recent.reversed(), now: now, calendar: calendar), 60)
        XCTAssertNil(RecoveryHeroView.thirtyDayAverage(Array(recent.prefix(3)), now: now, calendar: calendar))
    }
}
