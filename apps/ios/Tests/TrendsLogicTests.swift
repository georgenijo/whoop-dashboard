import Foundation
import XCTest
@testable import Coach

final class TrendsLogicTests: XCTestCase {
    // MARK: Card state (range tracking)

    func testSameRangeRefreshFailureKeepsData() {
        var state = TrendsCardState<Int>()
        state.succeed(42, range: .d30)
        state.fail("boom", range: .d30)
        XCTAssertEqual(state.value, 42)
        XCTAssertEqual(state.loadedRange, .d30)
    }

    func testFailedRangeChangeShowsErrorInsteadOfStaleData() {
        var state = TrendsCardState<Int>()
        state.succeed(42, range: .d30)
        state.fail("boom", range: .d90)
        XCTAssertNil(state.value)
        XCTAssertNil(state.loadedRange)
        guard case .failed(let message) = state.phase else { return XCTFail("expected failed") }
        XCTAssertEqual(message, "boom")
    }

    func testRetryAfterFailureReturnsToLoadingThenLoaded() {
        var state = TrendsCardState<Int>()
        state.fail("boom", range: .d7)
        state.beginLoad()
        guard case .loading = state.phase else { return XCTFail("expected loading") }
        state.succeed(7, range: .d7)
        XCTAssertEqual(state.value, 7)
        XCTAssertEqual(state.loadedRange, .d7)
    }

    // MARK: Delta direction

    func testApiDirectionIsTheImprovementSignal() {
        // RHR 60 -> 55: the API reverses RHR, so it sends dir "up" with a down arrow.
        let json = #"{"label":"↓ 5 bpm vs yesterday","dir":"up"}"#.data(using: .utf8)!
        let delta = try! JSONDecoder().decode(KPITile.Delta.self, from: json)
        XCTAssertEqual(RecoveryFactorsCardView.Factor.Direction(api: delta.dir), .better)
        XCTAssertEqual(RecoveryFactorsCardView.Factor.Direction(api: .down), .worse)
        XCTAssertEqual(RecoveryFactorsCardView.Factor.Direction(api: .flat), .flat)
        XCTAssertEqual(RecoveryFactorsCardView.Factor.Direction(api: nil), .flat)
        XCTAssertEqual(TrendsDeltaLabel.color(delta.dir), Theme.Palette.success)
    }

    // MARK: Freshness

    func testFreshnessSaysTodayOnlyForToday() {
        let now = Date()
        XCTAssertEqual(TrendsStats.freshness(dateKey: ChartDate.key(now), now: now), "Today")
        let old = Calendar.current.date(byAdding: .day, value: -3, to: now)!
        let label = TrendsStats.freshness(dateKey: ChartDate.key(old), now: now)
        XCTAssertTrue(label.hasPrefix("Latest · "), label)
        XCTAssertEqual(TrendsStats.freshness(dateKey: nil, now: now), "Latest")
    }

    // MARK: Strain scale

    func testStrainScaleTicksAndValueShareOneMapping() {
        XCTAssertEqual(TrendsStrainScale.fraction(0), 0)
        XCTAssertEqual(TrendsStrainScale.fraction(21), 1)
        XCTAssertEqual(TrendsStrainScale.fraction(10.5), 0.5, accuracy: 1e-9)
        XCTAssertEqual(TrendsStrainScale.fraction(14), 14.0 / 21.0, accuracy: 1e-9)
        XCTAssertEqual(TrendsStrainScale.fraction(-1), 0)
        XCTAssertEqual(TrendsStrainScale.fraction(25), 1)
    }

    // MARK: Recent average

    func testRecentAverageUsesLastSevenDaysWithData() {
        var points = (1...10).map { TrendPoint(date: String(format: "2026-09-%02d", $0), raw: Double($0), ma7: nil, ma30: nil) }
        points.append(TrendPoint(date: "2026-09-11", raw: nil, ma7: nil, ma30: nil))
        // Last 7 with data: 4...10 -> mean 7; today's missing value is ignored.
        XCTAssertEqual(TrendsStats.recentAverage(points), 7)
        XCTAssertNil(TrendsStats.recentAverage([]))
        XCTAssertEqual(TrendsStats.recentAverage(Array(points.prefix(3))), 2)
    }

    // MARK: Accessibility summary

    func testHubSummaryIncludesFooterContext() {
        let summary = TrendsA11y.summary(values: [40, 50], unit: "ms", show: { "\(Int($0))" },
                                         context: ["↑ 2 ms vs yesterday", nil, "3 low days"])
        XCTAssertEqual(summary, "Latest 50 ms, average 45. ↑ 2 ms vs yesterday. 3 low days")
        XCTAssertEqual(TrendsA11y.summary(values: [], unit: "", show: { "\($0)" }, context: []), "No data")
    }
}
