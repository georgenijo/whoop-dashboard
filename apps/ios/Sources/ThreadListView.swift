import SwiftUI

struct ThreadListView: View {
    @Binding var selection: CoachSelection?
    /// The thread shown beside the list on a regular width; nil when the
    /// list is the whole screen.
    var highlightedThreadId: Int?

    @Environment(\.api) private var api
    @Environment(\.chatInFlight) private var inFlight
    @State private var deletingThread: ChatThread?
    @State private var deleteError: String?
    @State private var isDeleting = false
    @State private var titleRefreshTask: Task<Void, Never>?
    @State private var threads: [ChatThread] = []
    @State private var phase: Phase = .loading

    enum Phase {
        case loading
        case loaded
        case error(String)
    }

    var body: some View {
        content
            .navigationTitle("Coach")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        selection = .new(id: UUID(), draft: nil)
                    } label: {
                        Label("New chat", systemImage: "square.and.pencil")
                    }
                    .tint(Theme.Palette.accent)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .chatThreadListChanged)) { _ in
                titleRefreshTask?.cancel()
                titleRefreshTask = Task {
                    await load()
                    // Coalesce title refreshes instead of retaining a task per turn.
                    try? await Task.sleep(for: .seconds(6))
                    guard !Task.isCancelled else { return }
                    await load()
                }
            }
            .onDisappear { titleRefreshTask?.cancel() }
            .confirmationDialog("Delete conversation?", isPresented: Binding(
                get: { deletingThread != nil },
                set: { if !$0 { deletingThread = nil } }
            ), titleVisibility: .visible) {
                if let thread = deletingThread {
                    Button("Delete conversation", role: .destructive) {
                        Task { await delete(thread) }
                    }
                }
            } message: {
                Text("This permanently removes the conversation and its messages.")
            }
            .alert("Couldn’t delete conversation", isPresented: Binding(
                get: { deleteError != nil }, set: { if !$0 { deleteError = nil } }
            )) { Button("OK") { deleteError = nil } } message: { Text(deleteError ?? "") }
            .task { await load() }
            .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading where threads.isEmpty:
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(0..<6, id: \.self) { _ in
                        ThreadRow(thread: ThreadRow.placeholder)
                    }
                }
                .padding(.horizontal, Theme.Spacing.md)
                .redacted(reason: .placeholder)
            }
            .scrollDisabled(true)
            .accessibilityLabel("Loading conversations")
        case .error(let message) where threads.isEmpty:
            VStack(alignment: .leading, spacing: 12) {
                Label("Couldn’t load conversations", systemImage: "exclamationmark.bubble")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                Text(message)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
                Button {
                    Task { await load() }
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
            .frame(maxHeight: .infinity, alignment: .top)
        default:
            if threads.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: []) {
                        ForEach(ThreadGroup.group(threads)) { group in
                            Text(group.title)
                                .font(Theme.FontStyle.sans(12, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg3)
                                .padding(.top, group.id == 0 ? 6 : 22)
                                .padding(.bottom, 2)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(group.threads) { thread in
                                let isSelected = thread.id == highlightedThreadId
                                Button {
                                    // Re-picking the conversation already on
                                    // screen must not rebuild it: a new chat
                                    // mid-stream would lose its live reply.
                                    guard !isSelected else { return }
                                    selection = .thread(id: thread.id, title: thread.title)
                                } label: {
                                    ThreadRow(thread: thread)
                                }
                                .buttonStyle(ThreadRowStyle(isSelected: isSelected))
                                .accessibilityAddTraits(isSelected ? .isSelected : [])
                                .contextMenu {
                                    Button("Delete conversation", systemImage: "trash", role: .destructive) {
                                        deletingThread = thread
                                    }
                                    .disabled(isDeleting || inFlight.inFlight[thread.id] != nil)
                                }
                                .accessibilityAction(named: "Delete conversation") {
                                    guard !isDeleting, inFlight.inFlight[thread.id] == nil else { return }
                                    deletingThread = thread
                                }
                            }
                        }
                    }
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.bottom, Theme.Spacing.xl)
                }
                .scrollContentBackground(.hidden)
            }
        }
    }

    private var emptyState: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No conversations yet")
                        .font(Theme.FontStyle.sans(20, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg0)
                    Text("Start with a question about recovery, sleep, or training.")
                        .font(Theme.FontStyle.sans(14))
                        .foregroundStyle(Theme.Palette.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, 10)
                ForEach(ChatView.suggestedPrompts, id: \.self) { prompt in
                    Button {
                        selection = .new(id: UUID(), draft: prompt)
                    } label: {
                        HStack {
                            Text(prompt)
                                .font(Theme.FontStyle.sans(15))
                                .foregroundStyle(Theme.Palette.fg1)
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.Palette.fg3)
                        }
                        .padding(.vertical, 12)
                        .frame(minHeight: 52)
                        .overlay(alignment: .top) {
                            Rectangle().fill(Theme.Palette.borderSubtle).frame(height: 1)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(ChatPressStyle())
                }
            }
            .padding(Theme.Spacing.md)
        }
    }

    @MainActor
    private func delete(_ thread: ChatThread) async {
        guard !isDeleting, inFlight.inFlight[thread.id] == nil else { return }
        isDeleting = true
        defer { isDeleting = false; deletingThread = nil }
        do {
            let _: APIEmptyResponse = try await api.delete("/api/threads/\(thread.id)")
            threads.removeAll { $0.id == thread.id }
            if case .thread(let id, _) = selection, id == thread.id {
                selection = nil
            } else if highlightedThreadId == thread.id {
                selection = nil
            }
        } catch {
            deleteError = "Your conversation is still here. Check your connection and try again."
        }
    }

    @MainActor
    private func load() async {
        do {
            threads = try await ChatService(api: api).listThreads()
            phase = .loaded
        } catch is CancellationError {
            return
        } catch APIError.unauthorized {
            phase = .error("Session expired. Sign in again.")
        } catch APIError.network(let err) {
            if (err as NSError).code == NSURLErrorCancelled { return }
            phase = .error("Network error: \(err.localizedDescription)")
        } catch APIError.serverError(let code) {
            phase = .error("Server error (\(code))")
        } catch {
            phase = .error("Could not load threads")
        }
    }
}

