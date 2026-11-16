import SwiftUI

struct ThreadListView: View {
    @Binding var selection: CoachSelection?
    /// The thread shown beside the list on a regular width; nil when the
    /// list is the whole screen.
    var highlightedThreadId: Int?
    /// True when the list is a pane beside the conversation. A split view's
    /// sidebar always reports a compact size class, so the parent decides.
    var isPane = false
    /// Fixed threads for previews and rendering tests; skips the network.
    var previewThreads: [ChatThread]? = nil

    @Environment(\.api) private var api
    @Environment(\.chatInFlight) private var inFlight
    @Environment(\.foldGeometry) private var fold
    @State private var deletingThread: ChatThread?
    @State private var deleteError: String?
    @State private var isDeleting = false
    @State private var titleRefreshTask: Task<Void, Never>?
    @State private var threads: [ChatThread] = []
    @State private var phase: Phase = .loading
    @State private var query = ""

    enum Phase {
        case loading
        case loaded
        case error(String)
    }

    /// Width of the list pane, which the person can resize.
    @State private var paneWidth: CGFloat = 0

    /// Keeps rows on the leading side of the fold when the list pane ends
    /// inside the fold band.
    private var trailingInset: CGFloat {
        guard isPane else { return 0 }
        return CoachPaneLayout.listTrailingInset(listWidth: paneWidth, hinge: fold.hinge)
    }

