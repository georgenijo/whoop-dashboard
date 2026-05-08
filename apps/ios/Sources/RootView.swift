import SwiftUI

struct RootView: View {
    var onSignOut: () -> Void

    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "chart.bar.fill")
                }

            CoachView()
                .tabItem {
                    Label("Coach", systemImage: "bubble.left.and.bubble.right.fill")
                }

            SettingsView(onSignOut: onSignOut)
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }
}

#Preview {
    RootView(onSignOut: {})
}
