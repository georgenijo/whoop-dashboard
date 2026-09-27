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
    @State private var activeTools: [LiveToolActivity] = []
    @State private var recoveryStatus: RecoveryStatus?
    @State private var showAbandonRecoveryConfirmation = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var pendingImages: [PendingChatImage] = []
    @State private var isPreparingImages = false
    @State private var selectedAttachment: ChatAttachment?
    @State private var attachmentCache = ChatAttachmentCache()
    @State private var scrollState = ChatScrollState()
    @State private var jumpRequest = 0
    @FocusState private var isComposerFocused: Bool

    /// `initialDraft` only pre-fills the composer; nothing is sent until the user taps send.
    init(threadId: Int?, initialTitle: String?, initialDraft: String? = nil) {
        self.initialTitle = initialTitle
        self._threadId = State(initialValue: threadId)
        self._input = State(initialValue: initialDraft ?? "")
    }

    static let suggestedPrompts = [
        "How was my recovery this week?",
        "Why did I sleep badly last night?",
        "What should I train today?",
        "Compare this week to last week"
    ]

    struct StreamingAssistant {
        let id: UUID
        var text: String
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

        /// A user message opens a new turn; extra space above it separates turns.
        var startsTurn: Bool {
            switch self {
            case .persisted(let m): return m.role == .user
            case .optimistic: return true
            case .streaming, .typing: return false
            }
        }
    }

    var body: some View {
        messagesList
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if let recoveryStatus {
                        recoveryBar(recoveryStatus)
                    }
                    if let sendError {
                        sendErrorBanner(sendError)
                    }
                    composer
                }
                .background {
                    LinearGradient(
                        stops: [
                            .init(color: Theme.Palette.bg0.opacity(0), location: 0),
                            .init(color: Theme.Palette.bg0.opacity(0.92), location: 0.28),
                            .init(color: Theme.Palette.bg0, location: 1)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .padding(.top, -18)
                    .ignoresSafeArea()
                }
                .overlay(alignment: .top) {
                    JumpToLatestButton(scroll: scrollState, hidden: rows.isEmpty) {
                        jumpRequest += 1
                    }
                    .offset(y: -54)
                }
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

    private static let bottomAnchorId = "chat-bottom"
    private static let scrollSpace = "chat-scroll"


    @ViewBuilder
    private var messagesList: some View {
        if rows.isEmpty, let loadError {
            VStack(alignment: .leading, spacing: 12) {
                Label("Couldn’t load this conversation", systemImage: "exclamationmark.bubble")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                Text(loadError)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await loadHistory() }
                } label: {
                    Text("Retry")
                        .font(Theme.FontStyle.sans(14, weight: .semibold))
                        .foregroundStyle(Theme.Palette.bg0)
                        .padding(.horizontal, 20)
                        .frame(minHeight: 40)
                        .background(Theme.Palette.fg0, in: Capsule())
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard()
            .padding(Theme.Spacing.md)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if rows.isEmpty && threadId != nil {
            ChatLoadingPlaceholder()
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.top, Theme.Spacing.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else if rows.isEmpty {
            ScrollView {
                emptyAsk
                    .containerRelativeFrame(.vertical)
            }
            .scrollDismissesKeyboard(.interactively)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    let dayLabels = Self.dayLabels(for: rows)
                    LazyVStack(spacing: 14) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                            VStack(alignment: .leading, spacing: 0) {
                                if let day = dayLabels[index] {
                                    ChatDayDivider(text: day)
                                        .padding(.top, index == 0 ? 0 : 14)
                                        .padding(.bottom, 16)
                                }
                                MessageBubble(
                                    row: row,
                                    activeTools: activeTools,
                                    api: api,
                                    cache: attachmentCache,
                                    onAttachmentTap: { selectedAttachment = $0 }
                                )
                            }
                            .padding(.top, index > 0 && row.startsTurn ? 18 : 0)
                            .id(row.id)
                            .transition(
                                .asymmetric(
                                    insertion: .opacity.combined(with: .offset(y: 14)),
                                    removal: .opacity
                                )
                            )
                        }
                        Color.clear
                            .frame(height: 1)
                            .id(Self.bottomAnchorId)
                            .background {
                                GeometryReader { geometry in
                                    Color.clear.onChange(
                                        of: geometry.frame(in: .named(Self.scrollSpace)).minY,
                                        initial: true
                                    ) { _, minY in
                                        scrollState.update(bottomEdge: minY)
                                    }
                                }
                            }
                    }
                    .animation(.snappy(duration: 0.32), value: rows.count)
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.top, Theme.Spacing.md)
                    .padding(.bottom, Theme.Spacing.sm)
                }
                .scrollContentBackground(.hidden)
                .coordinateSpace(name: Self.scrollSpace)
                .background {
                    GeometryReader { geometry in
                        Color.clear.onChange(of: geometry.size.height, initial: true) { _, height in
                            scrollState.viewportHeight = height
                        }
                    }
                }
                .onAppear {
                    proxy.scrollTo(Self.bottomAnchorId, anchor: .bottom)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: rows.last?.id) { _, newLastId in
                    if let newLastId {
                        withAnimation { proxy.scrollTo(newLastId, anchor: .bottom) }
                    }
                }
                .onChange(of: jumpRequest) { _, _ in
                    withAnimation(.snappy) { proxy.scrollTo(Self.bottomAnchorId, anchor: .bottom) }
                }
            }
        }
    }

    /// A day caption before the first message of each calendar day. Computed
    /// once per render in a single forward pass — the old per-row lookup
    /// rescanned the whole preceding transcript for every row, which is
    /// quadratic over a long thread.
    static func dayLabels(for rows: [ChatRow]) -> [Int: String] {
        let calendar = Calendar.current
        var result: [Int: String] = [:]
        var previousDate: Date?
        for (index, row) in rows.enumerated() {
            guard case .persisted(let message) = row else { continue }
            if let priorDate = previousDate, calendar.isDate(priorDate, inSameDayAs: message.createdAt) {
                previousDate = message.createdAt
                continue
            }
            result[index] = dayText(message.createdAt)
            previousDate = message.createdAt
        }
        return result
    }

    static func dayText(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        let sameYear = calendar.isDate(date, equalTo: .now, toGranularity: .year)
        return sameYear
            ? date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
            : date.formatted(.dateTime.month(.abbreviated).day().year())
    }

    private var emptyAsk: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [Theme.Palette.ai.opacity(0.28), Theme.Palette.ai.opacity(0)],
                                center: .center,
                                startRadius: 0,
                                endRadius: 48
                            )
                        )
                        .frame(width: 96, height: 96)
                    Image(systemName: "sparkles")
                        .font(.system(size: 30, weight: .light))
                        .foregroundStyle(Theme.Palette.ai)
                        .shadow(color: Theme.Palette.ai.opacity(0.6), radius: 10)
                }
                Text("Ask the coach")
                    .font(Theme.FontStyle.sans(22, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                Text("It reads your recovery, sleep, and training before it answers.")
                    .font(Theme.FontStyle.sans(14))
                    .foregroundStyle(Theme.Palette.fg2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.Spacing.xl)
            }
            Spacer(minLength: 24)
            VStack(alignment: .leading, spacing: 8) {
                Text("TRY")
                    .font(Theme.FontStyle.sans(11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.Palette.fg3)
                    .padding(.leading, 4)
                ForEach(Self.suggestedPrompts, id: \.self) { prompt in
                    Button {
                        input = prompt
                        isComposerFocused = true
                    } label: {
                        HStack(spacing: 10) {
                            Text(prompt)
                                .font(Theme.FontStyle.sans(15))
                                .foregroundStyle(Theme.Palette.fg1)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.up.left")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg3)
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 48)
                        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.Palette.borderSubtle))
                        .contentShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(ChatPressStyle())
                    .accessibilityHint("Fills the message field")
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.md)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !pendingImages.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(pendingImages) { image in
                                ZStack(alignment: .topTrailing) {
                                    if let thumbnail = image.image {
                                        Image(uiImage: thumbnail)
                                            .resizable()
                                            .aspectRatio(contentMode: .fill)
                                            .frame(width: 54, height: 54)
                                            .clipShape(RoundedRectangle(cornerRadius: 9))
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 9)
                                                    .strokeBorder(Theme.Palette.borderDefault)
                                            )
                                    }
                                    Button {
                                        removePendingImage(image.id)
                                    } label: {
                                        ZStack {
                                            Circle()
                                                .fill(Color.black.opacity(0.82))
                                                .frame(width: 18, height: 18)
                                                .overlay(
                                                    Circle()
                                                        .strokeBorder(Color.white.opacity(0.25))
                                                )
                                            Image(systemName: "xmark")
                                                .font(.system(size: 8, weight: .bold))
                                                .foregroundStyle(Color.white)
                                        }
                                        .frame(width: 44, height: 44)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .offset(x: 13, y: -13)
                                    .disabled(isSending)
                                    .accessibilityLabel("Remove selected image")
                                }
                                .padding(.top, 13)
                                .padding(.trailing, 13)
                            }
                        }
                    }
                    Label(
                        "Image analysis isn’t a medical diagnosis.",
                        systemImage: "cross.case"
                    )
                    .font(Theme.FontStyle.sans(11))
                    .foregroundStyle(Theme.Palette.fg3)
                }
                .padding(.horizontal, 2)
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

            VStack(alignment: .leading, spacing: 2) {
                TextField("Ask about recovery, sleep, strain…", text: $input, axis: .vertical)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg0)
                    .tint(Theme.Palette.ai)
                    .lineLimit(1...6)
                    .disabled(isSending)
                    .textFieldStyle(.plain)
                    .focused($isComposerFocused)
                    .padding(.horizontal, 6)
                    .padding(.top, 8)

                HStack(spacing: 2) {
                    PhotosPicker(
                        selection: $photoPickerItems,
                        maxSelectionCount: max(1, 3 - pendingImages.count),
                        matching: .images
                    ) {
                        Image(systemName: "plus")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg1)
                            .frame(width: 32, height: 32)
                            .background(Color.white.opacity(0.07), in: Circle())
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .disabled(isSending || isPreparingImages || pendingImages.count >= 3)
                    .opacity(isSending || pendingImages.count >= 3 ? 0.4 : 1)
                    .accessibilityLabel("Attach photos")
                    .accessibilityValue("\(pendingImages.count) of 3 selected")
                    .padding(.leading, -6)

                    CoachModelPicker(disabled: isSending)

                    Spacer(minLength: 4)

                    Button {
                        Task { await send() }
                    } label: {
                        ZStack {
                            Circle()
                                .fill(canSend ? Theme.Palette.fg0 : Color.white.opacity(0.08))
                            if isSending {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(Theme.Palette.fg2)
                            } else {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(canSend ? Theme.Palette.bg0 : Theme.Palette.fg3)
                            }
                        }
                        .frame(width: 34, height: 34)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                        .animation(.snappy(duration: 0.2), value: canSend)
                    }
                    .buttonStyle(ChatPressStyle())
                    .disabled(!canSend)
                    .padding(.trailing, -5)
                    .accessibilityLabel(isSending ? "Sending" : "Send message")
                    .sensoryFeedback(.impact(weight: .light), trigger: isSending) { _, sending in sending }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 2)
            .background(Theme.Palette.bg2, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(
                        isComposerFocused ? Theme.Palette.borderStrong : Theme.Palette.borderDefault,
                        lineWidth: 1
                    )
            )
            .animation(.snappy(duration: 0.2), value: isComposerFocused)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.top, 6)
        .padding(.bottom, 8)
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
                    activeTools.append(LiveToolActivity(name: name, stage: nil))

                case .toolProgress(let tool, let stage, _):
                    if let idx = activeTools.lastIndex(where: { $0.name == tool }) {
                        activeTools[idx].stage = stage
                    } else {
                        activeTools.append(LiveToolActivity(name: tool, stage: stage))
                    }

                case .toolUseEnd(let name, _, _, _, _):
                    if let idx = activeTools.lastIndex(where: { $0.name == name }) {
                        activeTools.remove(at: idx)
                    }

                case .done(let reply, _):
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
            rows.append(.streaming(id: assistant.id, content: assistant.text))
        }
    }

    private func commitAssistant(reply: String) {
        rows.removeAll { if case .typing = $0 { return true }; return false }
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
    let activeTools: [LiveToolActivity]
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
                workLog: message.workLog,
                presentationBlocks: message.presentationBlocks,
                dimmed: false
            )
        case .optimistic(_, let content, let attachments):
            bubble(
                role: .user,
                content: content,
                attachments: [],
                pendingAttachments: attachments,
                workLog: nil,
                presentationBlocks: [],
                dimmed: true
            )
        case .streaming(_, let content):
            bubble(
                role: .assistant,
                content: content,
                attachments: [],
                pendingAttachments: [],
                workLog: nil,
                presentationBlocks: [],
                dimmed: false
            )
        case .typing:
            LiveCoachWorkView(tools: activeTools)
        }
    }

    @ViewBuilder
    private func bubble(
        role: ChatMessage.Role,
        content: String,
        attachments: [ChatAttachment],
        pendingAttachments: [PendingChatImage],
        workLog: CoachWorkLog?,
        presentationBlocks: [CoachPresentationBlock],
        dimmed: Bool
    ) -> some View {
        Group {
            if role == .user {
                userMessage(
                    content: content,
                    attachments: attachments,
                    pendingAttachments: pendingAttachments,
                    dimmed: dimmed
                )
            } else {
                bubbleContent(
                    role: role,
                    content: content,
                    attachments: attachments,
                    pendingAttachments: pendingAttachments,
                    workLog: workLog,
                    presentationBlocks: presentationBlocks
                )
                    .foregroundStyle(Theme.Palette.fg1)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func userMessage(
        content: String,
        attachments: [ChatAttachment],
        pendingAttachments: [PendingChatImage],
        dimmed: Bool
    ) -> some View {
        VStack(alignment: .trailing, spacing: 7) {
            if !attachments.isEmpty || !pendingAttachments.isEmpty {
                HStack(spacing: 6) {
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
                            .frame(width: 76, height: 76)
                            .background(Color.black.opacity(0.2))
                            .clipShape(RoundedRectangle(cornerRadius: 11))
                            .overlay(
                                RoundedRectangle(cornerRadius: 11)
                                    .strokeBorder(Theme.Palette.borderDefault)
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open attached image")
                    }
                    ForEach(pendingAttachments) { attachment in
                        if let image = attachment.image {
                            Image(uiImage: image)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 76, height: 76)
                                .clipShape(RoundedRectangle(cornerRadius: 11))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 11)
                                        .strokeBorder(Theme.Palette.borderDefault)
                                )
                                .accessibilityLabel("Pending attached image")
                        }
                    }
                }
                .opacity(dimmed ? 0.72 : 1)
            }
            if !content.isEmpty {
                Text(content)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg0.opacity(dimmed ? 0.7 : 1))
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.white.opacity(dimmed ? 0.06 : 0.09))
                    .overlay(bubbleBorder(role: .user))
                    .clipShape(bubbleShape(role: .user))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.leading, 48)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    @ViewBuilder
    private func bubbleContent(
        role: ChatMessage.Role,
        content: String,
        attachments: [ChatAttachment],
        pendingAttachments: [PendingChatImage],
        workLog: CoachWorkLog?,
        presentationBlocks: [CoachPresentationBlock]
    ) -> some View {
        if role == .assistant {
            VStack(alignment: .leading, spacing: 14) {
                if let workLog {
                    CoachWorkLogView(workLog: workLog)
                        .padding(.bottom, -4)
                }
                MarkdownView(content: content, style: .chat)
                if !presentationBlocks.isEmpty {
                    CoachPresentationBlocksView(blocks: presentationBlocks)
                        .padding(.top, 2)
                }
            }
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

    private func bubbleBackground(role: ChatMessage.Role, dimmed: Bool) -> some View {
        Group {
            if role == .user {
                Color.white.opacity(dimmed ? 0.04 : 0.06)
            } else {
                Color.clear
            }
        }
    }

    private func bubbleBorder(role: ChatMessage.Role) -> some View {
        bubbleShape(role: role)
            .strokeBorder(role == .user ? Theme.Palette.borderDefault : .clear, lineWidth: 1)
    }

    private func bubbleShape(role: ChatMessage.Role) -> UnevenRoundedRectangle {
        if role == .user {
            UnevenRoundedRectangle(cornerRadii: .init(topLeading: 18, bottomLeading: 18, bottomTrailing: 6, topTrailing: 18), style: .continuous)
        } else {
            UnevenRoundedRectangle(cornerRadii: .init(topLeading: 14, bottomLeading: 4, bottomTrailing: 14, topTrailing: 14))
        }
    }
}

struct ChatPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

private struct ChatDayDivider: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            line
            Text(text)
                .font(Theme.FontStyle.mono(11))
                .foregroundStyle(Theme.Palette.fg3)
                .fixedSize()
            line
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityAddTraits(.isHeader)
    }

    private var line: some View {
        Rectangle()
            .fill(Theme.Palette.borderSubtle)
            .frame(height: 1)
    }
}

