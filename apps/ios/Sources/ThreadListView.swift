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
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        ChatView(threadId: nil, initialTitle: nil)
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
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
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("Retry") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        default:
            if threads.isEmpty {
                ContentUnavailableView(
                    "No threads yet",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Tap the compose button to start one.")
                )
            } else {
                List(threads) { thread in
                    NavigationLink {
                        ChatView(threadId: thread.id, initialTitle: thread.title)
                    } label: {
                        ThreadRow(thread: thread)
                    }
                }
                .listStyle(.plain)
            }
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

private struct ThreadRow: View {
    let thread: ChatThread

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(thread.displayTitle)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                Text(thread.updatedAt, format: .dateTime.month(.abbreviated).day())
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let preview = thread.lastPreview {
                Text(preview)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationStack { ThreadListView() }
}
