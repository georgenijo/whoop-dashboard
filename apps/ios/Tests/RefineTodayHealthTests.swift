import Foundation
import XCTest
@testable import Coach

final class RefineTodayHealthTests: XCTestCase {
    private var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    // MARK: Today

    func testSoFarDerivesYesterdayFromValueAndDelta() {
        XCTAssertEqual(TodayFormat.soFar(value: 3.1, deltaLabel: "↓ 11.5 vs yesterday", precision: 1),
                       "so far · 14.6 yesterday")
        XCTAssertEqual(TodayFormat.soFar(value: 2140, deltaLabel: "↓ 7,672 vs yesterday", precision: 0),
                       "so far · 9,812 yesterday")
        XCTAssertEqual(TodayFormat.soFar(value: 26, deltaLabel: "↓8211 vs yesterday", precision: 0),
                       "so far · 8,237 yesterday")
    }

    func testSoFarFallsBackWhenYesterdayIsUnknown() {
        XCTAssertEqual(TodayFormat.soFar(value: 3.1, deltaLabel: nil, precision: 1), "so far")
        XCTAssertEqual(TodayFormat.soFar(value: 3.1, deltaLabel: "— baseline", precision: 1), "so far")
        XCTAssertEqual(TodayFormat.soFar(value: nil, deltaLabel: "↓ 1", precision: 1), "so far")
    }

    func testSignedAmountUsesTheArrowNotTheImprovementSignal() {
        XCTAssertEqual(TodayFormat.signedAmount(of: "↑ 4 bpm vs yesterday"), 4)
        XCTAssertEqual(TodayFormat.signedAmount(of: "↓ 1,204 vs yesterday"), -1204)
        XCTAssertNil(TodayFormat.signedAmount(of: "no arrow"))
    }

    func testSoFarRequiresARealYesterdayComparison() {
        // "vs 6 days ago" must not be relabeled as yesterday.
        XCTAssertNil(TodayFormat.soFar(value: 1000, deltaLabel: "↓ 4000 vs 6 days ago", precision: 0))
        XCTAssertNil(TodayFormat.soFar(value: 1000, deltaLabel: "↓ 4000", precision: 0))
        XCTAssertEqual(TodayFormat.soFar(value: 1000, deltaLabel: "↓ 4000 vs yesterday", precision: 0),
                       "so far · 5,000 yesterday")
    }

    func testEachMetricIsPartialOnlyWhenItsOwnReadingIsToday() {
        let now = Date()
        let today = ChartDate.key(now)
        let yesterday = ChartDate.key(now.addingTimeInterval(-86_400))
        // Today's recovery with yesterday's steps: steps is a completed day.
        let keys = TodayFormat.partialKeys(metricDates: [.steps: yesterday, .strain: today], isFallback: false, now: now)
        XCTAssertEqual(keys, [.strain])
        XCTAssertEqual(TodayFormat.partialKeys(metricDates: [.steps: today, .strain: today], isFallback: true, now: now), [])
        XCTAssertEqual(TodayFormat.partialKeys(metricDates: [:], isFallback: false, now: now), [])
        // Only accumulating metrics qualify.
        XCTAssertEqual(TodayFormat.partialKeys(metricDates: [.hrv: today], isFallback: false, now: now), [])
    }

    func testFreshnessLineIsOneLine() throws {
        let line = try XCTUnwrap(TodayFormat.freshness(dataDate: "2026-11-14", updatedAt: nil, isFallback: false))
        XCTAssertTrue(line.contains("Nov 14"))
        XCTAssertTrue(line.hasPrefix("Saturday"))
        XCTAssertFalse(line.contains("Synced"))
        let fallback = try XCTUnwrap(TodayFormat.freshness(dataDate: "2026-11-13", updatedAt: nil, isFallback: true))
        XCTAssertTrue(fallback.hasPrefix("No reading for today"))
        XCTAssertNil(TodayFormat.freshness(dataDate: nil, updatedAt: nil, isFallback: false))
    }

    func testSyncedTextNamesTheDayWhenNotToday() throws {
        let now = ISO8601DateFormatter().date(from: "2026-11-14T12:00:00Z")!
        let old = try XCTUnwrap(TodayFormat.syncedText("2026-11-10T08:21:00Z", now: now, calendar: utc))
        XCTAssertTrue(old.hasPrefix("Synced "))
        XCTAssertFalse(old.contains(":"))
        let same = try XCTUnwrap(TodayFormat.syncedText("2026-11-14T08:21:00Z", now: now, calendar: utc))
        XCTAssertTrue(same.contains(":"))
    }

