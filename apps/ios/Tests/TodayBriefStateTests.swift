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
}
