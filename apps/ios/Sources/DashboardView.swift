import SwiftUI

struct DashboardView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "Dashboard",
                systemImage: "chart.bar.fill",
                description: Text("Today's recovery, sleep, and strain — coming in #197")
            )
            .navigationTitle("Today")
        }
    }
}

#Preview {
    DashboardView()
}
