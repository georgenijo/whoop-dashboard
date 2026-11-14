import SwiftUI

/// What the Coach tab is showing. On a regular width it fills the detail
/// column beside the thread list; on a compact width the collapsed split
/// view shows it in place of the list.
enum CoachSelection: Hashable {
    /// A fresh conversation. The id keeps the composer's state stable while
    /// the server assigns a thread on the first send.
    case new(id: UUID, draft: String?)
    case thread(id: Int, title: String?)
}

struct CoachView: View {
    @Environment(\.appNavigation) private var navigation
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var selection: CoachSelection?
    /// Which column a collapsed (compact) split view shows. Selecting a
    /// conversation moves it to the detail; the system Back moves it back.
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar
    /// Server thread ids assigned to conversations started in this session,
    /// so the list can highlight a new chat once it has been saved and a
    /// rebuilt chat view can resume the thread instead of starting over.
    @State private var createdThreads: [UUID: Int] = [:]
    /// The conversation shown in the detail column when nothing is selected.
    @State private var blankChat = UUID()

    /// One split view at every width. On iPhone Duo's inner display it shows
    /// the list beside the conversation; on a compact width the system
    /// collapses it to a stack. Keeping a single container (rather than
    /// switching between a split view and a stack on size class) keeps the
    /// conversation view, its draft, and its attachments alive while the
    /// device opens and closes.
    var body: some View {
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            ThreadListView(
                selection: openConversation,
                highlightedThreadId: sizeClass == .regular ? highlightedThreadId : nil
            )
            .background(Theme.Palette.bg1)
        } detail: {
            NavigationStack {
                chat(for: selection ?? .new(id: blankChat, draft: nil))
            }
        }
        .navigationSplitViewStyle(.balanced)
        .task { consumeComposeRequest() }
        .onChange(of: navigation.composeRequest) { _, _ in consumeComposeRequest() }
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
                // highlights it and a collapsed layout keeps showing it.
                selection = .new(id: blankChat, draft: nil)
                compactColumn = .detail
            }
        }
    }

    private func consumeComposeRequest() {
        guard let request = navigation.composeRequest else { return }
        selection = .new(id: request.id, draft: request.draft)
        compactColumn = .detail
        navigation.composeRequest = nil
    }

    /// Selection as the list sets it: every pick (including re-picking the
    /// current one on a phone) also brings the conversation forward.
    private var openConversation: Binding<CoachSelection?> {
        Binding(
            get: { selection },
            set: { newValue in
                selection = newValue
                if newValue != nil { compactColumn = .detail }
            }
        )
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
            ChatView(threadId: createdThreads[id], initialTitle: nil, initialDraft: draft, conversation: id,
                     onComposerInteraction: { compactColumn = .detail })
                .id(id)
        case .thread(let id, let title):
            ChatView(threadId: id, initialTitle: title, onComposerInteraction: { compactColumn = .detail })
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
