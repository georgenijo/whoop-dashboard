import PhotosUI
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
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var pendingImages: [PendingChatImage] = []
    @State private var isPreparingImages = false
    @State private var selectedAttachment: ChatAttachment?
    @State private var attachmentCache = ChatAttachmentCache()

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
        case optimistic(id: UUID, content: String, attachments: [PendingChatImage])
        case streaming(id: UUID, content: String)
        case typing

        var id: String {
            switch self {
            case .persisted(let m): return "p-\(m.id)"
            case .optimistic(let id, _, _): return "o-\(id.uuidString)"
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
        .background(Theme.Palette.bg)
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
        .onChange(of: photoPickerItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await prepareSelectedPhotos(items) }
        }
        .sheet(item: $selectedAttachment) { attachment in
            ChatAttachmentViewer(
                attachment: attachment,
                api: api,
                cache: attachmentCache
            )
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
                            MessageBubble(
                                row: row,
                                api: api,
                                cache: attachmentCache,
                                onAttachmentTap: { selectedAttachment = $0 }
                            )
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
        VStack(alignment: .leading, spacing: 8) {
            if !pendingImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(pendingImages) { image in
                            ZStack(alignment: .topTrailing) {
                                if let thumbnail = image.image {
                                    Image(uiImage: thumbnail)
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                        .frame(width: 66, height: 66)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                }
                                Button {
                                    removePendingImage(image.id)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundStyle(Color.white)
                                        .frame(width: 20, height: 20)
                                        .background(Color.black.opacity(0.78), in: Circle())
                                }
                                .offset(x: 5, y: -5)
                                .disabled(isSending)
                                .accessibilityLabel("Remove selected image")
                            }
                            .padding(.top, 5)
                            .padding(.trailing, 5)
                        }
                    }
                }
                Text(
                    "Images are stored with this thread and sent to your selected Coach provider."
                )
                .font(Theme.FontStyle.sans(10.5))
                .foregroundStyle(Theme.Palette.fg3)
                Text("Image analysis can be wrong and isn’t a medical diagnosis.")
                    .font(Theme.FontStyle.sans(10.5))
                    .foregroundStyle(Theme.Palette.fg3)
            }

            if isPreparingImages {
                HStack(spacing: 7) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("Preparing images…")
                        .font(Theme.FontStyle.sans(11))
                        .foregroundStyle(Theme.Palette.fg2)
                }
            }

            HStack {
                CoachModelPicker(disabled: isSending)
                Spacer()
            }

            HStack(spacing: 8) {
                PhotosPicker(
                    selection: $photoPickerItems,
                    maxSelectionCount: max(1, 3 - pendingImages.count),
                    matching: .images
                ) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg1)
                        .frame(width: 36, height: 36)
                        .background(Theme.Palette.bgLift, in: Circle())
                        .overlay(
                            Circle().strokeBorder(
                                Theme.Palette.rule,
                                lineWidth: 1
                            )
                        )
                }
                .disabled(isSending || isPreparingImages || pendingImages.count >= 3)
                .accessibilityLabel("Choose photos")
                .accessibilityValue("\(pendingImages.count) of 3 selected")

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
                .background(Theme.Palette.bgSunk, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.md)
                        .strokeBorder(Theme.Palette.rule, lineWidth: 1)
                )

                Button {
                    Task { await send() }
                } label: {
                    Text("Send")
                        .font(Theme.FontStyle.sans(11.5, weight: .semibold))
                        .foregroundStyle(Theme.Palette.bgSunk)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(
                            Theme.Palette.brand,
                            in: RoundedRectangle(cornerRadius: Theme.Radius.md)
                        )
                        .opacity(canSend ? 1 : 0.4)
                }
                .disabled(!canSend)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 10)
    }

    private var canSend: Bool {
        ChatComposerRules.canSend(
            text: input,
            imageCount: pendingImages.count,
            isSending: isSending,
            isRecovering: recoveryStatus != nil,
            isPreparingImages: isPreparingImages
        )
    }

    @MainActor
    private func prepareSelectedPhotos(_ items: [PhotosPickerItem]) async {
        isPreparingImages = true
        defer {
            isPreparingImages = false
            photoPickerItems = []
        }

        do {
            var additions: [PendingChatImage] = []
            for item in items {
                try Task.checkCancellation()
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw ChatImageProcessingError.invalidImage
                }
                try Task.checkCancellation()
                additions.append(try ChatImageNormalizer.normalize(data))
            }
            try Task.checkCancellation()
            guard pendingImages.count + additions.count <= 3 else {
                sendError = "You can attach up to 3 images."
                return
            }
            pendingImages.append(contentsOf: additions)
            sendError = nil
        } catch is CancellationError {
            return
        } catch {
            sendError = (error as? LocalizedError)?.errorDescription
                ?? "That photo could not be prepared."
        }
    }

    private func removePendingImage(_ id: UUID) {
        pendingImages.removeAll { $0.id == id }
        sendError = nil
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

    private var optimisticDraft: ChatDraft? {
        rows.reversed().compactMap { row -> ChatDraft? in
            if case .optimistic(_, let content, let attachments) = row {
                return ChatDraft(text: content, images: attachments)
            }
            return nil
        }.first
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
        guard canSend else { return }

        isSending = true
        sendError = nil
        recoveryStatus = nil
        let sentDraft = ChatDraft(text: input, images: pendingImages)
        let baselineMessageId = latestPersistedMessageId
        let optimisticId = UUID()
        rows.append(
            .optimistic(
                id: optimisticId,
                content: trimmed,
                attachments: sentDraft.images
            )
        )
        rows.append(.typing)
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
            let stream = ChatService(api: api).send(
                threadId: threadId,
                content: trimmed,
                images: sentDraft.images
            )
            for try await event in stream {
                switch event {
                case .threadId(let id):
                    threadId = id
                    markInFlight(id)
                    input = ""
                    pendingImages = []

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
                    photoPickerItems = []

                case .error(_, let message, _):
                    sawError = true
                    activeTools = []
                    sendError = message
                    if !sentDraft.images.isEmpty {
                        rollbackOptimistic(
                            optimisticId: optimisticId,
                            restore: sentDraft
                        )
                    } else {
                        // Preserve the existing text-only partial-stream behavior.
                        rows.removeAll { if case .typing = $0 { return true }; return false }
                        streamingAssistant = nil
                    }
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
                    handleUnconfirmedThreadDrop(
                        optimisticId: optimisticId,
                        draft: sentDraft
                    )
                }
            }
        } catch APIError.unauthorized {
            rollbackOptimistic(optimisticId: optimisticId, restore: sentDraft)
            clearInFlight()
        } catch APIError.serverError(let code) {
            sendError = ChatView.friendlySendError(forStatus: code)
            rollbackOptimistic(optimisticId: optimisticId, restore: sentDraft)
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
                    handleUnconfirmedThreadDrop(
                        optimisticId: optimisticId,
                        draft: sentDraft
                    )
                }
            } else if !sawDone && !sawError {
                // Open succeeded but no event resolved the turn and the error is
                // not a recognized transport drop: surface a generic banner.
                sendError = "Could not send. Please try again."
                rollbackOptimistic(optimisticId: optimisticId, restore: sentDraft)
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
                    if let optimisticDraft {
                        clearDraft(ifMatching: optimisticDraft)
                    }
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
    private func handleUnconfirmedThreadDrop(optimisticId: UUID, draft: ChatDraft) {
        rollbackOptimistic(optimisticId: optimisticId, restore: draft)
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
        case 400:
            return "The message or image fields were invalid. Check the draft and try again."
        case 413:
            return "The selected images exceed Coach’s upload limits."
        case 415:
            return "One of the selected images uses an unsupported format."
        case 422:
            return "One of the selected images could not be read."
        case 402:
            return "Anthropic credits exhausted. Top up your Anthropic account, or add a personal key in Settings."
        case 429:
            return "Rate limited by Anthropic. Try again in a moment."
        case 503:
            return "Coach or secure attachment storage is temporarily unavailable. Try again shortly."
        case 502:
            return "Anthropic returned an error. Try again."
        case 500:
            return "Coach call failed. Please try again."
        default:
            return "Server error (\(code)). Try again."
        }
    }

    private func rollbackOptimistic(optimisticId: UUID, restore draft: ChatDraft) {
        let streamingId = streamingAssistant?.id
        rows.removeAll { row in
            if case .typing = row { return true }
            if case .optimistic(let id, _, _) = row, id == optimisticId { return true }
            if case .streaming(let id, _) = row, id == streamingId { return true }
            return false
        }
        streamingAssistant = nil
        let restored = ChatComposerRules.restoring(
            draft,
            over: ChatDraft(text: input, images: pendingImages)
        )
        input = restored.text
        pendingImages = restored.images
    }

    private func clearDraft(ifMatching draft: ChatDraft) {
        if input.trimmingCharacters(in: .whitespacesAndNewlines)
            == draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
        {
            input = ""
        }
        if pendingImages == draft.images {
            pendingImages = []
        }
    }
}

