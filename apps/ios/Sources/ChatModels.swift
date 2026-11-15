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
    let attachments: [ChatAttachment]
    let workLog: CoachWorkLog?
    let presentationBlocks: [CoachPresentationBlock]

    enum Role: String, Decodable, Hashable {
        case user
        case assistant
    }

    enum CodingKeys: String, CodingKey {
        case id, role, content, attachments
        case createdAt = "created_at"
        case workLog = "work_log"
        case presentationBlocks = "presentation_blocks"
    }

    init(
        id: Int,
        role: Role,
        content: String,
        createdAt: Date,
        attachments: [ChatAttachment] = [],
        workLog: CoachWorkLog? = nil,
        presentationBlocks: [CoachPresentationBlock] = []
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.attachments = attachments
        self.workLog = workLog
        self.presentationBlocks = presentationBlocks
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        role = try container.decode(Role.self, forKey: .role)
        content = try container.decode(String.self, forKey: .content)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        attachments = try container.decodeIfPresent(
            [ChatAttachment].self,
            forKey: .attachments
        ) ?? []
        // Historical or future work-log versions must not make the entire
        // conversation fail to load. The web client follows the same
        // fail-closed behavior for malformed activity metadata.
        do {
            workLog = try container.decodeIfPresent(CoachWorkLog.self, forKey: .workLog)
        } catch {
            workLog = nil
        }
        do {
            presentationBlocks = try container.decodeIfPresent(CoachPresentationBlockList.self, forKey: .presentationBlocks)?.blocks ?? []
        } catch {
            presentationBlocks = []
        }
    }
}

struct CoachWorkLog: Decodable, Hashable {
    let version: Int
    let status: Status
    let durationMs: Int?
    let notes: [String]
    let tools: [CoachToolActivity]

    enum Status: String, Decodable, Hashable {
        case running
        case complete
        case error
        case aborted
    }

    enum CodingKeys: String, CodingKey {
        case version, status, notes, tools
        case durationMs = "duration_ms"
    }
}

struct CoachToolActivity: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let state: State
    let status: String?
    let durationMs: Int?
    let rows: Int?
    let stage: String?
    let stageMessage: String?
    let error: String?

    enum State: String, Decodable, Hashable {
        case running
        case complete
    }

    enum CodingKeys: String, CodingKey {
        case id, name, state, status, rows, stage, error
        case durationMs = "duration_ms"
        case stageMessage = "stage_message"
    }
}

struct LiveToolActivity: Identifiable, Hashable {
    let id: String
    let name: String
    var stage: String?
    var message: String? = nil
    var isComplete = false
    var error: String? = nil

    /// A terminal failure may have no error text in the SSE payload.
    var hasFailed: Bool { error != nil || (isComplete && stage == "Failed") }

    init(id: String = UUID().uuidString, name: String, stage: String?) {
        self.id = id
        self.name = name
        self.stage = stage
    }
}

struct ChatAttachment: Decodable, Identifiable, Hashable {
    let id: String
    let url: String
    let mimeType: String
    let width: Int
    let height: Int
    let sizeBytes: Int

    enum CodingKeys: String, CodingKey {
        case id, url, width, height
        case mimeType = "mime_type"
        case sizeBytes = "size_bytes"
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
    case toolUseStart(id: String?, name: String)
    case toolUseEnd(id: String?, name: String, status: String, rows: Int?, durationMs: Int, error: String?)
    case toolProgress(id: String?, tool: String, stage: String, message: String?)
    case done(reply: String, workLog: CoachWorkLog?, presentationBlocks: [CoachPresentationBlock])
    case error(kind: String, message: String, origin: String?)
}

struct SSETextDelta: Decodable {
    let text: String
}

struct SSEToolUseStart: Decodable {
    let id: String?
    let name: String
}

struct SSEToolUseEnd: Decodable {
    let id: String?
    let name: String
    let durationMs: Int
    let rows: Int?
    let status: String
    let error: String?

    enum CodingKeys: String, CodingKey {
        case id, name, rows, status, error
        case durationMs = "duration_ms"
    }
}

struct SSEToolProgress: Decodable {
    let id: String?
    let tool: String
    let stage: String
    let message: String?
}

struct SSEDone: Decodable {
    let reply: String
    let workLog: CoachWorkLog?
    let presentationBlocks: [CoachPresentationBlock]

    enum CodingKeys: String, CodingKey {
        case reply
        case workLog = "work_log"
        case presentationBlocks = "presentation_blocks"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        reply = try container.decode(String.self, forKey: .reply)
        workLog = try? container.decodeIfPresent(CoachWorkLog.self, forKey: .workLog)
        do {
            presentationBlocks = try container.decodeIfPresent(
                CoachPresentationBlockList.self,
                forKey: .presentationBlocks
            )?.blocks ?? []
        } catch {
            presentationBlocks = []
        }
    }
}

struct SSEError: Decodable {
    let kind: String
    let message: String
    let origin: String?
}

enum ChatRecovery {
    /// After Stop the server persists the question (and any partial answer)
    /// when it sees the disconnect. Only a user message newer than the
    /// baseline whose content matches the stopped question counts, so a
    /// message from another device cannot stand in for it.
    static func persistedStoppedTurn(
        _ messages: [ChatMessage],
        afterMessageId baselineMessageId: Int?,
        question: StoppedQuestion
    ) -> Bool {
        messages.contains { message in
            guard message.role == .user else { return false }
            if let baselineMessageId, message.id <= baselineMessageId { return false }
            guard message.content.trimmingCharacters(in: .whitespacesAndNewlines) == question.text else { return false }
            return !question.hasAttachments || !message.attachments.isEmpty
        }
    }