    func testRecordItemsKeepOnlyPresentRecords() {
        let prs = DashboardPayload.PRs(
            bestHrv: .init(value: 78.4, date: "2026-08-03"), lowestRhr: nil,
            recoveryStreak: .init(count: 1, startDate: "2026-11-09", endDate: "2026-11-09"),
            sleepPerfStreak: nil, loggingStreak: nil)
        let items = DashboardView.recordItems(prs)
        XCTAssertEqual(items.map(\.id), ["hrv", "rec"])
        XCTAssertEqual(items[0].value, 78)
        XCTAssertEqual(items[1].unit, "day")
    }

    func testBaselineText() {
        let text = RecoveryHeroView.baselineText(score: 48, baseline: 61.2)
        XCTAssertEqual(text.delta, "−13")
        XCTAssertEqual(text.rest, "vs 30-day average of 61%")
    }

    // MARK: Zones

    func testZoneBandsMapAtTheirBoundaries() {
        XCTAssertEqual(RecoveryZone(score: 0).bandName, "Low")
        XCTAssertEqual(RecoveryZone(score: 33).bandName, "Low")
        XCTAssertEqual(RecoveryZone(score: 34).bandName, "Moderate")
        XCTAssertEqual(RecoveryZone(score: 66).bandName, "Moderate")
        XCTAssertEqual(RecoveryZone(score: 67).bandName, "High")
        XCTAssertEqual(RecoveryZone(score: 100).bandName, "High")
        XCTAssertEqual(ZoneScale.zones.map(\.bandRange), ["0–33", "34–66", "67–100"])
    }

    func testPinStaysOnTheScale() {
        XCTAssertEqual(ZoneScale.pinFraction(48), 0.48, accuracy: 0.0001)
        XCTAssertEqual(ZoneScale.pinFraction(-5), 0)
        XCTAssertEqual(ZoneScale.pinFraction(140), 1)
    }

    // MARK: Trends

    func testPartialDateOnlyWhenTodayHasAValue() {
        let now = Date()
        let today = ChartDate.key(now)
        let points = [TrendPoint(date: "2020-01-01", raw: 9, ma7: nil, ma30: nil),
                      TrendPoint(date: today, raw: 3, ma7: nil, ma30: nil)]
        XCTAssertEqual(TrendsStats.partialDate(points, now: now), today)
        XCTAssertNil(TrendsStats.partialDate([points[0]], now: now))
        XCTAssertNil(TrendsStats.partialDate([TrendPoint(date: today, raw: nil, ma7: nil, ma30: nil)], now: now))
    }

    func testPartialDayIsLeftOutOfTheAverage() {
        let points = [TrendPoint(date: "2026-11-12", raw: 10, ma7: 10, ma30: nil),
                      TrendPoint(date: "2026-11-13", raw: 14, ma7: 12, ma30: nil),
                      TrendPoint(date: "2026-11-14", raw: 1, ma7: 8, ma30: nil)]
        XCTAssertEqual(MetricChart.completeValues(points, partialDate: "2026-11-14"), [10, 14])
        XCTAssertEqual(MetricChart.completeValues(points, partialDate: nil), [10, 14, 1])
    }

    func testPreviousDayValueNeedsTheRealPreviousDay() {
        let points = [TrendPoint(date: "2026-11-12", raw: 9, ma7: nil, ma30: nil),
                      TrendPoint(date: "2026-11-14", raw: 2, ma7: nil, ma30: nil)]
        // Nov 13 is missing, so Nov 12 must not be called "yesterday".
        XCTAssertNil(MetricChart.previousDayValue(points: points, of: "2026-11-14"))
        let full = points + [TrendPoint(date: "2026-11-13", raw: 7, ma7: nil, ma30: nil)]
        XCTAssertEqual(MetricChart.previousDayValue(points: full, of: "2026-11-14"), 7)
    }

    func testRecentAverageExcludesThePartialDay() {
        var points = (1...7).map { TrendPoint(date: String(format: "2026-11-%02d", $0), raw: 10_000, ma7: nil, ma30: nil) }
        points.append(TrendPoint(date: "2026-11-08", raw: 1_000, ma7: nil, ma30: nil))
        XCTAssertEqual(TrendsStats.recentAverage(points, excluding: "2026-11-08"), 10_000)
        XCTAssertEqual(try XCTUnwrap(TrendsStats.recentAverage(points)), 8_714.2857, accuracy: 0.01)
    }

