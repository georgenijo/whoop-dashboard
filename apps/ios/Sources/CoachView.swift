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

/// Where the Coach list pane and the conversation pane sit on a regular
/// width. The list fills the area left of the fold and the conversation the
/// area right of it, so no answer column ever crosses the crease. The split
/// is held open (the sidebar cannot be hidden) whenever the display reports a
/// fold; hiding it would stretch the conversation across the hinge.
struct CoachPaneLayout: Equatable {
    /// Width of the list column, ending where the fold band ends.
    var sidebarWidth: CGFloat
    /// Space kept clear at the trailing edge of the list so rows stop at the
    /// fold band instead of running into it.
    var listTrailingInset: CGFloat
    /// True when the layout is anchored to a real fold.
    var pinsSidebar: Bool

    static let minimumPane: CGFloat = 300

    static func compute(fold: FoldGeometry, regular: Bool) -> CoachPaneLayout? {
        guard regular, fold.width > 0 else { return nil }
        if let hinge = fold.hinge,
           hinge.lowerBound >= minimumPane,
           fold.width - hinge.upperBound >= minimumPane {
            return CoachPaneLayout(
                sidebarWidth: hinge.upperBound,
                listTrailingInset: hinge.upperBound - hinge.lowerBound,
                pinsSidebar: true
            )
        }
        let width = min(max(fold.width * 0.4, 320), 420)
        guard fold.width - width >= minimumPane else { return nil }
        return CoachPaneLayout(sidebarWidth: width, listTrailingInset: 0, pinsSidebar: false)
    }
}

struct CoachView: View {
    @Environment(\.appNavigation) private var navigation
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var columnVisibility: NavigationSplitViewVisibility = .automatic
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
        CoachSplit(
            selection: $selection,
            compactColumn: $compactColumn,
            columnVisibility: $columnVisibility,
            openConversation: openConversation,
            highlightedThreadId: highlightedThreadId,
            blankChat: blankChat,
            chat: { chat(for: $0) },
            newChat: { selection = .new(id: UUID(), draft: nil); compactColumn = .detail }
        )
        .measuresFold()
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

/// Split container, separate from CoachView so the fold measurement wrapped
/// around it is visible to the columns through the environment.
private struct CoachSplit<Chat: View>: View {
    @Binding var selection: CoachSelection?
    @Binding var compactColumn: NavigationSplitViewColumn
    @Binding var columnVisibility: NavigationSplitViewVisibility
    let openConversation: Binding<CoachSelection?>
    let highlightedThreadId: Int?
    let blankChat: UUID
    let chat: (CoachSelection) -> Chat
    let newChat: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.foldGeometry) private var fold

    private var layout: CoachPaneLayout? {
        CoachPaneLayout.compute(fold: fold, regular: sizeClass == .regular)
    }

    private var visibility: Binding<NavigationSplitViewVisibility> {
        guard layout?.pinsSidebar == true else { return $columnVisibility }
        return Binding(get: { .all }, set: { _ in })
    }

    var body: some View {
        NavigationSplitView(columnVisibility: visibility, preferredCompactColumn: $compactColumn) {
            ThreadListView(
                selection: openConversation,
                highlightedThreadId: sizeClass == .regular ? highlightedThreadId : nil
            )
            .background(Theme.Palette.bg1)
            .modifier(SidebarWidth(layout: layout))
        } detail: {
            NavigationStack {
                chat(selection ?? .new(id: blankChat, draft: nil))
                    .toolbar {
                        if sizeClass == .compact {
                            ToolbarItem(placement: .primaryAction) {
                                Button(action: newChat) {
                                    Label("New chat", systemImage: "square.and.pencil")
                                }
                                .tint(Theme.Palette.accent)
                            }
                        }
                    }
                    .modifier(HidesSidebarToggle(hidden: layout?.pinsSidebar == true))
            }
        }
        .navigationSplitViewStyle(.balanced)
    }
}

private struct SidebarWidth: ViewModifier {
    let layout: CoachPaneLayout?

    func body(content: Content) -> some View {
        if let layout {
            content.navigationSplitViewColumnWidth(layout.sidebarWidth)
        } else {
            content.navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 420)
        }
    }
}

private struct HidesSidebarToggle: ViewModifier {
    let hidden: Bool

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.toolbar(removing: hidden ? .sidebarToggle : nil)
        } else {
            content
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
