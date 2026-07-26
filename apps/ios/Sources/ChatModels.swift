import Foundation
import SwiftUI

struct ChatThread: Decodable, Identifiable, Hashable {
    let id: Int
    let title: String?
    let updatedAt: Date
    let messageCount: Int
    let lastPreview: String?

    enum CodingKeys: String, CodingKey {
        case id, title
        case updatedAt = "updated_at"
        case messageCount = "message_count"
        case lastPreview = "last_preview"
    }

    var displayTitle: String {
        if let trimmed = title?.trimmingCharacters(in: .whitespaces), !trimmed.isEmpty {
            return trimmed
        }
        return "Untitled thread"
    }
}

struct ChatMessage: Decodable, Identifiable, Hashable {
    let id: Int
    let role: Role
    let content: String
    let createdAt: Date

    enum Role: String, Decodable, Hashable {
        case user
        case assistant
    }

    enum CodingKeys: String, CodingKey {
        case id, role, content
        case createdAt = "created_at"
    }
}

struct ChatThreadDetail: Decodable {
    let thread: ThreadInfo
    let messages: [ChatMessage]

    struct ThreadInfo: Decodable {
        let id: Int
        let title: String?
    }
}

struct ChatSendResponse: Decodable {
    let threadId: Int
    let reply: String

    enum CodingKeys: String, CodingKey {
        case threadId = "thread_id"
        case reply
    }
}

enum ChatStreamEvent {
    case threadId(Int)
    case textDelta(String)
    case toolUseStart(name: String)
    case toolUseEnd(name: String, status: String, rows: Int?, durationMs: Int, error: String?)
    case toolProgress(tool: String, stage: String, message: String?)
    case done(reply: String)
    case error(kind: String, message: String, origin: String?)
}

struct SSETextDelta: Decodable {
    let text: String
}

struct SSEToolUseStart: Decodable {
    let name: String
}

struct SSEToolUseEnd: Decodable {
    let name: String
    let durationMs: Int
    let rows: Int?
    let status: String
    let error: String?

    enum CodingKeys: String, CodingKey {
        case name, rows, status, error
        case durationMs = "duration_ms"
    }
}

struct SSEToolProgress: Decodable {
    let tool: String
    let stage: String
    let message: String?
}

struct SSEDone: Decodable {
    let reply: String
}

struct SSEError: Decodable {
    let kind: String
    let message: String
    let origin: String?
}

enum ChatRecovery {
    static func hasNewAssistantReply(
        _ messages: [ChatMessage],
        afterMessageId baselineMessageId: Int?
    ) -> Bool {
        guard let last = messages.last, last.role == .assistant else { return false }
        let messagesAfterBaseline = messages.filter { message in
            guard let baselineMessageId else { return true }
            return message.id > baselineMessageId
        }
        // Requiring a user message after the local baseline prevents an older
        // assistant reply from looking terminal when the local transcript is
        // stale because a prior post-done history reload failed.
        guard
            let currentUser = messagesAfterBaseline.last(where: { $0.role == .user })
        else { return false }
        return last.id > currentUser.id
    }
}

struct ChatInFlightTurn {
    let baselineMessageId: Int?
}

@MainActor
@Observable
final class ChatInFlightStore {
    /// Coach turns in progress, keyed by thread id. The local transcript
    /// baseline lets foreground reconciliation distinguish the new reply from
    /// an older assistant message when a POST drops before response headers.
    var inFlight: [Int: ChatInFlightTurn] = [:]

    nonisolated init() {}
}

extension Notification.Name {
    static let chatThreadNeedsRefresh = Notification.Name("com.georgenijo.coach.chatThreadNeedsRefresh")
}

private struct ChatInFlightKey: EnvironmentKey {
    static let defaultValue = ChatInFlightStore()
}

extension EnvironmentValues {
    var chatInFlight: ChatInFlightStore {
        get { self[ChatInFlightKey.self] }
        set { self[ChatInFlightKey.self] = newValue }
    }
}