    func testVoiceOverSummaryAnnouncesPartialLatestAndSkipsItInTheAverage() {
        let show: (Double) -> String = { String(Int($0.rounded())) }
        let summary = TrendsA11y.summary(values: Array(repeating: 10_000, count: 7), unit: "", show: show,
                                         context: [], partialLatest: 1_000)
        XCTAssertEqual(summary, "Latest 1000 so far today, a partial day, average of completed days 10000")
        XCTAssertEqual(TrendsA11y.summary(values: [40, 50], unit: "ms", show: show, context: []),
                       "Latest 50 ms, average 45")
    }

    func testRangeCaptionCountsTheWindowInclusively() {
        let now = ISO8601DateFormatter().date(from: "2026-11-14T12:00:00Z")!
        let caption = TrendsFormat.rangeCaption(days: 30, now: now, calendar: utc)
        XCTAssertEqual(caption, "Oct 16 – Nov 14 · today is partial")
    }

    // MARK: Progress

    func testYoyVerdict() {
        let up = StatsFormat.Change.percent(34), down = StatsFormat.Change.percent(-26)
        XCTAssertEqual(StatsFormat.yoyVerdict(changes: [up, up, up, down], priorYear: 2025),
                       "Ahead of 2025 on 3 of 4 measures so far.")
        XCTAssertEqual(StatsFormat.yoyVerdict(changes: [up, up], priorYear: 2025),
                       "Ahead of 2025 on all 2 measures so far.")
        XCTAssertEqual(StatsFormat.yoyVerdict(changes: [down, down, up], priorYear: 2025),
                       "Ahead of 2025 on 1 of 3 measures so far.")
        XCTAssertEqual(StatsFormat.yoyVerdict(changes: [down, down], priorYear: 2025),
                       "Behind 2025 on all 2 measures so far.")
        XCTAssertEqual(StatsFormat.yoyVerdict(changes: [.flat], priorYear: 2025), "Level with 2025 so far.")
        XCTAssertNil(StatsFormat.yoyVerdict(changes: [], priorYear: 2025))
    }

    func testPartialCaptionNamesTheCurrentMonth() {
        let window = StatsFormat.Window(start: "2026-08-17", end: "2026-11-14")
        XCTAssertEqual(StatsFormat.partialCaption(trend: [("2026-10", false), ("2026-11", true)], window: window),
                       "Faded bar: November so far.")
        XCTAssertEqual(StatsFormat.partialCaption(trend: [("2026-08", true), ("2026-11", true)], window: window),
                       "Faded bars are partial months.")
        XCTAssertNil(StatsFormat.partialCaption(trend: [("2026-10", false)], window: window))
    }

    func testWindowCaption() {
        XCTAssertEqual(StatsFormat.windowCaption(.init(start: "2026-08-17", end: "2026-11-14")), "Aug 17 – Nov 14")
    }

    func testSportColorsAreStableAndFromThePalette() {
        XCTAssertEqual(SportPalette.color(for: "unknown_sport_x"), SportPalette.color(for: "unknown_sport_x"))
        XCTAssertEqual(SportPalette.color(for: "Weightlifting"), Theme.Palette.hrv)
    }

    // MARK: Recovery and Sleep

    func testRecoveryFactorsAreNeutralAndCarryAnAverage() {
        let hrv = (0..<10).map { i -> TrendPoint in
            let d = ChartDate.key(Date().addingTimeInterval(Double(-i) * 86_400))
            return TrendPoint(date: d, raw: 46, ma7: nil, ma30: nil)
        }
        let payload = RecoveryPayload(
            rangeLabel: "30 days",
            kpi: [
                KPITile(key: .recovery, label: "Recovery", value: 48, unit: "%", precision: 0, delta: nil, href: nil, colorHex: "#000"),
                KPITile(key: .hrv, label: "HRV", value: 41, unit: "ms", precision: 0,
                        delta: .init(label: "↓ 5 ms vs yesterday", dir: .down), href: nil, colorHex: "#000"),
                KPITile(key: .sleep, label: "Sleep", value: 5.3, unit: "h", precision: 1, delta: nil, href: nil, colorHex: "#000")
            ],
            recoveryTrend: hrv,
            hrvTrend: .init(points: hrv, anomalies: []),
            rhrTrend: [],
            spo2Trend: nil)
        let factors = RecoveryLogic.factors(payload, baseline: payload)
        XCTAssertEqual(factors.map(\.label), ["HRV", "Time in bed"])
        XCTAssertEqual(factors[0].delta, "↓ 5 ms")
        XCTAssertEqual(factors[0].average, "46")
        XCTAssertEqual(factors[0].unit, "ms")
        XCTAssertEqual(factors[1].value, "5h 18m")
        XCTAssertEqual(factors[1].unit, "")
        XCTAssertNil(factors[1].average)
    }

