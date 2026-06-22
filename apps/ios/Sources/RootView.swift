import SwiftUI

struct RootView: View {
    var onSignOut: () -> Void

    var body: some View {
        ZStack {
            AmbientAurora(intensity: .stealth)

            TabView {
                DashboardView()
                    .tabItem {
                        Label("Home", systemImage: "house.fill")
                    }

                TrendsView()
                    .tabItem {
                        Label("Trends", systemImage: "chart.xyaxis.line")
                    }

                CoachView()
                    .tabItem {
                        Label("Coach", systemImage: "sparkles")
                    }

                PlansView()
                    .tabItem {
                        Label("Plans", systemImage: "figure.strengthtraining.traditional")
                    }

                SettingsView(onSignOut: onSignOut)
                    .tabItem {
                        Label("Settings", systemImage: "gearshape.fill")
                    }
            }
            .tint(Theme.Palette.recovery)
        }
        .preferredColorScheme(.dark)
    }
}

#Preview {
    RootView(onSignOut: {})
}
