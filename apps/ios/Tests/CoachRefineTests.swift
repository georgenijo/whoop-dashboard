import XCTest
import UserNotifications
@testable import Coach

final class CoachRefineTests: XCTestCase {
    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    private func date(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)!
    }

    private func thread(_ id: Int, _ title: String?, _ updated: String, preview: String? = nil) -> ChatThread {
        ChatThread(id: id, title: title, updatedAt: date(updated), messageCount: 2, lastPreview: preview)
    }

    // MARK: Thread list

    func testGroupsThreadsByRecency() {
        let now = date("2026-11-14T15:00:00Z")
        let groups = ThreadGroup.group([
            thread(1, "Today A", "2026-11-14T08:00:00Z"),
            thread(2, "Yesterday", "2026-11-13T23:30:00Z"),
            thread(3, "Three days", "2026-11-11T10:00:00Z"),
            thread(4, "Old", "2026-10-01T10:00:00Z"),
            thread(5, "Today B", "2026-11-14T12:00:00Z"),
        ], now: now, calendar: calendar)
        XCTAssertEqual(groups.map(\.title), ["Today", "Yesterday", "Previous 7 days", "Earlier"])
        XCTAssertEqual(groups[0].threads.map(\.id), [5, 1], "newest first within a group")
        XCTAssertEqual(groups[1].threads.map(\.id), [2])
    }

    func testEmptyGroupsAreDropped() {
        let now = date("2026-11-14T15:00:00Z")
        let groups = ThreadGroup.group([thread(1, "Only old", "2026-09-01T10:00:00Z")], now: now, calendar: calendar)
        XCTAssertEqual(groups.map(\.title), ["Earlier"])
    }

    func testSearchMatchesTitleAndPreviewIgnoringCaseAndAccents() {
        let threads = [
            thread(1, "Should I deload this week?", "2026-11-14T08:00:00Z", preview: "Not yet. HRV is steady."),
            thread(2, "Leg day plan", "2026-11-13T08:00:00Z", preview: "Back squat 5x5, then RDLs"),
            thread(3, nil, "2026-11-12T08:00:00Z", preview: "Café stop before the run"),
        ]
        XCTAssertEqual(ThreadListLogic.filter(threads, query: "DELOAD").map(\.id), [1])
        XCTAssertEqual(ThreadListLogic.filter(threads, query: "squat").map(\.id), [2])
        XCTAssertEqual(ThreadListLogic.filter(threads, query: "cafe").map(\.id), [3])
        XCTAssertEqual(ThreadListLogic.filter(threads, query: "  ").map(\.id), [1, 2, 3])
        XCTAssertTrue(ThreadListLogic.filter(threads, query: "zzz").isEmpty)
    }

    func testUntitledThreadsMatchTheirDisplayTitle() {
        let threads = [thread(1, nil, "2026-11-14T08:00:00Z")]
        XCTAssertEqual(ThreadListLogic.filter(threads, query: "untitled").map(\.id), [1])
    }

    @MainActor
    func testRowStateReflectsInFlightTurn() {
        let store = ChatInFlightStore()
        store.inFlight[7] = ChatInFlightTurn(baselineMessageId: 3, pendingText: "  Should I play Thursday?  ")
        store.inFlight[8] = ChatInFlightTurn(baselineMessageId: nil)
        XCTAssertEqual(ThreadListLogic.rowState(for: 1, inFlight: store.inFlight), .idle)
        XCTAssertEqual(
            ThreadListLogic.rowState(for: 7, inFlight: store.inFlight),
            .replying(question: "Should I play Thursday?")
        )
        XCTAssertEqual(ThreadListLogic.rowState(for: 8, inFlight: store.inFlight), .replying(question: nil))
    }

    // MARK: Pane layout

    func testPanesSplitAtTheFoldOnTheInnerDisplay() throws {
        let layout = try XCTUnwrap(CoachPaneLayout.compute(
            fold: FoldGeometry(width: 867, hinge: 455 ... 495), regular: true))
        XCTAssertEqual(layout.sidebarWidth, 495, "the conversation starts where the fold ends")
        XCTAssertEqual(layout.listTrailingInset, 40, "list rows stop where the fold begins")
        XCTAssertTrue(layout.pinsSidebar)
        XCTAssertEqual(layout.sidebarWidth - layout.listTrailingInset, 455)
    }

    func testCompactWidthHasNoPaneLayout() {
        XCTAssertNil(CoachPaneLayout.compute(fold: FoldGeometry(width: 382, hinge: nil), regular: false))
        XCTAssertNil(CoachPaneLayout.compute(fold: .none, regular: true))
    }

    func testRegularWidthWithoutFoldUsesBoundedSidebarAndStaysClosable() throws {
        let layout = try XCTUnwrap(CoachPaneLayout.compute(fold: FoldGeometry(width: 900, hinge: nil), regular: true))
        XCTAssertEqual(layout.sidebarWidth, 360)
        XCTAssertEqual(layout.listTrailingInset, 0)
        XCTAssertFalse(layout.pinsSidebar)
    }

    func testHingeThatStarvesAPaneFallsBack() throws {
        let layout = try XCTUnwrap(CoachPaneLayout.compute(
            fold: FoldGeometry(width: 867, hinge: 700 ... 740), regular: true))
        XCTAssertFalse(layout.pinsSidebar)
    }

    // MARK: Stop reconciliation

    private func message(_ id: Int, _ role: ChatMessage.Role) -> ChatMessage {
        ChatMessage(id: id, role: role, content: "x", createdAt: .now)
    }

    func testStoppedTurnIsPersistedOnceHistoryHoldsNewerMessages() {
        let before = [message(10, .user), message(11, .assistant)]
        XCTAssertFalse(ChatRecovery.hasPersistedTurn(before, afterMessageId: 11))
        let after = before + [message(12, .user), message(13, .assistant)]
        XCTAssertTrue(ChatRecovery.hasPersistedTurn(after, afterMessageId: 11))
        XCTAssertTrue(ChatRecovery.hasPersistedTurn([message(1, .user)], afterMessageId: nil))
        XCTAssertFalse(ChatRecovery.hasPersistedTurn([], afterMessageId: nil))
    }

    func testStreamControlCancelsOnce() {
        let control = ChatStreamControl()
        var count = 0
        control.cancel = { count += 1 }
        control.stop()
        XCTAssertEqual(count, 1)
    }

    // MARK: Plans

    private func plan(
        title: String = "Upper/lower split",
        author: WorkoutPlan.Author = .coach,
        days: [WorkoutPlan.Day]
    ) -> WorkoutPlan {
        WorkoutPlan(
            id: 1, title: title, tag: "strength", description: nil, createdBy: author, isActive: true,
            plan: .init(days: days, why: nil), recoveryContext: nil,
            createdAt: "2026-11-02T08:00:00.000Z", updatedAt: "2026-11-09T08:00:00.000Z"
        )
    }

    private func day(_ name: String, _ intensity: WorkoutPlan.Intensity, exercises: Int) -> WorkoutPlan.Day {
        .init(name: name, focus: nil, intensity: intensity, exercises: (0..<exercises).map {
            .init(name: "Lift \($0)", scheme: "3x8", note: nil)
        })
    }

    func testRestDaysAreNotNumbered() {
        let days = [day("Push", .hard, exercises: 3), day("Rest", .rest, exercises: 0),
                    day("Pull", .moderate, exercises: 2), day("Walk", .reduced, exercises: 0)]
        XCTAssertEqual(PlansPresentation.sessionNumbers(days), [1, nil, 2, nil])
        let p = plan(days: days)
        XCTAssertEqual(PlansPresentation.sessionCount(p), 2)
        XCTAssertEqual(PlansPresentation.countText(p), "2 sessions")
    }

    func testSavedMetaAndProvenance() {
        let p = plan(days: [day("Push", .hard, exercises: 1)])
        XCTAssertEqual(PlansPresentation.countText(p), "1 session")
        XCTAssertTrue(PlansPresentation.savedMeta(p).hasPrefix("1 session · by Coach · updated "))
        let provenance = try? XCTUnwrap(PlansPresentation.provenance(p))
        XCTAssertTrue(provenance?.hasPrefix("Made by Coach on ") == true)
        XCTAssertTrue(provenance?.contains("updated") == true)
        XCTAssertNil(PlansPresentation.authorText(.unknown))
    }

    func testWeekdaysAreNamedNotInitials() throws {
        let tue = try XCTUnwrap(PlansPresentation.dayParts("2026-11-10"))
        let thu = try XCTUnwrap(PlansPresentation.dayParts("2026-11-12"))
        XCTAssertEqual(tue.weekday, "Tue")
        XCTAssertEqual(thu.weekday, "Thu")
        XCTAssertEqual(tue.day, "Nov 10")
        XCTAssertNil(PlansPresentation.dayParts("garbage"))
    }

    func testExerciseSummaryTruncates() {
        let d = day("Push", .hard, exercises: 6)
        XCTAssertEqual(PlansPresentation.exerciseSummary(d, limit: 4), "Lift 0, Lift 1, Lift 2, Lift 3 +2")
        XCTAssertEqual(PlansPresentation.exerciseSummary(day("Two", .hard, exercises: 2)), "Lift 0, Lift 1")
    }

    func testPercentFormatting() {
        XCTAssertEqual(PlansPresentation.percent(47.6), "48%")
        XCTAssertEqual(PlansPresentation.signedPercent(18), "+18%")
        XCTAssertEqual(PlansPresentation.signedPercent(-4.2), "-4%")
    }

    func testRecoveryBandsMapToThemeNotNeonHex() {
        XCTAssertEqual(RecoveryBand(score: 20).ruleLabel, "Low")
        XCTAssertEqual(RecoveryBand(score: 48).range, "34–66%")
        XCTAssertEqual(RecoveryBand(serverBand: "high", score: 10), .high)
    }

    // MARK: Settings

    func testInstructionsPreviewCollapsesAndTruncates() {
        XCTAssertNil(SettingsFormat.instructionsPreview("  \n "))
        XCTAssertEqual(SettingsFormat.instructionsPreview("I play soccer.\n\nKeep it short."), "“I play soccer. Keep it short.”")
        let long = String(repeating: "word ", count: 40)
        let preview = SettingsFormat.instructionsPreview(long, limit: 20)
        XCTAssertEqual(preview?.hasSuffix("…”"), true)
        XCTAssertLessThanOrEqual(preview?.count ?? 99, 24)
    }

    func testSyncTimeNamesTodayAndYesterday() {
        let now = date("2026-11-14T15:00:00Z")
        XCTAssertTrue(SettingsFormat.syncTime(date("2026-11-14T08:21:00Z"), now: now, calendar: calendar).hasPrefix("Today "))
        XCTAssertTrue(SettingsFormat.syncTime(date("2026-11-13T18:40:00Z"), now: now, calendar: calendar).hasPrefix("Yesterday "))
        XCTAssertFalse(SettingsFormat.syncTime(date("2026-11-01T18:40:00Z"), now: now, calendar: calendar).contains("Today"))
    }

    func testModelLabelAndNotificationState() {
        XCTAssertEqual(SettingsFormat.modelLabel(model: "Sonnet 5.5", effort: "Medium"), "Sonnet 5.5 · Medium")
        XCTAssertEqual(SettingsFormat.modelLabel(model: "Sonnet 5.5", effort: nil), "Sonnet 5.5")
        XCTAssertEqual(SettingsFormat.NotificationState(.authorized), .enabled)
        XCTAssertEqual(SettingsFormat.NotificationState(.denied), .disabled)
        XCTAssertEqual(SettingsFormat.NotificationState(.notDetermined), .notAsked)
    }

    // MARK: Answer blocks

    func testMetricStripColumnsFollowWidthAndTypeSize() {
        XCTAssertEqual(MetricStripColumns.count(width: 640, metrics: 4, accessibilitySize: false), 4)
        XCTAssertEqual(MetricStripColumns.count(width: 356, metrics: 4, accessibilitySize: false), 2)
        XCTAssertEqual(MetricStripColumns.count(width: 640, metrics: 2, accessibilitySize: false), 2)
        XCTAssertEqual(MetricStripColumns.count(width: 640, metrics: 4, accessibilitySize: true), 1)
        XCTAssertEqual(MetricStripColumns.count(width: 10, metrics: 4, accessibilitySize: false), 1)
        XCTAssertEqual(MetricStripColumns.count(width: 450, metrics: 4, accessibilitySize: false), 2, "no orphan cell in a 3+1 grid")
        XCTAssertEqual(MetricStripColumns.count(width: 450, metrics: 6, accessibilitySize: false), 3)
    }
}
