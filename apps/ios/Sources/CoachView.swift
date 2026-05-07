import SwiftUI

struct CoachView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "Coach",
                systemImage: "bubble.left.and.bubble.right.fill",
                description: Text("Chat with your data — coming in #198")
            )
            .navigationTitle("Coach")
        }
    }
}

#Preview {
    CoachView()
}
