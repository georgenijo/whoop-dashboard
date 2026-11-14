import XCTest
@testable import Coach

final class ChatScrollStateTests: XCTestCase {
    func testTerminalToolFailureIsVisibleWithoutErrorText() {
        var tool = LiveToolActivity(name: "query_sleep", stage: "Failed")
        tool.isComplete = true
        XCTAssertNil(tool.error)
        XCTAssertTrue(tool.hasFailed)
        tool.stage = "Complete"
        XCTAssertFalse(tool.hasFailed)
        tool.error = "Connection closed"
        XCTAssertTrue(tool.hasFailed)
    }

    func testReappearingConversationDoesNotRequestAnotherInitialJump() {
        let state = ChatScrollState()
        XCTAssertTrue(state.takeInitialPosition())
        state.viewportHeight = 500
        state.update(bottomEdge: 900)
        XCTAssertFalse(state.takeInitialPosition())
        XCTAssertFalse(state.isAtBottom)
        XCTAssertTrue(ChatScrollState().takeInitialPosition())
    }

    func testReadingOlderContentDoesNotFollowInsertedRows() {
        let state = ChatScrollState()
        state.viewportHeight = 500
        state.update(bottomEdge: 900)
        XCTAssertFalse(state.isAtBottom)
        state.update(bottomEdge: 1_100)
        XCTAssertFalse(state.isAtBottom)
        state.update(bottomEdge: 600)
        XCTAssertTrue(state.isAtBottom)
    }

    func testKeyboardOrFoldResizeRecalculatesWithoutNewMarkerPosition() {
        let state = ChatScrollState()
        state.viewportHeight = 650
        state.update(bottomEdge: 700)
        XCTAssertTrue(state.isAtBottom)
        state.viewportHeight = 350
        XCTAssertFalse(state.isAtBottom)
        state.viewportHeight = 650
        XCTAssertTrue(state.isAtBottom)
    }

    func testMarkerCanArriveBeforeViewportMeasurement() {
        let state = ChatScrollState()
        state.update(bottomEdge: 900)
        state.viewportHeight = 500
        XCTAssertFalse(state.isAtBottom)
    }
}
