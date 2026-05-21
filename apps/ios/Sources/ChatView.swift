import SwiftUI

struct ChatView: View {
    let initialTitle: String?

    @Environment(\.api) private var api
    @State private var threadId: Int?
    @State private var rows: [ChatRow] = []
    @State private var input: String = ""
    @State private var isSending = false
    @State private var loadError: String?
    @State private var sendError: String?
    @State private var didLoadInitial = false

    init(threadId: Int?, initialTitle: String?) {
        self.initialTitle = initialTitle
        self._threadId = State(initialValue: threadId)
    }

    enum ChatRow: Identifiable, Hashable {
        case persisted(ChatMessage)
        case optimistic(id: UUID, content: String)
        case typing

        var id: String {
            switch self {
            case .persisted(let m): return "p-\(m.id)"
            case .optimistic(let id, _): return "o-\(id.uuidString)"
            case .typing: return "typing"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            messagesList
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
            }
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
                    LazyVStack(spacing: 10) {
                        ForEach(rows) { row in
                            MessageBubble(row: row)
                                .id(row.id)
                        }
                    }
                    .padding(Theme.Spacing.md)
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
        !isSending && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @MainActor
    private func loadHistory() async {
        guard let threadId else { return }
        loadError = nil
        do {
            let detail = try await ChatService(api: api).threadDetail(id: threadId)
            rows = detail.messages.map { .persisted($0) }
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
        let optimisticId = UUID()
        rows.append(.optimistic(id: optimisticId, content: trimmed))
        rows.append(.typing)
        input = ""
        defer { isSending = false }

        do {
            let response = try await ChatService(api: api).send(
                threadId: threadId,
                content: trimmed
            )
            threadId = response.threadId
            let detail = try await ChatService(api: api).threadDetail(id: response.threadId)
            rows = detail.messages.map { .persisted($0) }
        } catch APIError.unauthorized {
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
        } catch APIError.network(let err) {
            sendError = "Network error: \(err.localizedDescription)"
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
        } catch APIError.serverError(let code) {
            sendError = ChatView.friendlySendError(forStatus: code)
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
        } catch {
            sendError = "Could not send. Please try again."
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
        }
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
        case .typing:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                    .tint(Theme.Palette.ai)
                Text("Thinking…")
                    .font(Theme.FontStyle.sans(11))
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
            }
            .padding(.horizontal, 6)
        }
    }

    @ViewBuilder
    private func bubble(role: ChatMessage.Role, content: String, dimmed: Bool) -> some View {
        HStack {
            if role == .user { Spacer(minLength: 40) }
            bubbleContent(role: role, content: content)
                .padding(.horizontal, 13)
                .padding(.vertical, 10)
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

#Preview {
    NavigationStack {
        ChatView(threadId: nil, initialTitle: nil)
    }
}
