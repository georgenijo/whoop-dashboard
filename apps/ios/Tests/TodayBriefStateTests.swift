import Foundation
import XCTest
@testable import Coach

final class TodayBriefStateTests: XCTestCase {
    private var now: String { ISO8601DateFormatter().string(from: Date()) }
    private var yesterday: String { ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86_400)) }

    private func content(
        text: String? = "Brief", createdAt: String?, stale: Bool = false,
        fallback: Bool = false, refreshing: Bool = false
    ) -> TodayBriefContent {
        TodayBriefContent(
            insight: .init(text: text, createdAt: createdAt, isStale: stale),
            isFallback: fallback, isRefreshing: refreshing)
    }

    func testCurrentBriefLeadsAndNothingElseDoes() {
        let current = content(createdAt: now)
        XCTAssertEqual(current.mode, .current)
        XCTAssertTrue(current.leadsToday)
        XCTAssertFalse(current.shouldPoll)
        // Writing a newer brief never hides a current one.
        XCTAssertEqual(content(createdAt: now, refreshing: true).mode, .current)
    }

    func testWithoutCurrentBriefReadingsLeadAndRowHasThreeStates() {
        let writing = TodayBriefContent(insight: nil, isFallback: false, isRefreshing: true)
        XCTAssertEqual(writing.mode, .writing)
        XCTAssertEqual(writing.message, "Writing today's brief…")
        XCTAssertFalse(writing.leadsToday)
        XCTAssertTrue(writing.shouldPoll)

        let unavailable = TodayBriefContent(insight: nil, isFallback: false)
        XCTAssertEqual(unavailable.mode, .unavailable)
        XCTAssertEqual(unavailable.message, "Today's brief isn't available")
        XCTAssertFalse(unavailable.shouldPoll)

        let fallback = TodayBriefContent(insight: nil, isFallback: true, isRefreshing: true)
        XCTAssertEqual(fallback.mode, .fallback)
        XCTAssertFalse(fallback.shouldPoll)
        XCTAssertTrue(fallback.prompt.contains("what is missing"))
    }

    func testStaleOrOldBriefIsNeverCurrentWhileOneIsBeingWritten() {
        for old in [content(createdAt: yesterday, refreshing: true),
                    content(createdAt: now, stale: true, refreshing: true),
                    content(createdAt: nil, refreshing: true)] {
            XCTAssertNil(old.current)
            XCTAssertNotNil(old.previous)
            XCTAssertEqual(old.mode, .writing)
            XCTAssertFalse(old.leadsToday)
        }
        XCTAssertEqual(content(createdAt: yesterday).mode, .unavailable)
    }

    func testOnlyAWritingBriefSitsAboveTheReadings() {
        XCTAssertTrue(TodayBriefContent(insight: nil, isFallback: false, isRefreshing: true).rowAboveReadings)
        XCTAssertFalse(TodayBriefContent(insight: nil, isFallback: false).rowAboveReadings)
        XCTAssertFalse(TodayBriefContent(insight: nil, isFallback: true, isRefreshing: true).rowAboveReadings)
        XCTAssertFalse(content(createdAt: now, refreshing: true).rowAboveReadings)
    }

    private func decode(_ extra: String) throws -> DashboardPayload {
        let json = """
        {"data_date":"2026-11-14","is_fallback":false,"recovery_hero":{},"ai_insight":null,
         "kpi":[],"prs":{},"recovery_trend":[]\(extra)}
        """
        return try JSONDecoder().decode(DashboardPayload.self, from: Data(json.utf8))
    }

    func testNewFieldsDecodeWhenPresent() throws {
        let payload = try decode(#","insight_refreshing":true,"insight_error":"rate_limit""#)
        XCTAssertTrue(payload.insightRefreshing)
        XCTAssertEqual(payload.insightError, "rate_limit")
        let cleared = try decode(#","insight_refreshing":false,"insight_error":null"#)
        XCTAssertFalse(cleared.insightRefreshing)
        XCTAssertNil(cleared.insightError)
    }

    func testNewFieldsDefaultWhenAbsent() throws {
        let payload = try decode("")
        XCTAssertFalse(payload.insightRefreshing)
        XCTAssertNil(payload.insightError)
        XCTAssertNil(payload.aiInsight)
    }

    func testRefreshScheduleIsBounded() {
        XCTAssertEqual(BriefRefreshSchedule.delays, [6, 12, 24, 48])
        XCTAssertEqual(BriefRefreshSchedule.delay(afterAttempt: 0), 6)
        XCTAssertEqual(BriefRefreshSchedule.delay(afterAttempt: 3), 48)
        XCTAssertNil(BriefRefreshSchedule.delay(afterAttempt: 4))
        XCTAssertNil(BriefRefreshSchedule.delay(afterAttempt: -1))
    }

    func testStartersShowOnlyForAnEmptyComposer() {
        XCTAssertTrue(ChatComposerRules.showsStarters(text: "", imageCount: 0))
        XCTAssertTrue(ChatComposerRules.showsStarters(text: " \n ", imageCount: 0))
        XCTAssertFalse(ChatComposerRules.showsStarters(text: "Why is my HRV low?", imageCount: 0))
        XCTAssertFalse(ChatComposerRules.showsStarters(text: "", imageCount: 1))
    }

    // MARK: - Polling arbitration

    func testPollIsBlockedWhileAnExplicitLoadIsInFlight() {
        var loads = DashboardLoadCoordinator()
        let explicit = loads.beginExplicit()
        XCTAssertNil(loads.beginPoll())
        XCTAssertEqual(loads.generation, explicit)
        loads.endExplicit()
        XCTAssertNotNil(loads.beginPoll())
    }

    func testSlowExplicitLoadIsAppliedAndNeverSupersededByAPoll() {
        // The explicit load is still running when the six second poll comes due.
        var loads = DashboardLoadCoordinator()
        let explicit = loads.beginExplicit()
        XCTAssertNil(loads.beginPoll(), "the poll must not start, so it cannot bump the generation")
        XCTAssertTrue(loads.isCurrent(explicit))
        loads.endExplicit()
        XCTAssertTrue(loads.isCurrent(explicit), "the explicit result is applied")
    }

    func testFailedPollOverlappingAnExplicitLoadIsSilentAndExplicitResultApplies() {
        var loads = DashboardLoadCoordinator()
        let poll = try! XCTUnwrap(loads.beginPoll())
        let explicit = loads.beginExplicit()
        // The poll fails (or is cancelled) after the explicit load began.
        XCTAssertFalse(loads.shouldSurfaceFailure(token: poll, polling: true))
        // A poll that fails on its own is silent too.
        var alone = DashboardLoadCoordinator()
        let solo = try! XCTUnwrap(alone.beginPoll())
        XCTAssertTrue(alone.isCurrent(solo))
        XCTAssertFalse(alone.shouldSurfaceFailure(token: solo, polling: true))
        // The explicit load succeeds and its result is applied; the poll's is not.
        XCTAssertTrue(loads.isCurrent(explicit))
        XCTAssertFalse(loads.isCurrent(poll))
        XCTAssertTrue(loads.shouldSurfaceFailure(token: explicit, polling: false))
        loads.endExplicit()
    }

    func testPollDeadlinesAreAnchoredToArmingAndBoundedAtFour() {
        let start = Date(timeIntervalSince1970: 1_000)
        var schedule = BriefPollSchedule()
        XCTAssertNil(schedule.nextDeadline)
        schedule.arm(at: start)
        var offsets: [TimeInterval] = []
        while let deadline = schedule.nextDeadline {
            offsets.append(deadline.timeIntervalSince(start))
            schedule.recordAttempt()
        }
        XCTAssertEqual(offsets, [6, 12, 24, 48])
        XCTAssertNil(schedule.nextDeadline)
    }

    func testALateAttemptDoesNotPushLaterDeadlinesOut() {
        let start = Date(timeIntervalSince1970: 1_000)
        var schedule = BriefPollSchedule()
        schedule.arm(at: start)
        XCTAssertEqual(schedule.nextDeadline, start.addingTimeInterval(6))
        schedule.recordAttempt()   // first poll ran long, finishing at t=15
        XCTAssertEqual(schedule.nextDeadline, start.addingTimeInterval(12))
        schedule.recordAttempt()
        XCTAssertEqual(schedule.nextDeadline, start.addingTimeInterval(24))
    }

    func testRearmingStartsAFreshSchedule() {
        let start = Date(timeIntervalSince1970: 1_000)
        var schedule = BriefPollSchedule()
        schedule.arm(at: start)
        schedule.recordAttempt(); schedule.recordAttempt()
        schedule.arm(at: start.addingTimeInterval(100))
        XCTAssertEqual(schedule.nextDeadline, start.addingTimeInterval(106))
        schedule.disarm()
        XCTAssertNil(schedule.nextDeadline)
    }
}