struct ThreadGroup: Identifiable {
    let id: Int
    let title: String
    let threads: [ChatThread]

    static func group(_ threads: [ChatThread], now: Date = .now, calendar: Calendar = .current) -> [ThreadGroup] {
        let sorted = threads.sorted { $0.updatedAt > $1.updatedAt }
        let startOfToday = calendar.startOfDay(for: now)
        let weekAgo = calendar.date(byAdding: .day, value: -7, to: startOfToday) ?? startOfToday
        var buckets: [(String, [ChatThread])] = [("Today", []), ("Yesterday", []), ("Previous 7 days", []), ("Earlier", [])]
        for thread in sorted {
            if calendar.isDate(thread.updatedAt, inSameDayAs: now) {
                buckets[0].1.append(thread)
            } else if calendar.isDateInYesterday(thread.updatedAt) {
                buckets[1].1.append(thread)
            } else if thread.updatedAt >= weekAgo {
                buckets[2].1.append(thread)
            } else {
                buckets[3].1.append(thread)
            }
        }
        return buckets.filter { !$0.1.isEmpty }.enumerated().map { index, bucket in
            ThreadGroup(id: index, title: bucket.0, threads: bucket.1)
        }
    }
}

private struct ThreadRowStyle: ButtonStyle {
    var isSelected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                Rectangle()
                    .fill(isSelected || configuration.isPressed ? Theme.Palette.bg3 : .clear)
                    .padding(.horizontal, -10)
            }
            .overlay(alignment: .leading) {
                if isSelected {
                    Rectangle()
                        .fill(Theme.Palette.accent)
                        .frame(width: 2)
                        .padding(.leading, -10)
                }
            }
    }
}

private struct ThreadRow: View {
    let thread: ChatThread
    var showsDivider = true
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    static let placeholder = ChatThread(
        id: 0,
        title: "How was my sleep last night?",
        updatedAt: .now,
        messageCount: 2,
        lastPreview: "You fell asleep around 1:17 AM and woke around 9:59 AM, which left you short of your need."
    )

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 5))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 10))
            layout {
                Text(thread.displayTitle)
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 4) }
                Text(Self.timestamp(thread.updatedAt))
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: true)
            }
            if let preview = thread.lastPreview.map(MarkdownView.plain), !preview.isEmpty {
                Text(preview)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
                    .lineSpacing(2)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            if showsDivider {
                Rectangle()
                    .fill(Theme.Palette.borderSubtle)
                    .frame(height: 1)
            }
        }
    }

    static func timestamp(_ date: Date, now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(.dateTime.hour().minute())
        }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        if let days = calendar.dateComponents([.day], from: date, to: now).day, days < 7 {
            return date.formatted(.dateTime.weekday(.abbreviated))
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

#Preview {
    NavigationStack { ThreadListView(selection: .constant(nil)) }
        .preferredColorScheme(.dark)
}
