import XCTest
@testable import Coach

final class StatsFormatTests: XCTestCase {
    func testChangeIsPercentOfPriorNotAbsoluteDelta() {
        XCTAssertEqual(StatsFormat.change(current: 221, prior: 65), .percent(240))
        XCTAssertEqual(StatsFormat.change(current: 47.2, prior: 99.2), .percent(-52))
        XCTAssertEqual(StatsFormat.change(current: 55_327, prior: 16_155), .percent(242))
    }

    func testChangeEdgeCases() {
        XCTAssertEqual(StatsFormat.change(current: 5, prior: 0), .new)
        XCTAssertNil(StatsFormat.change(current: 0, prior: 0))
        XCTAssertNil(StatsFormat.change(current: nil, prior: 10))
        XCTAssertEqual(StatsFormat.change(current: 120, prior: 10), .multiple(12))
        XCTAssertEqual(StatsFormat.Change.percent(-52).text, "−52%")
        XCTAssertEqual(StatsFormat.Change.percent(240).text, "+240%")
    }

    func testRecordValueSplitsDurationsAndUnits() {
        XCTAssertEqual(StatsFormat.recordValue("40:52").parts,
                       [.init(number: "40", unit: "h"), .init(number: "52", unit: "m")])
        XCTAssertEqual(StatsFormat.recordValue("0:45").parts, [.init(number: "45", unit: "m")])
        XCTAssertEqual(StatsFormat.recordValue("1,972 cal").parts, [.init(number: "1,972", unit: "cal")])
        XCTAssertEqual(StatsFormat.recordValue("20.0").parts, [.init(number: "20.0", unit: nil)])
    }

    func testCompact() {
        XCTAssertEqual(StatsFormat.compact(221_646), "222k")
        XCTAssertEqual(StatsFormat.compact(55_327), "55.3k")
        XCTAssertEqual(StatsFormat.compact(1_972), "1,972")
    }

    func testPartialMonthsFollowTheWindow() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let today = cal.date(from: DateComponents(year: 2026, month: 9, day: 26))!
        // 90-day window starts Jun 29: June is cut off, July and August are whole, September is in progress.
        XCTAssertTrue(StatsFormat.isPartial(month: "2026-06", windowDays: 90, today: today, calendar: cal))
        XCTAssertFalse(StatsFormat.isPartial(month: "2026-07", windowDays: 90, today: today, calendar: cal))
        XCTAssertFalse(StatsFormat.isPartial(month: "2026-08", windowDays: 90, today: today, calendar: cal))
        XCTAssertTrue(StatsFormat.isPartial(month: "2026-09", windowDays: 90, today: today, calendar: cal))
        XCTAssertTrue(StatsFormat.isCurrentMonth("2026-09", today: today, calendar: cal))
        XCTAssertFalse(StatsFormat.isCurrentMonth("2026-08", today: today, calendar: cal))
    }

    func testMissingHistoryFloorDecodes() throws {
        let json = """
        {"range_label":"Last 7 days","all_time":{"workouts":0,"active_seconds":null,"distance_m":null,"kilojoules":null},
         "yoy":{"year":2026,"prior_year":2025,"period_label":"Jan 1 – Sep 26","metrics":[]},
         "by_sport":[],"records":[],"trend":[],"history_floor":null}
        """
        let payload = try JSONDecoder().decode(StatsPayload.self, from: Data(json.utf8))
        XCTAssertNil(payload.historyFloor)
    }
}
