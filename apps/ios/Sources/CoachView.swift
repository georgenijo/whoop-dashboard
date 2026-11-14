import SwiftUI

/// What the Coach tab is showing. One value drives both layouts, so opening
/// or closing iPhone Duo keeps the same conversation on screen: on a compact
/// width a non-nil selection is pushed over the thread list; on a regular
/// width it fills the detail column beside the list.
enum CoachSelection: Hashable {
    /// A fresh conversation. The id keeps the composer's state stable while
    /// the server assigns a thread on the first send.
    case new(id: UUID, draft: String?)
    case thread(id: Int, title: String?)
}

struct CoachView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var selection: CoachSelection?
    /// Server thread ids assigned to conversations started in this session,
    /// so the list can highlight a new chat once it has been saved.
    @State private var createdThreads: [UUID: Int] = [:]
    /// The conversation shown in the detail column when nothing is selected.
    @State private var blankChat = UUID()

    var body: some View {
        Group {
            if sizeClass == .regular {
                NavigationSplitView {
                    ThreadListView(selection: $selection, highlightedThreadId: highlightedThreadId)
                        .background(Theme.Palette.bg1)
                } detail: {
                    NavigationStack {
                        chat(for: selection ?? .new(id: blankChat, draft: nil))
                    }
                }
                .navigationSplitViewStyle(.balanced)
            } else {
                NavigationStack {
                    ThreadListView(selection: $selection, highlightedThreadId: nil)
                        .navigationDestination(item: $selection) { chat(for: $0) }
                }
            }
        }
        .onChange(of: selection) { old, new in
            // Once the blank conversation has been used and left, the next
            // empty detail column must be a genuinely new chat.
            if case .new(let id, _) = old, id == blankChat, new != old {
                blankChat = UUID()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .chatThreadCreated)) { note in
            guard let created = note.object as? ChatThreadCreated else { return }
            createdThreads[created.conversation] = created.threadId
            if selection == nil, created.conversation == blankChat {
                // The blank chat now has a thread: select it so the list
                // highlights it, and keep the same view identity.
                selection = .new(id: blankChat, draft: nil)
            }
        }
    }

    private var highlightedThreadId: Int? {
        switch selection {
        case .thread(let id, _): return id
        case .new(let id, _): return createdThreads[id]
        case nil: return createdThreads[blankChat]
        }
    }

    @ViewBuilder
    private func chat(for selection: CoachSelection) -> some View {
        switch selection {
        case .new(let id, let draft):
            ChatView(threadId: nil, initialTitle: nil, initialDraft: draft, conversation: id)
                .id(id)
        case .thread(let id, let title):
            ChatView(threadId: id, initialTitle: title)
                .id(id)
        }
    }
}

/// Posted by ChatView when the server assigns a thread to a new conversation.
struct ChatThreadCreated {
    let conversation: UUID
    let threadId: Int
}

#Preview {
    CoachView()
}
