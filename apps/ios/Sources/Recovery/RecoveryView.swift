import SwiftUI

struct RecoveryView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("Recovery", systemImage: "heart.fill",
                                   description: Text("Coming soon"))
            .navigationTitle("Recovery")
        }
    }
}

#Preview {
    RecoveryView()
}
