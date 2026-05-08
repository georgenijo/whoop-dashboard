import SwiftUI

struct ChatView: View {
    let initialThreadId: Int?
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
        self.initialThreadId = threadId
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
            Divider()
            composer
        }
        .navigationTitle(initialTitle ?? "New chat")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if !didLoadInitial {
                didLoadInitial = true
                await loadHistory()
            }
        }
    }

    @ViewBuilder
    private var messagesList: some View {
        if rows.isEmpty, let loadError {
            VStack(spacing: 12) {
                Text(loadError)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("Retry") { Task { await loadHistory() } }
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if rows.isEmpty && threadId != nil {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if rows.isEmpty {
            ContentUnavailableView(
                "Ask the coach",
                systemImage: "sparkles",
                description: Text("Try “How was my recovery this week?”")
            )
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(rows) { row in
                            MessageBubble(row: row)
                                .id(row.id)
                        }
                        if let sendError {
                            Text(sendError)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .padding(.horizontal)
                        }
                    }
                    .padding()
                }
                .onChange(of: rows.count) { _, _ in
                    if let last = rows.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message", text: $input, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...5)
                .disabled(isSending)
                .submitLabel(.send)
                .onSubmit { Task { await send() } }

            Button {
                Task { await send() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title)
            }
            .disabled(!canSend)
        }
        .padding()
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
            // Refresh from server so IDs/timestamps are canonical.
            let detail = try await ChatService(api: api).threadDetail(id: response.threadId)
            rows = detail.messages.map { .persisted($0) }
        } catch APIError.unauthorized {
            sendError = "Session expired. Sign in again."
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
        } catch APIError.network(let err) {
            sendError = "Network error: \(err.localizedDescription)"
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
        } catch APIError.serverError(let code) {
            sendError = "Server error (\(code))"
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
        } catch {
            sendError = "Could not send"
            rollbackOptimistic(optimisticId: optimisticId, restore: trimmed)
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
            HStack {
                ProgressView()
                Text("Thinking…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 12)
        }
    }

    @ViewBuilder
    private func bubble(role: ChatMessage.Role, content: String, dimmed: Bool) -> some View {
        HStack {
            if role == .user { Spacer(minLength: 40) }
            Text(rendered(content: content, role: role))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    role == .user
                        ? Color.accentColor.opacity(dimmed ? 0.6 : 1)
                        : Color(.secondarySystemGroupedBackground)
                )
                .foregroundStyle(role == .user ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .frame(maxWidth: .infinity, alignment: role == .user ? .trailing : .leading)
            if role == .assistant { Spacer(minLength: 40) }
        }
    }

    private func rendered(content: String, role: ChatMessage.Role) -> AttributedString {
        if role == .assistant,
           let attr = try? AttributedString(
               markdown: content,
               options: AttributedString.MarkdownParsingOptions(
                   interpretedSyntax: .inlineOnlyPreservingWhitespace
               )
           )
        {
            return attr
        }
        return AttributedString(content)
    }
}

#Preview {
    NavigationStack {
        ChatView(threadId: nil, initialTitle: nil)
    }
}
