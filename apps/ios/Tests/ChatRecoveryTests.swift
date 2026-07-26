import Foundation
import XCTest
@testable import Coach

final class ChatRecoveryTests: XCTestCase {
    func testPriorAssistantDoesNotLookLikeRecoveredReply() {
        let previous = message(id: 10, role: .assistant)

        XCTAssertFalse(
            ChatRecovery.hasNewAssistantReply([previous], afterMessageId: previous.id)
        )
    }

    func testNewAssistantCompletesDroppedTurn() {
        let messages = [
            message(id: 10, role: .assistant),
            message(id: 11, role: .user),
            message(id: 12, role: .assistant),
        ]

        XCTAssertTrue(
            ChatRecovery.hasNewAssistantReply(messages, afterMessageId: 10)
        )
    }

    func testUserAsLastMessageKeepsTurnInFlight() {
        let messages = [
            message(id: 10, role: .assistant),
            message(id: 11, role: .user),
        ]

        XCTAssertFalse(
            ChatRecovery.hasNewAssistantReply(messages, afterMessageId: 10)
        )
    }

    func testFirstReplyCompletesNewThread() {
        XCTAssertTrue(
            ChatRecovery.hasNewAssistantReply(
                [
                    message(id: 1, role: .user),
                    message(id: 2, role: .assistant),
                ],
                afterMessageId: nil
            )
        )
    }

    func testAssistantWithoutCurrentUserDoesNotCompleteTurn() {
        XCTAssertFalse(
            ChatRecovery.hasNewAssistantReply(
                [message(id: 2, role: .assistant)],
                afterMessageId: nil
            )
        )
    }

    func testStaleLocalBaselineStillWaitsForLatestUserReply() {
        let running = [
            message(id: 10, role: .assistant),
            message(id: 11, role: .user),
            message(id: 12, role: .assistant),
            message(id: 13, role: .user),
        ]
        XCTAssertFalse(
            ChatRecovery.hasNewAssistantReply(running, afterMessageId: 10)
        )

        let completed = running + [message(id: 14, role: .assistant)]
        XCTAssertTrue(
            ChatRecovery.hasNewAssistantReply(completed, afterMessageId: 10)
        )
    }

    private func message(id: Int, role: ChatMessage.Role) -> ChatMessage {
        ChatMessage(
            id: id,
            role: role,
            content: "content",
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }
}