/// Shaped stand-in for a thread while its history loads.
private struct ChatLoadingPlaceholder: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Spacer(minLength: 80)
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.white.opacity(0.07))
                    .frame(width: 200, height: 40)
            }
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.white.opacity(0.05))
                .frame(width: 120, height: 12)
            VStack(alignment: .leading, spacing: 10) {
                ForEach([1.0, 0.94, 0.98, 0.6], id: \.self) { fraction in
                    GeometryReader { proxy in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.white.opacity(0.06))
                            .frame(width: proxy.size.width * fraction)
                    }
                    .frame(height: 13)
                }
            }
        }
        .phaseAnimator([0.55, 1.0]) { content, phase in
            content.opacity(phase)
        } animation: { _ in .easeInOut(duration: 0.9) }
        .accessibilityLabel("Loading conversation")
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

#Preview("New chat") {
    NavigationStack {
        ChatView(threadId: nil, initialTitle: nil)
    }
    .preferredColorScheme(.dark)
}

#Preview("Loading + day divider") {
    VStack(spacing: 24) {
        ChatDayDivider(text: "Saturday, Sep 26")
        ChatLoadingPlaceholder()
    }
    .padding()
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Color.black)
    .preferredColorScheme(.dark)
}

/// Holds scroll position outside ChatView's own state. Only JumpToLatestButton
/// reads it, so crossing the bottom never re-renders the message list. Keeping
/// it as ChatView @State caused a re-layout loop that pinned the main thread.
@Observable
final class ChatScrollState {
    private(set) var isAtBottom = true
    @ObservationIgnored var viewportHeight: CGFloat = 0

    /// `bottomEdge` is the end-of-transcript marker's y in the scroll viewport.
    func update(bottomEdge: CGFloat) {
        guard viewportHeight > 0 else { return }
        let atBottom = bottomEdge <= viewportHeight + 120
        if atBottom != isAtBottom { isAtBottom = atBottom }
    }
}

private struct JumpToLatestButton: View {
    let scroll: ChatScrollState
    let hidden: Bool
    let action: () -> Void

    var body: some View {
        let visible = !scroll.isAtBottom && !hidden
        ZStack {
            if visible {
                button
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
            }
        }
        .animation(.snappy, value: visible)
    }

    private var button: some View {
        Button(action: action) {
            Image(systemName: "arrow.down")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .frame(width: 36, height: 36)
                .background(Theme.Palette.bg3, in: Circle())
                .overlay(Circle().strokeBorder(Theme.Palette.borderDefault))
                .shadow(color: .black.opacity(0.5), radius: 10, y: 4)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Jump to latest message")
    }
}
