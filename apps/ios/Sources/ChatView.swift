import SwiftUI

struct ChatView: View {
    let initialTitle: String?

    @Environment(\.api) private var api
    @Environment(\.chatInFlight) private var chatInFlight
    @Environment(\.scenePhase) private var scenePhase
    @State private var threadId: Int?
    @State private var rows: [ChatRow] = []
    @State private var input: String = ""
    @State private var isSending = false
    @State private var loadError: String?
    @State private var sendError: String?
    @State private var didLoadInitial = false
    @State private var streamingAssistant: StreamingAssistant?
    @State private var activeTools: [ToolChip] = []
    @State private var recoveryStatus: RecoveryStatus?
    @State private var showAbandonRecoveryConfirmation = false

    init(threadId: Int?, initialTitle: String?) {
        self.initialTitle = initialTitle
        self._threadId = State(initialValue: threadId)
    }

    struct StreamingAssistant {
        let id: UUID
        var text: String
    }

    struct ToolChip: Identifiable, Hashable {
        let id = UUID()
        let name: String
        var stage: String?
    }

    enum RecoveryStatus: Equatable {
        case checking
        case waiting
    }

    enum ChatRow: Identifiable, Hashable {
        case persisted(ChatMessage)
        case optimistic(id: UUID, content: String)
        case streaming(id: UUID, content: String)
        case typing

        var id: String {
            switch self {
            case .persisted(let m): return "p-\(m.id)"
            case .optimistic(let id, _): return "o-\(id.uuidString)"
            case .streaming(let id, _): return "s-\(id.uuidString)"
            case .typing: return "typing"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            messagesList
            if !activeTools.isEmpty {
                toolChipsBar
            }
            if let recoveryStatus {
                recoveryBar(recoveryStatus)
            }
            if let sendError {
                sendErrorBanner(sendError)
            }
            Rectangle()
                .fill(Theme.Palette.borderSubtle)
                .frame(height: 1)
            composer
        }
        .navigationTitle(initialTitle ?? "New chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            if !didLoadInitial {
                didLoadInitial = true
                await loadHistory()
                // recoveryStatus is view-local @State, so it doesn't survive leaving and
                // reopening this thread; re-arm the bar/send-block from the shared store.
                if let threadId, chatInFlight.inFlight[threadId] != nil {
                    await reconcileDroppedTurn(baselineMessageId: recoveryBaselineMessageId)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .chatThreadNeedsRefresh)) { note in
            guard let id = note.object as? Int, id == threadId, !isSending else { return }
            recoveryStatus = nil
            Task { await loadHistory() }
        }
        .confirmationDialog(
            "Stop waiting for this reply?",
            isPresented: $showAbandonRecoveryConfirmation,
            titleVisibility: .visible
        ) {
            Button("Stop waiting", role: .destructive) {
                abandonRecovery()
            }
            Button("Keep checking", role: .cancel) {}
        } message: {
            Text("The reply may still be running. Sending another message could overlap it.")
        }
    }

    private func recoveryBar(_ status: RecoveryStatus) -> some View {
        HStack(spacing: 8) {
            if status == .checking {
                ProgressView()
                    .controlSize(.mini)
                    .tint(Theme.Palette.ai)
            } else {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.Palette.ai)
            }
            Text(status == .checking ? "Checking for reply…" : "Reply is still running…")
                .font(Theme.FontStyle.sans(11.5))
                .foregroundStyle(Theme.Palette.fg2)
            Spacer()
            if status == .waiting {
                Button("Check now") {
                    Task {
                        await reconcileDroppedTurn(
                            baselineMessageId: recoveryBaselineMessageId
                        )
                    }
                }
                .font(Theme.FontStyle.sans(11.5, weight: .medium))
                .foregroundStyle(Theme.Palette.ai)
                Button("Stop") {
                    showAbandonRecoveryConfirmation = true
                }
                .font(Theme.FontStyle.sans(11.5, weight: .medium))
                .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 7)
        .background(Theme.Palette.ai.opacity(0.06))
    }

