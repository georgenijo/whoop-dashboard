import SwiftUI

struct RootView: View {
    var onSignOut: () -> Void

    var body: some View {
        TabView {
            DashboardView(onSignOut: onSignOut)
                .tabItem {
                    Label("Dashboard", systemImage: "chart.bar.fill")
                }

            RecoveryView()
                .tabItem {
                    Label("Recovery", systemImage: "heart.fill")
                }

            SleepView()
                .tabItem {
                    Label("Sleep", systemImage: "moon.fill")
                }

            StrainView()
                .tabItem {
                    Label("Strain", systemImage: "bolt.fill")
                }

            CoachView()
                .tabItem {
                    Label("Coach", systemImage: "bubble.left.and.bubble.right.fill")
                }
        }
    }
}

#Preview {
    RootView(onSignOut: {})
}
