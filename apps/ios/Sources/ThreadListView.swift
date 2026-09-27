import SwiftUI

struct ThreadListView: View {
    @Environment(\.api) private var api
    @State private var threads: [ChatThread] = []
    @State private var phase: Phase = .loading

    enum Phase {
        case loading
        case loaded
        case error(String)
    }

    var body: some View {
        VStack(spacing: 0) {
            PageHeader("Coach") {
                NavigationLink {
                    ChatView(threadId: nil, initialTitle: nil)
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Theme.Palette.ai)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .padding(.vertical, -10)
                .accessibilityLabel("New chat")
            }
            content
        }
        .toolbar(.hidden, for: .navigationBar)
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
                .phaseAnimator([0.5, 1.0]) { content, phase in
                    content.opacity(phase)
                } animation: { _ in .easeInOut(duration: 0.9) }
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
                            Text(group.title.uppercased())
                                .font(Theme.FontStyle.sans(11, weight: .semibold))
                                .tracking(1.2)
                                .foregroundStyle(Theme.Palette.fg3)
                                .padding(.top, group.id == 0 ? 6 : 22)
                                .padding(.bottom, 2)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(Array(group.threads.enumerated()), id: \.element.id) { index, thread in
                                NavigationLink {
                                    ChatView(threadId: thread.id, initialTitle: thread.title)
                                } label: {
                                    ThreadRow(thread: thread, showsDivider: index < group.threads.count - 1)
                                }
                                .buttonStyle(ThreadRowStyle())
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
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("No conversations yet")
                        .font(Theme.FontStyle.sans(20, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg0)
                    Text("The coach reads your recovery, sleep, and training before it answers. Start with one of these.")
                        .font(Theme.FontStyle.sans(14))
                        .foregroundStyle(Theme.Palette.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, 10)
                ForEach(ChatView.suggestedPrompts, id: \.self) { prompt in
                    NavigationLink {
                        ChatView(threadId: nil, initialTitle: nil, initialDraft: prompt)
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
                        .padding(.horizontal, 14)
                        .frame(minHeight: 50)
                        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.Palette.borderSubtle))
                        .contentShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(ChatPressStyle())
                }
            }
            .padding(Theme.Spacing.md)
        }
    }

    @MainActor
    private func load() async {
        do {
            threads = try await ChatService(api: api).listThreads()
            phase = .loaded
        } catch APIError.unauthorized {
            phase = .error("Session expired. Sign in again.")
        } catch APIError.network(let err) {
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
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white.opacity(configuration.isPressed ? 0.06 : 0))
                    .padding(.horizontal, -10)
            )
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

private struct ThreadRow: View {
    let thread: ChatThread
    var showsDivider = true

    static let placeholder = ChatThread(
        id: 0,
        title: "How was my sleep last night?",
        updatedAt: .now,
        messageCount: 2,
        lastPreview: "You fell asleep around 1:17 AM and woke around 9:59 AM, which left you short of your need."
    )

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(thread.displayTitle)
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(Self.timestamp(thread.updatedAt))
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            if let preview = thread.lastPreview.map(MarkdownView.plain), !preview.isEmpty {
                Text(preview)
                    .font(Theme.FontStyle.sans(13.5))
                    .foregroundStyle(Theme.Palette.fg2)
                    .lineSpacing(2)
                    .lineLimit(2)
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
    NavigationStack { ThreadListView() }
        .preferredColorScheme(.dark)
}
