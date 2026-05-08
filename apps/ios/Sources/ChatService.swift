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
            let thread_id: Int?

            struct Message: Encodable {
                let role: String
                let content: String
            }
        }

        let body = Body(
            messages: [.init(role: "user", content: content)],
            thread_id: threadId
        )

        return try await api.post(
            "/api/chat",
            query: [URLQueryItem(name: "stream", value: "false")],
            body: body
        )
    }
}