    enum TurnResolution: Equatable {
        /// The server saved the turn (or, for a normal turn, its reply).
        case persisted
        /// A stopped turn was confirmed never saved.
        case absent
        /// A normal turn is still running.
        case pending
    }

    /// Resolves one successful history fetch. A stopped turn never produces a
    /// reply: its own question saved resolves it as persisted, and a history
    /// without that question proves it absent. A normal turn (nil question)
    /// needs a finished reply.
    static func resolution(
        _ messages: [ChatMessage],
        afterMessageId baselineMessageId: Int?,
        stoppedQuestion: StoppedQuestion?
    ) -> TurnResolution {
        if let stoppedQuestion {
            return persistedStoppedTurn(messages, afterMessageId: baselineMessageId, question: stoppedQuestion) ? .persisted : .absent
        }
        return hasNewAssistantReply(messages, afterMessageId: baselineMessageId) ? .persisted : .pending
    }

    enum StopOutcome: Equatable {
        /// History holds the stopped question.
        case persisted
        /// A history fetch succeeded last and did not hold it.
        case absent
        /// No fetch could confirm either way; the turn may still be saved.
        case unknown
    }

    /// `fetches` are the history results in probe order; nil is a failed
    /// request. Only a successful final fetch without the question proves the
    /// server saved nothing; failures never do.
    static func stopOutcome(
        fetches: [[ChatMessage]?],
        afterMessageId baselineMessageId: Int?,
        question: StoppedQuestion
    ) -> StopOutcome {
        for case let messages? in fetches where persistedStoppedTurn(messages, afterMessageId: baselineMessageId, question: question) {
            return .persisted
        }
        if let last = fetches.last, last != nil { return .absent }
        return .unknown
    }

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
    /// The question awaiting its reply, shown as the preview of the thread's
    /// row in the conversation list while the reply is in flight.
    var pendingText: String? = nil
    /// The user stopped this turn and persistence has not been confirmed yet.
    /// Recovery then resolves by what the server saved (question, partial
    /// answer, or nothing) rather than waiting for a finished reply.
    var stoppedQuestion: StoppedQuestion? = nil
    var stopped: Bool { stoppedQuestion != nil }
}

/// What the user sent before pressing Stop, used to recognise that exact turn
/// in history so another session's message is never mistaken for it.
struct StoppedQuestion: Equatable {
    let text: String
    let hasAttachments: Bool

    init(text: String, hasAttachments: Bool) {
        self.text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        self.hasAttachments = hasAttachments
    }

    init(_ draft: ChatDraft) {
        self.init(text: draft.text, hasAttachments: !draft.images.isEmpty)
    }
}

/// Lets the view cancel the in-flight request without cancelling the task
/// that reconciles afterwards.
final class ChatStreamControl {
    var cancel: (() -> Void)?
    private(set) var stopped = false

    /// Starts a new send; clears any previous Stop.
    func arm() {
        stopped = false
        cancel = nil
    }

    /// Remembered even when no request exists yet, so a Stop during the
    /// pre-send history refresh still prevents the send.
    func stop() {
        stopped = true
        cancel?()
    }
}

@MainActor
@Observable
final class ChatInFlightStore {
    /// Coach turns in progress, keyed by thread id. The local transcript
    /// baseline lets foreground reconciliation distinguish the new reply from
    /// an older assistant message when a POST drops before response headers.
    var inFlight: [Int: ChatInFlightTurn] = [:]

    nonisolated init() {}

    /// Drafts of stopped turns, kept apart from active-turn status so a
    /// confirmed-absent turn can stop showing as replying while its text and
    /// images are still restored the next time the thread opens. Memory only.
    var stoppedDrafts: [Int: ChatDraft] = [:]

    /// Registers an unresolved stopped turn, including when the thread id
    /// header never arrived and the turn was never marked in flight.
    func markStopped(threadId: Int, baselineMessageId: Int?, draft: ChatDraft) {
        inFlight[threadId] = ChatInFlightTurn(
            baselineMessageId: baselineMessageId,
            pendingText: draft.text,
            stoppedQuestion: StoppedQuestion(draft)
        )
        stoppedDrafts[threadId] = draft
    }

    /// Clears the active-turn status. A saved turn also drops its draft; an
    /// absent one keeps it for restoration.
    func resolveStopped(threadId: Int, persisted: Bool) {
        inFlight.removeValue(forKey: threadId)
        if persisted { stoppedDrafts.removeValue(forKey: threadId) }
    }

    func takeStoppedDraft(threadId: Int) -> ChatDraft? {
        stoppedDrafts.removeValue(forKey: threadId)
    }
}

extension Notification.Name {
    static let chatThreadNeedsRefresh = Notification.Name("com.georgenijo.coach.chatThreadNeedsRefresh")
    /// A new conversation was saved as a thread; object is `ChatThreadCreated`.
    static let chatThreadCreated = Notification.Name("com.georgenijo.coach.chatThreadCreated")
    /// A turn finished, so thread titles, previews, and order may have changed.
    static let chatThreadListChanged = Notification.Name("com.georgenijo.coach.chatThreadListChanged")
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