    private var toolChipsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(activeTools) { chip in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Theme.Palette.recovery)
                            .frame(width: 5, height: 5)
                            .shadow(color: Theme.Palette.recovery.opacity(0.7), radius: 3)
                        Text(chip.stage.map { "\(chip.name) · \($0)" } ?? chip.name)
                            .font(Theme.FontStyle.mono(10))
                            .foregroundStyle(Theme.Palette.fg2)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(Theme.Palette.ai.opacity(0.07), in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.Palette.ai.opacity(0.18), lineWidth: 1))
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.vertical, 6)
        }
    }

    private func sendErrorBanner(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.Palette.danger)
                .font(.system(size: 14, weight: .semibold))
                .padding(.top, 1)
            Text(text)
                .font(Theme.FontStyle.sans(12.5))
                .foregroundStyle(Theme.Palette.fg0)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                sendError = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg2)
                    .padding(4)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 10)
        .background(Theme.Palette.danger.opacity(0.12))
        .overlay(
            Rectangle()
                .fill(Theme.Palette.danger.opacity(0.4))
                .frame(height: 1),
            alignment: .top
        )
    }

    @ViewBuilder
    private var messagesList: some View {
        if rows.isEmpty, let loadError {
            VStack(spacing: 12) {
                Text(loadError)
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("Retry") { Task { await loadHistory() } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Palette.brandStrain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if rows.isEmpty && threadId != nil {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if rows.isEmpty {
            emptyAsk
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 14) {
                        ForEach(rows) { row in
                            MessageBubble(row: row)
                                .id(row.id)
                        }
                    }
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, Theme.Spacing.lg)
                }
                .scrollContentBackground(.hidden)
                .onChange(of: rows.last?.id) { _, newLastId in
                    if let newLastId {
                        withAnimation { proxy.scrollTo(newLastId, anchor: .bottom) }
                    }
                }
            }
        }
    }

    private var emptyAsk: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Theme.Palette.ai.opacity(0.14))
                    .frame(width: 76, height: 76)
                Image(systemName: "sparkles")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(Theme.Palette.ai)
                    .shadow(color: Theme.Palette.ai.opacity(0.6), radius: 10)
            }
            Text("Ask the coach")
                .font(Theme.FontStyle.sans(17, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
            Text("Try “How was my recovery this week?”")
                .font(Theme.FontStyle.sans(12))
                .foregroundStyle(Theme.Palette.fg2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var composer: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.Palette.fg3)
                TextField("Ask your data…", text: $input, axis: .vertical)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg0)
                    .lineLimit(1...5)
                    .disabled(isSending)
                    .textFieldStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Color.black.opacity(0.4), in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.Palette.borderDefault, lineWidth: 1))

            Button {
                Task { await send() }
            } label: {
                Text("Send")
                    .font(Theme.FontStyle.sans(11.5, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(
                        LinearGradient(
                            colors: [Color(hex: "#8b6fff"), Color(hex: "#6a4dff")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        in: Capsule()
                    )
                    .shadow(color: Theme.Palette.ai.opacity(0.45), radius: 8, y: 3)
                    .opacity(canSend ? 1 : 0.4)
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 10)
    }

    private var canSend: Bool {
        !isSending
            && recoveryStatus == nil
            && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var latestPersistedMessageId: Int? {
        rows.reversed().compactMap { row -> Int? in
            if case .persisted(let message) = row { return message.id }
            return nil
        }.first
    }

    private var recoveryBaselineMessageId: Int? {
        guard
            let threadId,
            let turn = chatInFlight.inFlight[threadId]
        else { return latestPersistedMessageId }
        return turn.baselineMessageId
    }

    @MainActor
    private func loadHistory() async {
        guard let threadId else { return }
        loadError = nil
        do {
            let detail = try await ChatService(api: api).threadDetail(id: threadId)
            rows = detail.messages.map { .persisted($0) }
            // In-flight removal is NOT owned here. The live turn clears it in
            // send() on done/error; a turn recovered after backgrounding is
            // cleared by CoachApp.reconcileInFlight once it is terminal. A bare
            // history fetch must not drop the marker — the turn may still be
            // running server-side, and clearing early would lose the reply.
        } catch APIError.unauthorized {
            loadError = "Session expired. Sign in again."
        } catch APIError.network(let err) {
            loadError = "Network error: \(err.localizedDescription)"
        } catch APIError.serverError(let code) {
            loadError = "Server error (\(code))"
        } catch {
            loadError = "Could not load thread"
        }
    }

    @MainActor
    private func send() async {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }

        isSending = true
        sendError = nil
        recoveryStatus = nil
        let baselineMessageId = latestPersistedMessageId
        let optimisticId = UUID()
        rows.append(.optimistic(id: optimisticId, content: trimmed))
        rows.append(.typing)
        input = ""
        streamingAssistant = nil
        activeTools = []
        defer {
            isSending = false
            activeTools = []
            streamingAssistant = nil
        }

        // Strong local handle to the app-scoped store (a class held by the
        // environment). The thread stays marked in-flight until a `done`/`error`
        // resolves it, so a backgrounded turn is recoverable on foreground.
        let inFlight = chatInFlight
        var markedThreadId: Int?
        var sawDone = false
        var sawError = false

        func markInFlight(_ id: Int) {
            markedThreadId = id
            inFlight.inFlight[id] = ChatInFlightTurn(
                baselineMessageId: baselineMessageId
            )
        }
        func clearInFlight() {
            if let id = markedThreadId {
                inFlight.inFlight.removeValue(forKey: id)
            }
        }

        do {
            let stream = ChatService(api: api).send(threadId: threadId, content: trimmed)
            for try await event in stream {
                switch event {
                case .threadId(let id):
                    threadId = id
                    markInFlight(id)

                case .textDelta(let delta):
                    appendStreamingDelta(delta)

                case .toolUseStart(let name):
                    activeTools.append(ToolChip(name: name, stage: nil))

                case .toolProgress(let tool, let stage, _):
                    if let idx = activeTools.lastIndex(where: { $0.name == tool }) {
                        activeTools[idx].stage = stage
                    } else {
                        activeTools.append(ToolChip(name: tool, stage: stage))
                    }

                case .toolUseEnd(let name, _, _, _, _):
                    if let idx = activeTools.lastIndex(where: { $0.name == name }) {
                        activeTools.remove(at: idx)
                    }

                case .done(let reply):
                    sawDone = true
                    activeTools = []
                    commitAssistant(reply: reply)
                    clearInFlight()

                case .error(_, let message, _):
                    sawError = true
                    activeTools = []
                    // Server persisted any partial; keep the streamed row.
                    rows.removeAll { if case .typing = $0 { return true }; return false }
                    streamingAssistant = nil
                    sendError = message
                    clearInFlight()
                }
            }
            if sawDone {
                // Replace the optimistic user row + streamed assistant row with
                // the persisted transcript, so the user's bubble stops rendering
                // as pending (dimmed). `done.reply` already showed the final text,
                // and a failed reload leaves those rows in place (rows non-empty,
                // so loadError stays hidden) — no worse than before.
                await loadHistory()
            } else if !sawError {
                // Stream ended without `done` or an SSE `error`: a transport drop.
                activeTools = []
                rows.removeAll { if case .typing = $0 { return true }; return false }
                if let recoveryThreadId = threadId {
                    // Existing threads remain recoverable even if the
                    // x-thread-id response header never arrived.
                    markInFlight(recoveryThreadId)
                    if scenePhase == .active {
                        await reconcileDroppedTurn(baselineMessageId: baselineMessageId)
                    }
                } else {
                    handleUnconfirmedThreadDrop(optimisticId: optimisticId, content: trimmed)
                }
            }
        } catch APIError.unauthorized {
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
            clearInFlight()
        } catch APIError.serverError(let code) {
            sendError = ChatView.friendlySendError(forStatus: code)
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
            clearInFlight()
        } catch is CancellationError {
            // View popped / task cancelled: silent drop. Keep the turn in-flight.
            rows.removeAll { if case .typing = $0 { return true }; return false }
        } catch {
            if Self.isTransportDrop(error) {
                activeTools = []
                rows.removeAll { if case .typing = $0 { return true }; return false }
                // Preserve the existing silent app-scoped recovery when the app
                // backgrounds. If the ChatView remains active, self-heal here.
                if let recoveryThreadId = threadId {
                    markInFlight(recoveryThreadId)
                    if scenePhase == .active {
                        await reconcileDroppedTurn(baselineMessageId: baselineMessageId)
                    }
                } else {
                    handleUnconfirmedThreadDrop(optimisticId: optimisticId, content: trimmed)
                }
            } else if !sawDone && !sawError {
                // Open succeeded but no event resolved the turn and the error is
                // not a recognized transport drop: surface a generic banner.
                sendError = "Could not send. Please try again."
                rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
                clearInFlight()
            }
        }
    }

    /// Reconcile a foreground transport drop without making the user leave and
    /// reopen the thread. Four bounded probes cover the common race where the
    /// server persists shortly after the transport disappears.
    @MainActor
    private func reconcileDroppedTurn(baselineMessageId: Int?) async {
        guard let threadId else { return }
        recoveryStatus = .checking

        var previousOffset = 0
        for probeOffset in [0, 1, 2, 5] {
            let delaySeconds = probeOffset - previousOffset
            previousOffset = probeOffset
            if delaySeconds > 0 {
                do {
                    try await Task.sleep(nanoseconds: UInt64(delaySeconds) * 1_000_000_000)
                } catch {
                    recoveryStatus = nil
                    return
                }
            }
            guard scenePhase == .active else {
                // CoachApp owns silent reconciliation after backgrounding.
                recoveryStatus = nil
                return
            }

            do {
                let detail = try await ChatService(api: api).threadDetail(id: threadId)
                if ChatRecovery.hasNewAssistantReply(
                    detail.messages,
                    afterMessageId: baselineMessageId
                ) {
                    rows = detail.messages.map { .persisted($0) }
                    chatInFlight.inFlight.removeValue(forKey: threadId)
                    recoveryStatus = nil
                    loadError = nil
                    return
                }
            } catch {
                // Network may still be reconnecting. Continue the bounded probes
                // without replacing the conversation with an error screen.
            }
        }

        recoveryStatus = .waiting
    }

    @MainActor
    private func abandonRecovery() {
        if let threadId {
            chatInFlight.inFlight.removeValue(forKey: threadId)
        }
        recoveryStatus = nil
        sendError = "Stopped checking. The reply may still appear in thread history."
    }

    @MainActor
    private func handleUnconfirmedThreadDrop(optimisticId: UUID, content: String) {
        rollbackOptimistic(optimisticId: optimisticId, restore: content)
        sendError = "Connection lost before the new thread could be confirmed. Check your threads before retrying."
    }

    private func appendStreamingDelta(_ delta: String) {
        if var assistant = streamingAssistant {
            assistant.text += delta
            streamingAssistant = assistant
            if let idx = rows.firstIndex(where: { row in
                if case .streaming(let id, _) = row { return id == assistant.id }
                return false
            }) {
                rows[idx] = .streaming(id: assistant.id, content: assistant.text)
            }
        } else {
            let assistant = StreamingAssistant(id: UUID(), text: delta)
            streamingAssistant = assistant
            rows.removeAll { if case .typing = $0 { return true }; return false }
            rows.append(.streaming(id: assistant.id, content: assistant.text))
        }
    }

    private func commitAssistant(reply: String) {
        if let assistant = streamingAssistant,
            let idx = rows.firstIndex(where: { row in
                if case .streaming(let id, _) = row { return id == assistant.id }
                return false
            }) {
            rows[idx] = .streaming(id: assistant.id, content: reply)
        } else {
            rows.removeAll { if case .typing = $0 { return true }; return false }
            rows.append(.streaming(id: UUID(), content: reply))
        }
        streamingAssistant = nil
    }

    private static func isTransportDrop(_ error: Error) -> Bool {
        if case APIError.network(let underlying) = error {
            if let urlError = underlying as? URLError {
                switch urlError.code {
                case .networkConnectionLost, .timedOut, .cancelled, .notConnectedToInternet:
                    return true
                default:
                    return false
                }
            }
            return underlying is CancellationError
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .networkConnectionLost, .timedOut, .cancelled, .notConnectedToInternet:
                return true
            default:
                return false
            }
        }
        return false
    }

    private static func friendlySendError(forStatus code: Int) -> String {
        switch code {
        case 402:
            return "Anthropic credits exhausted. Top up your Anthropic account, or add a personal key in Settings."
        case 429:
            return "Rate limited by Anthropic. Try again in a moment."
        case 503:
            return "Anthropic is temporarily unavailable. Try again shortly."
        case 502:
            return "Anthropic returned an error. Try again."
        case 500:
            return "Coach call failed. Please try again."
        default:
            return "Server error (\(code)). Try again."
        }
    }

    private func rollbackOptimistic(optimisticId: UUID, restore content: String) {
        rows.removeAll { row in
            if case .typing = row { return true }
            if case .optimistic(let id, _) = row, id == optimisticId { return true }
            return false
        }
        if input.isEmpty { input = content }
    }
}

private struct MessageBubble: View {
    let row: ChatView.ChatRow

    var body: some View {
        switch row {
        case .persisted(let message):
            bubble(role: message.role, content: message.content, dimmed: false)
        case .optimistic(_, let content):
            bubble(role: .user, content: content, dimmed: true)
        case .streaming(_, let content):
            bubble(role: .assistant, content: content, dimmed: false)
        case .typing:
            HStack(spacing: 8) {
                ThinkingDots()
                Text("thinking…")
                    .font(Theme.FontStyle.sans(11))
                    .foregroundStyle(Theme.Palette.fg3)
                Spacer()
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private func bubble(role: ChatMessage.Role, content: String, dimmed: Bool) -> some View {
        HStack {
            if role == .user { Spacer(minLength: 40) }
            bubbleContent(role: role, content: content)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(bubbleBackground(role: role, dimmed: dimmed))
                .overlay(bubbleBorder(role: role))
                .foregroundStyle(role == .user ? Theme.Palette.fg0 : Theme.Palette.fg1)
                .clipShape(bubbleShape(role: role))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: role == .user ? .trailing : .leading)
            if role == .assistant { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder
    private func bubbleContent(role: ChatMessage.Role, content: String) -> some View {
        if role == .assistant {
            MarkdownView(content: content)
                .font(Theme.FontStyle.sans(13))
        } else {
            Text(content)
                .font(Theme.FontStyle.sans(13))
        }
    }

    private func bubbleBackground(role: ChatMessage.Role, dimmed: Bool) -> some View {
        Group {
            if role == .user {
                Color.white.opacity(dimmed ? 0.04 : 0.06)
            } else {
                Theme.Palette.ai.opacity(0.08)
            }
        }
    }

    private func bubbleBorder(role: ChatMessage.Role) -> some View {
        bubbleShape(role: role)
            .strokeBorder(
                role == .user ? Theme.Palette.borderDefault : Theme.Palette.ai.opacity(0.22),
                lineWidth: 1
            )
    }

    private func bubbleShape(role: ChatMessage.Role) -> UnevenRoundedRectangle {
        if role == .user {
            UnevenRoundedRectangle(cornerRadii: .init(topLeading: 14, bottomLeading: 14, bottomTrailing: 4, topTrailing: 14))
        } else {
            UnevenRoundedRectangle(cornerRadii: .init(topLeading: 14, bottomLeading: 4, bottomTrailing: 14, topTrailing: 14))
        }
    }
}

private struct ThinkingDots: View {
    @State private var animating = false

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(Theme.Palette.ai)
                    .frame(width: 5, height: 5)
                    .opacity(animating ? 1 : 0.3)
                    .offset(y: animating ? -2 : 0)
                    .animation(
                        .easeInOut(duration: 0.6)
                            .repeatForever()
                            .delay(Double(i) * 0.18),
                        value: animating
                    )
            }
        }
        .onAppear { animating = true }
    }
}

#Preview {
    NavigationStack {
        ChatView(threadId: nil, initialTitle: nil)
    }
}
