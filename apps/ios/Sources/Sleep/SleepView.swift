import SwiftUI

struct SleepView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("Sleep", systemImage: "moon.fill",
                                   description: Text("Coming soon"))
            .navigationTitle("Sleep")
        }
    }
}

#Preview {
    SleepView()
}
