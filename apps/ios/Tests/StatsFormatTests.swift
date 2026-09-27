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
        XCTAssertEqual(StatsFormat.change(current: 0, prior: 0), .flat)
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

    func testSmallDecreasesAndTiesAreNotAhead() {
        // -0.1% must not round to a green "+0%".
        XCTAssertEqual(StatsFormat.change(current: 999, prior: 1000), .flat)
        XCTAssertEqual(StatsFormat.change(current: 1000, prior: 1000), .flat)
        XCTAssertEqual(StatsFormat.change(current: 990, prior: 1000), .percent(-1))
        XCTAssertEqual(StatsFormat.Change.flat.direction, .flat)
        XCTAssertEqual(StatsFormat.Change.percent(-1).direction, .down)
        XCTAssertEqual(StatsFormat.Change.percent(3).direction, .up)
    }

    func testPartialMonthsFollowTheServerWindow() {
        // 90-day window Jun 29 ... Sep 26: June is cut off, July and August are
        // whole, September is still accumulating.
        let window = StatsFormat.Window(start: "2026-06-29", end: "2026-09-26")
        XCTAssertTrue(StatsFormat.isPartial(month: "2026-06", window: window))
        XCTAssertFalse(StatsFormat.isPartial(month: "2026-07", window: window))
        XCTAssertFalse(StatsFormat.isPartial(month: "2026-08", window: window))
        XCTAssertTrue(StatsFormat.isPartial(month: "2026-09", window: window))
        XCTAssertTrue(StatsFormat.isCurrentMonth("2026-09", window: window))
        XCTAssertFalse(StatsFormat.isCurrentMonth("2026-08", window: window))
    }

    func testWindowStartingOnTheFirstIsWhole() {
        // Server date Sep 28 → 90-day window starts Jul 1: July is whole even if
        // the device is already on Sep 29.
        let window = StatsFormat.Window(start: "2026-07-01", end: "2026-09-28")
        XCTAssertFalse(StatsFormat.isPartial(month: "2026-07", window: window))
    }

    func testFallbackWindowIsGregorianRegardlessOfDeviceCalendar() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let today = cal.date(from: DateComponents(year: 2026, month: 9, day: 26, hour: 12))!
        let window = StatsFormat.Window.fallback(days: 90, today: today)
        XCTAssertEqual(window, StatsFormat.Window(start: "2026-06-29", end: "2026-09-26"))
    }

    func testWindowDecodesWhenPresent() throws {
        let json = """
        {"range_label":"Last 90 days","all_time":{"workouts":1,"active_seconds":null,"distance_m":null,"kilojoules":null},
         "yoy":{"year":2026,"prior_year":2025,"period_label":"Jan 1 – Sep 26","metrics":[]},
         "by_sport":[],"records":[],"trend":[],"history_floor":null,
         "window_start":"2026-06-29","window_end":"2026-09-26"}
        """
        let payload = try JSONDecoder().decode(StatsPayload.self, from: Data(json.utf8))
        XCTAssertEqual(payload.window(fallbackDays: 7), StatsFormat.Window(start: "2026-06-29", end: "2026-09-26"))
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
