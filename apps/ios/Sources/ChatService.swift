import Foundation

struct ChatService {
    let api: APIClient

    func listThreads() async throws -> [ChatThread] {
        try await api.get("/api/threads")
    }

    func threadDetail(id: Int) async throws -> ChatThreadDetail {
        try await api.get("/api/threads/\(id)")
    }

    func send(threadId: Int?, content: String) -> AsyncThrowingStream<ChatStreamEvent, Error> {
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
        let api = self.api

        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (headers, lines) = try await api.openSSE(
                        "/api/chat",
                        query: [URLQueryItem(name: "stream", value: "true")],
                        body: body
                    )
                    if let raw = headers.value(forHTTPHeaderField: "x-thread-id"),
                        let id = Int(raw) {
                        continuation.yield(.threadId(id))
                    }

                    let decoder = JSONDecoder()
                    var eventName: String?
                    var dataBuffer = ""

                    func flush() {
                        defer {
                            eventName = nil
                            dataBuffer = ""
                        }
                        guard let name = eventName, !dataBuffer.isEmpty,
                            let payload = dataBuffer.data(using: .utf8) else { return }
                        if let event = ChatService.decodeEvent(name, payload, decoder) {
                            continuation.yield(event)
                        }
                    }

                    for try await line in lines {
                        if line.isEmpty {
                            flush()
                        } else if line.hasPrefix("event:") {
                            eventName = ChatService.stripPrefix(line, "event:")
                        } else if line.hasPrefix("data:") {
                            dataBuffer += ChatService.stripPrefix(line, "data:")
                        }
                    }
                    flush()
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func stripPrefix(_ line: String, _ prefix: String) -> String {
        var rest = String(line.dropFirst(prefix.count))
        if rest.hasPrefix(" ") { rest.removeFirst() }
        return rest
    }

    private static func decodeEvent(
        _ name: String,
        _ payload: Data,
        _ decoder: JSONDecoder
    ) -> ChatStreamEvent? {
        switch name {
        case "text_delta":
            guard let d = try? decoder.decode(SSETextDelta.self, from: payload) else { return nil }
            return .textDelta(d.text)
        case "tool_use_start":
            guard let d = try? decoder.decode(SSEToolUseStart.self, from: payload) else { return nil }
            return .toolUseStart(name: d.name)
        case "tool_use_end":
            guard let d = try? decoder.decode(SSEToolUseEnd.self, from: payload) else { return nil }
            return .toolUseEnd(
                name: d.name,
                status: d.status,
                rows: d.rows,
                durationMs: d.durationMs,
                error: d.error
            )
        case "tool_progress":
            guard let d = try? decoder.decode(SSEToolProgress.self, from: payload) else { return nil }
            return .toolProgress(tool: d.tool, stage: d.stage, message: d.message)
        case "done":
            guard let d = try? decoder.decode(SSEDone.self, from: payload) else { return nil }
            return .done(reply: d.reply)
        case "error":
            guard let d = try? decoder.decode(SSEError.self, from: payload) else { return nil }
            return .error(kind: d.kind, message: d.message, origin: d.origin)
        default:
            return nil
        }
    }
}
