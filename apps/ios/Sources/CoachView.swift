import SwiftUI

struct CoachView: View {
    var body: some View {
        NavigationStack {
            debugContent
        }
    }

    @ViewBuilder
    private var debugContent: some View {
        #if DEBUG
        if
            let raw = ProcessInfo.processInfo.environment["COACH_DEBUG_THREAD_ID"],
            let threadID = Int(raw)
        {
            ChatView(threadId: threadID, initialTitle: "Preview thread")
        } else {
            ThreadListView()
        }
        #else
        ThreadListView()
        #endif
    }
}

#Preview {
    CoachView()
}
