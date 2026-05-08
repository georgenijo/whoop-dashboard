import Foundation

struct ChatService {
    let api: APIClient

    func listThreads() async throws -> [ChatThread] {
        try await api.get("/api/threads")
    }

    func threadDetail(id: Int) async throws -> ChatThreadDetail {
        try await api.get("/api/threads/\(id)")
    }

    func send(threadId: Int?, content: String) async throws -> ChatSendResponse {
        struct Body: Encodable {
            let messages: [Message]
            let threadId: Int?

            struct Message: Encodable {
                let role: String
                let content: String
            }

            enum CodingKeys: String, CodingKey {
                case messages
                case threadId = "thread_id"
            }

            // Explicit `encode(to:)` so a nil threadId emits `"thread_id": null`
            // instead of being omitted by Swift's synthesized encodeIfPresent.
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(messages, forKey: .messages)
                try container.encode(threadId, forKey: .threadId)
            }
        }

        let body = Body(
            messages: [.init(role: "user", content: content)],
            threadId: threadId
        )

        return try await api.post(
            "/api/chat",
            query: [URLQueryItem(name: "stream", value: "false")],
            body: body
        )
    }
}