private struct MessageBubble: View {
    let row: ChatView.ChatRow
    let api: APIClient
    let cache: ChatAttachmentCache
    let onAttachmentTap: (ChatAttachment) -> Void

    var body: some View {
        switch row {
        case .persisted(let message):
            bubble(
                role: message.role,
                content: message.content,
                attachments: message.attachments,
                pendingAttachments: [],
                dimmed: false
            )
        case .optimistic(_, let content, let attachments):
            bubble(
                role: .user,
                content: content,
                attachments: [],
                pendingAttachments: attachments,
                dimmed: true
            )
        case .streaming(_, let content):
            bubble(
                role: .assistant,
                content: content,
                attachments: [],
                pendingAttachments: [],
                dimmed: false
            )
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
    private func bubble(
        role: ChatMessage.Role,
        content: String,
        attachments: [ChatAttachment],
        pendingAttachments: [PendingChatImage],
        dimmed: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(role == .user ? "YOU" : "COACH")
                .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(role == .user ? Theme.Palette.fg3 : Theme.Palette.ai)
            bubbleContent(
                role: role,
                content: content,
                attachments: attachments,
                pendingAttachments: pendingAttachments
            )
        }
        .padding(.leading, role == .user ? Theme.Spacing.sm : 0)
        .padding(.vertical, Theme.Spacing.xs)
        .overlay(alignment: .leading) {
            if role == .user {
                Rectangle()
                    .fill(Theme.Palette.rule)
                    .frame(width: 1)
            }
        }
        .foregroundStyle(role == .user ? Theme.Palette.fgHi : Theme.Palette.fg)
        .opacity(dimmed ? 0.6 : 1)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func bubbleContent(
        role: ChatMessage.Role,
        content: String,
        attachments: [ChatAttachment],
        pendingAttachments: [PendingChatImage]
    ) -> some View {
        if role == .assistant {
            MarkdownView(content: content)
                .font(Theme.FontStyle.sans(13))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if !attachments.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(attachments) { attachment in
                                Button {
                                    onAttachmentTap(attachment)
                                } label: {
                                    ChatAttachmentImage(
                                        attachment: attachment,
                                        api: api,
                                        cache: cache,
                                        contentMode: .fill
                                    )
                                    .frame(width: 92, height: 92)
                                    .background(Color.black.opacity(0.2))
                                    .clipShape(RoundedRectangle(cornerRadius: 9))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Open attached image")
                            }
                        }
                    }
                }
                if !pendingAttachments.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(pendingAttachments) { attachment in
                                if let image = attachment.image {
                                    Image(uiImage: image)
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                        .frame(width: 92, height: 92)
                                        .clipShape(RoundedRectangle(cornerRadius: 9))
                                        .accessibilityLabel("Pending attached image")
                                }
                            }
                        }
                    }
                }
                if !content.isEmpty {
                    Text(content)
                        .font(Theme.FontStyle.sans(13))
                }
            }
        }
    }

}

private struct ChatAttachmentImage: View {
    let attachment: ChatAttachment
    let api: APIClient
    let cache: ChatAttachmentCache
    let contentMode: ContentMode

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            } else if failed {
                Image(systemName: "photo.badge.exclamationmark")
                    .foregroundStyle(Theme.Palette.fg3)
            } else {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .task(id: attachment.id) {
            do {
                let data = try await cache.data(for: attachment, api: api)
                try Task.checkCancellation()
                guard let loaded = UIImage(data: data) else {
                    failed = true
                    return
                }
                image = loaded
            } catch is CancellationError {
                return
            } catch {
                failed = true
            }
        }
    }
}

private struct ChatAttachmentViewer: View {
    @Environment(\.dismiss) private var dismiss

    let attachment: ChatAttachment
    let api: APIClient
    let cache: ChatAttachmentCache

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                ChatAttachmentImage(
                    attachment: attachment,
                    api: api,
                    cache: cache,
                    contentMode: .fit
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            }
            .navigationTitle("Attached image")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
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
