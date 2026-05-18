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
                }
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
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .error(let message) where threads.isEmpty:
            VStack(spacing: 12) {
                Text(message)
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("Retry") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Palette.brandStrain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        default:
            if threads.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(threads) { thread in
                            NavigationLink {
                                ChatView(threadId: thread.id, initialTitle: thread.title)
                            } label: {
                                ThreadRow(thread: thread)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(Theme.Spacing.md)
                }
                .scrollContentBackground(.hidden)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Theme.Palette.ai.opacity(0.12))
                    .frame(width: 80, height: 80)
                Image(systemName: "sparkles")
                    .font(.system(size: 32, weight: .light))
                    .foregroundStyle(Theme.Palette.ai)
                    .shadow(color: Theme.Palette.ai.opacity(0.6), radius: 12)
            }
            Text("No threads yet")
                .font(Theme.FontStyle.sans(16, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
            Text("Tap the compose button to start one.")
                .font(Theme.FontStyle.sans(12))
                .foregroundStyle(Theme.Palette.fg2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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

private struct ThreadRow: View {
    let thread: ChatThread

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(thread.displayTitle)
                    .font(Theme.FontStyle.sans(14, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .lineLimit(1)
                Spacer()
                Text(thread.updatedAt, format: .dateTime.month(.abbreviated).day())
                    .font(Theme.FontStyle.mono(10.5))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            if let preview = thread.lastPreview {
                Text(preview)
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
                    .lineLimit(2)
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

#Preview {
    NavigationStack { ThreadListView() }
}
