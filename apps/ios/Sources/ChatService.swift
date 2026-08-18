import Foundation

struct SSEEventFrame: Equatable {
    let name: String
    let data: String
}

/// Incremental Server-Sent Events framing.
///
/// `URLSession.AsyncBytes.lines` owns byte/chunk reassembly. This parser owns
/// SSE's line-level rules: CRLF normalization, comment/unknown-field ignores,
/// multi-line `data` joining, blank-line dispatch, and partial-event discard at
/// EOF.
struct SSEEventParser {
    private var eventName: String?
    private var dataLines: [String] = []

    mutating func consume(_ rawLine: String) -> SSEEventFrame? {
        var line = rawLine
        if line.last == "\r" {
            line.removeLast()
        }

        guard !line.isEmpty else {
            return dispatch()
        }
        guard !line.hasPrefix(":") else {
            return nil
        }

        let field: Substring
        var value: Substring
        if let separator = line.firstIndex(of: ":") {
            field = line[..<separator]
            value = line[line.index(after: separator)...]
            if value.first == " " {
                value = value.dropFirst()
            }
        } else {
            field = Substring(line)
            value = ""
        }

        switch field {
        case "event":
            eventName = String(value)
        case "data":
            dataLines.append(String(value))
        default:
            // `id`, `retry`, and extension fields do not affect Coach events.
            break
        }
        return nil
    }

    mutating func finish() -> SSEEventFrame? {
        // Per the SSE parsing algorithm, EOF without a blank-line terminator
        // discards the partial event. Treating a truncated, JSON-valid `done`
        // as complete could incorrectly clear an in-flight turn.
        eventName = nil
        dataLines.removeAll(keepingCapacity: true)
        return nil
    }

    private mutating func dispatch() -> SSEEventFrame? {
        defer {
            eventName = nil
            dataLines.removeAll(keepingCapacity: true)
        }

        // The SSE default event name is "message". Coach uses named events,
        // but retaining the default makes framing spec-compliant and lets the
        // decoder safely ignore an unknown default event.
        guard !dataLines.isEmpty else { return nil }
        let name = eventName.flatMap { $0.isEmpty ? nil : $0 } ?? "message"
        return SSEEventFrame(name: name, data: dataLines.joined(separator: "\n"))
    }
}

struct ChatService {
    let api: APIClient

    func listThreads() async throws -> [ChatThread] {
        try await api.get("/api/threads")
    }

    func threadDetail(id: Int) async throws -> ChatThreadDetail {
        try await api.get("/api/threads/\(id)")
    }

    func send(
        threadId: Int?,
        content: String,
        images: [PendingChatImage] = []
    ) -> AsyncThrowingStream<ChatStreamEvent, Error> {
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
                    let headers: HTTPURLResponse
                    let lines: AsyncLineSequence<URLSession.AsyncBytes>
                    if images.isEmpty {
                        (headers, lines) = try await api.openSSE(
                            "/api/chat",
                            query: [URLQueryItem(name: "stream", value: "true")],
                            body: body
                        )
                    } else {
                        var fields = [
                            "message": content,
                            "days": "9999",
                        ]
                        if let threadId {
                            fields["thread_id"] = String(threadId)
                        }
                        let files = images.enumerated().map { index, image in
                            MultipartFile(
                                filename: "image-\(index + 1).jpg",
                                mimeType: "image/jpeg",
                                data: image.jpegData
                            )
                        }
                        (headers, lines) = try await api.openMultipartSSE(
                            "/api/chat",
                            query: [URLQueryItem(name: "stream", value: "true")],
                            fields: fields,
                            files: files
                        )
                    }
                    if let raw = headers.value(forHTTPHeaderField: "x-thread-id"),
                        let id = Int(raw) {
                        continuation.yield(.threadId(id))
                    }

                    let decoder = JSONDecoder()
                    var parser = SSEEventParser()

                    for try await line in lines {
                        if let frame = parser.consume(line) {
                            ChatService.emit(frame, decoder: decoder, into: continuation)
                        }
                    }
                    if let frame = parser.finish() {
                        ChatService.emit(frame, decoder: decoder, into: continuation)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func emit(
        _ frame: SSEEventFrame,
        decoder: JSONDecoder,
        into continuation: AsyncThrowingStream<ChatStreamEvent, Error>.Continuation
    ) {
        guard let payload = frame.data.data(using: .utf8) else { return }
        do {
            if let event = try decodeEvent(frame.name, payload, decoder) {
                continuation.yield(event)
            }
        } catch {
            // Do not log payloads: chat event data can contain user/assistant
            // content. Event name and byte count are sufficient diagnostics.
            ClientLogger.shared.warn(
                "chat_sse_decode_failed",
                details: [
                    "event": frame.name,
                    "payload_bytes": payload.count,
                ]
            )
        }
    }

    static func decodeEvent(
        _ name: String,
        _ payload: Data,
        _ decoder: JSONDecoder
    ) throws -> ChatStreamEvent? {
        switch name {
        case "text_delta":
            let d = try decoder.decode(SSETextDelta.self, from: payload)
            return .textDelta(d.text)
        case "tool_use_start":
            let d = try decoder.decode(SSEToolUseStart.self, from: payload)
            return .toolUseStart(name: d.name)
        case "tool_use_end":
            let d = try decoder.decode(SSEToolUseEnd.self, from: payload)
            return .toolUseEnd(
                name: d.name,
                status: d.status,
                rows: d.rows,
                durationMs: d.durationMs,
                error: d.error
            )
        case "tool_progress":
            let d = try decoder.decode(SSEToolProgress.self, from: payload)
            return .toolProgress(tool: d.tool, stage: d.stage, message: d.message)
        case "done":
            let d = try decoder.decode(SSEDone.self, from: payload)
            return .done(reply: d.reply, presentationBlocks: d.presentationBlocks)
        case "error":
            let d = try decoder.decode(SSEError.self, from: payload)
            return .error(kind: d.kind, message: d.message, origin: d.origin)
        default:
            return nil
        }
    }
}
