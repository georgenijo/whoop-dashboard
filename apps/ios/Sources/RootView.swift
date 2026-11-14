import SwiftUI

struct RootView: View {
    var onSignOut: () -> Void

    enum Tab: Hashable {
        case home, trends, stats, coach, plans, settings
    }

    /// Bound explicitly: an unbound TabView re-resolves its selection when
    /// iPhone Duo moves the app between displays, which dropped people back
    /// on Home every time they opened or closed the device.
    @State private var tab: Tab = .home

    var body: some View {
        ZStack {
            AmbientAurora(intensity: .stealth)

            TabView(selection: $tab) {
                DashboardView()
                    .tabItem {
                        Label("Home", systemImage: "house.fill")
                    }
                    .tag(Tab.home)

                TrendsView()
                    .tabItem {
                        Label("Trends", systemImage: "chart.xyaxis.line")
                    }
                    .tag(Tab.trends)

                StatsView()
                    .tabItem {
                        Label("Stats", systemImage: "chart.bar.fill")
                    }
                    .tag(Tab.stats)

                CoachView()
                    .tabItem {
                        Label("Coach", systemImage: "sparkles")
                    }
                    .tag(Tab.coach)

                PlansView()
                    .tabItem {
                        Label("Plans", systemImage: "figure.strengthtraining.traditional")
                    }
                    .tag(Tab.plans)

                SettingsView(onSignOut: onSignOut)
                    .tabItem {
                        Label("Settings", systemImage: "gearshape.fill")
                    }
                    .tag(Tab.settings)
            }
            .tint(Theme.Palette.recovery)
        }
        .preferredColorScheme(.dark)
    }
}

#Preview {
    RootView(onSignOut: {})
}
