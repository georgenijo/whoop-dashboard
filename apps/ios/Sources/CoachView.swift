import SwiftUI

struct CoachView: View {
    var body: some View {
        NavigationStack {
            ThreadListView()
                .navigationTitle("Coach")
        }
    }
}

#Preview {
    CoachView()
}