    private func recoveryPayload(days: Int, hrv: Double) -> RecoveryPayload {
        let points = (0..<days).map { i -> TrendPoint in
            TrendPoint(date: ChartDate.key(Date().addingTimeInterval(Double(-i) * 86_400)), raw: hrv, ma7: nil, ma30: nil)
        }
        return RecoveryPayload(
            rangeLabel: "", kpi: [
                KPITile(key: .hrv, label: "HRV", value: 41, unit: "ms", precision: 0, delta: nil, href: nil, colorHex: "#000"),
                KPITile(key: .sleep, label: "Sleep", value: 5.3, unit: "h", precision: 1, delta: nil, href: nil, colorHex: "#000")
            ],
            recoveryTrend: points, hrvTrend: .init(points: points, anomalies: []), rhrTrend: [], spo2Trend: nil)
    }

    func testBaselineNeverFollowsTheRangePicker() {
        let seven = recoveryPayload(days: 7, hrv: 40)
        let thirty = recoveryPayload(days: 30, hrv: 70)
        // A 7-day range uses only the fetched 30-day history, never itself.
        XCTAssertNil(RecoveryLogic.baselinePayload(rangeDays: 7, current: seven, fetched: nil))
        XCTAssertEqual(RecoveryLogic.baselinePayload(rangeDays: 7, current: seven, fetched: thirty)?.hrvTrend.points.count, 30)
        XCTAssertEqual(RecoveryLogic.baselinePayload(rangeDays: 90, current: thirty, fetched: nil)?.hrvTrend.points.count, 30)
        // Without a baseline there is no "avg", rather than a 7-day one labeled 30.
        XCTAssertNil(RecoveryLogic.factors(seven, baseline: nil)[0].average)
        XCTAssertEqual(RecoveryLogic.factors(seven, baseline: thirty)[0].average, "70")
    }

    func testSleepBaselineTrendFollowsTheSameRule() {
        let short = [TrendPoint(date: "2026-11-14", raw: 50, ma7: nil, ma30: nil)]
        let long = [TrendPoint(date: "2026-11-13", raw: 80, ma7: nil, ma30: nil)]
        XCTAssertNil(SleepLogic.baselineTrend(rangeDays: 14, current: short, fetched: nil))
        XCTAssertEqual(SleepLogic.baselineTrend(rangeDays: 14, current: short, fetched: long)?.first?.raw, 80)
        XCTAssertEqual(SleepLogic.baselineTrend(rangeDays: 30, current: long, fetched: nil)?.first?.raw, 80)
    }

    func testRecoveryCaptionSaysInBed() {
        let caption = RecoveryLogic.caption(recoveryPayload(days: 10, hrv: 46))
        XCTAssertTrue(caption?.hasSuffix("after 5h 18m in bed") == true)
        XCTAssertFalse(caption?.contains("asleep") == true)
    }

    func testSleepStagePercentsIncludeAwakeAndAddUp() {
        let stages = SleepPayload.LatestSleep.Stages(lightMs: 9_660_000, deepMs: 4_320_000, remMs: 5_100_000, awakeMs: 1_860_000)
        let entries = SleepStageBarView.entries(stages)
        XCTAssertEqual(entries.map(\.name), ["Awake", "Light", "Deep", "REM"])
        XCTAssertEqual(entries.map(\.percent), [9, 46, 21, 24])
        XCTAssertEqual(entries.map(\.percent).reduce(0, +), 100)
    }

    func testEfficiencyIsAsleepOverInBed() {
        let stages = SleepPayload.LatestSleep.Stages(lightMs: 9_660_000, deepMs: 4_320_000, remMs: 5_100_000, awakeMs: 1_860_000)
        XCTAssertEqual(SleepLogic.efficiencyPercent(stages), 91)
        XCTAssertNil(SleepLogic.efficiencyPercent(.init(lightMs: 0, deepMs: 0, remMs: 0, awakeMs: 0)))
    }

    func testSleepNeedPartsAddUpToTheTotal() {
        let need = SleepPayload.LatestSleep.NeedBreakdown(baselineMs: 27_000_000, debtMs: 6_600_000, strainMs: 1_500_000, napMs: 0)
        XCTAssertEqual(SleepNeedBreakdownView.total(need), 35_100_000)
        let parts = SleepNeedBreakdownView.parts(need)
        XCTAssertEqual(parts.map(\.label), ["Baseline", "From strain", "Sleep debt", "Nap credit"])
        XCTAssertEqual(SleepNeedBreakdownView.format(parts[1]), "+25m")
        XCTAssertEqual(SleepNeedBreakdownView.format(parts[3]), "0m")
    }
}
