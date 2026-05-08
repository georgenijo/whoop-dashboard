import Foundation

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