    var body: some View {
        content
            .navigationTitle("Coach")
            .toolbar {
                // On a regular width New chat lives on the conversation's
                // toolbar, which iPhone Duo places on the side rail.
                if !isPane {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            selection = .new(id: UUID(), draft: nil)
                        } label: {
                            Label("New chat", systemImage: "square.and.pencil")
                        }
                        .tint(Theme.Palette.accent)
                    }
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { paneWidth = $0 }
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
            .task {
                if let previewThreads {
                    threads = previewThreads
                    phase = .loaded
                } else {
                    await load()
                }
            }
            .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading where threads.isEmpty:
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(0..<6, id: \.self) { _ in
                        ThreadRow(thread: ThreadRow.placeholder, state: .idle)
                    }
                }
                .padding(.leading, Theme.Spacing.md)
                .padding(.trailing, Theme.Spacing.md + trailingInset)
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
                        .foregroundStyle(Theme.Palette.fg0)
                        .padding(.horizontal, 20)
                        .frame(minHeight: 44)
                        .overlay(Rectangle().strokeBorder(Theme.Palette.borderStrong, lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard()
            .padding(.leading, Theme.Spacing.md)
            .padding(.trailing, Theme.Spacing.md + trailingInset)
            .padding(.vertical, Theme.Spacing.md)
            .frame(maxHeight: .infinity, alignment: .top)
        default:
            if threads.isEmpty {
                emptyState
            } else {
                VStack(spacing: 0) {
                    searchField
                    results
                }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.Palette.fg3)
                .accessibilityHidden(true)
            TextField("Search conversations", text: $query)
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg0)
                .tint(Theme.Palette.accent)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("thread-search")
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.Palette.fg3)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, query.isEmpty ? 12 : 0)
        .frame(minHeight: 44)
        .background(Theme.Palette.composerSurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.leading, Theme.Spacing.md)
        .padding(.trailing, Theme.Spacing.md + trailingInset)
        .padding(.bottom, Theme.Spacing.xs)
    }

    @ViewBuilder
    private var results: some View {
        let visible = ThreadListLogic.filter(threads, query: query)
        if visible.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("No matches")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                Text("No conversation title or preview contains “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”.")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Theme.Spacing.md)
            .padding(.trailing, Theme.Spacing.md + trailingInset)
            .padding(.top, Theme.Spacing.md)
            Spacer(minLength: 0)
        } else {
            List {
                ForEach(ThreadGroup.group(visible)) { group in
                    Section {
                        ForEach(group.threads) { thread in
                            row(thread)
                        }
                    } header: {
                        Text(group.title)
                            .font(Theme.FontStyle.sans(12, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg3)
                            .textCase(nil)
                            .accessibilityAddTraits(.isHeader)
                    }
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListHeaderHeight, 28)
        }
    }

    private func row(_ thread: ChatThread) -> some View {
        let isSelected = thread.id == highlightedThreadId
        let state = ThreadListLogic.rowState(for: thread.id, inFlight: inFlight.inFlight)
        let locked = isDeleting || state != .idle
        return Button {
            // Re-picking the conversation already on screen must not rebuild
            // it: a new chat mid-stream would lose its live reply.
            guard !isSelected else { return }
            selection = .thread(id: thread.id, title: thread.title)
        } label: {
            ThreadRow(thread: thread, state: state)
                .padding(.leading, Theme.Spacing.md)
                .padding(.trailing, Theme.Spacing.md + trailingInset)
        }
        .buttonStyle(ThreadRowStyle(isSelected: isSelected))
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if !locked {
                Button(role: .destructive) {
                    deletingThread = thread
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
        .contextMenu {
            Button("Delete conversation", systemImage: "trash", role: .destructive) {
                deletingThread = thread
            }
            .disabled(locked)
        }
        .accessibilityAction(named: "Delete conversation") {
            guard !locked else { return }
            deletingThread = thread
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No conversations yet")
                .font(Theme.FontStyle.sans(20, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
            Text("Start a new chat with the compose button. Coach reads your recovery, sleep and training before it answers.")
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg2)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                selection = .new(id: UUID(), draft: nil)
            } label: {
                Label("New chat", systemImage: "square.and.pencil")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .overlay(Rectangle().strokeBorder(Theme.Palette.borderStrong, lineWidth: 1))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, Theme.Spacing.md)
        .padding(.trailing, Theme.Spacing.md + trailingInset)
        .padding(.top, Theme.Spacing.md)
        .frame(maxHeight: .infinity, alignment: .top)
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
        guard previewThreads == nil else { return }
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

/// Pure list logic, kept apart from the view so it can be unit tested.
enum ThreadListLogic {
    enum RowState: Equatable {
        case idle
        /// A reply is in flight; `question` is the pending message, if known.
        case replying(question: String?)
    }

    static func rowState(for threadId: Int, inFlight: [Int: ChatInFlightTurn]) -> RowState {
        guard let turn = inFlight[threadId] else { return .idle }
        let question = turn.pendingText?.trimmingCharacters(in: .whitespacesAndNewlines)
        return .replying(question: (question?.isEmpty == false) ? question : nil)
    }

    /// Case- and diacritic-insensitive match on title or preview. An empty
    /// query keeps every thread.
    static func filter(_ threads: [ChatThread], query: String) -> [ChatThread] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return threads }
        return threads.filter { thread in
            thread.displayTitle.localizedStandardContains(needle)
                || (thread.lastPreview.map(MarkdownView.plain)?.localizedStandardContains(needle) ?? false)
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
            } else if let yesterday = calendar.date(byAdding: .day, value: -1, to: startOfToday),
                      calendar.isDate(thread.updatedAt, inSameDayAs: yesterday) {
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
            .background(isSelected || configuration.isPressed ? Theme.Palette.bg3 : .clear)
            .overlay(alignment: .leading) {
                if isSelected {
                    Rectangle()
                        .fill(Theme.Palette.accent)
                        .frame(width: 2)
                }
            }
    }
}

private struct ThreadRow: View {
    let thread: ChatThread
    let state: ThreadListLogic.RowState
    var showsDivider = true
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    static let placeholder = ChatThread(
        id: 0,
        title: "How was my sleep last night?",
        updatedAt: .now,
        messageCount: 2,
        lastPreview: "You fell asleep around 1:17 AM and woke around 9:59 AM, which left you short of your need."
    )

    private var preview: String? {
        if case .replying(let question) = state, let question { return question }
        return thread.lastPreview.map(MarkdownView.plain).flatMap { $0.isEmpty ? nil : $0 }
    }

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
                trailing
                    .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: true)
            }
            if let preview {
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
            if showsDivider { CoachLedgerRule() }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var trailing: some View {
        if case .replying = state {
            HStack(spacing: 6) {
                Circle()
                    .fill(Theme.Palette.strain)
                    .frame(width: 8, height: 8)
                Text("Replying…")
                    .font(Theme.FontStyle.sans(12, weight: .medium))
                    .foregroundStyle(Theme.Palette.strain)
            }
        } else {
            Text(Self.timestamp(thread.updatedAt))
                .font(Theme.FontStyle.mono(11))
                .foregroundStyle(Theme.Palette.fg3)
        }
    }

    static func timestamp(_ date: Date, now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(.dateTime.hour().minute())
        }
        if calendar.isDateInYesterday(date) { return date.formatted(.dateTime.hour().minute()) }
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
