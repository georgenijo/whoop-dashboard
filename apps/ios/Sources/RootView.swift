import SwiftUI

struct RootView: View {
    var onSignOut: () -> Void
    @State private var selectedTab: AppTab

    private enum AppTab: String, Hashable {
        case home, trends, stats, coach, plans, settings
    }

    init(onSignOut: @escaping () -> Void) {
        self.onSignOut = onSignOut
        #if DEBUG
        let debugTab = ProcessInfo.processInfo.environment["COACH_DEBUG_TAB"]
            .flatMap(AppTab.init(rawValue:))
        _selectedTab = State(initialValue: debugTab ?? .home)
        #else
        _selectedTab = State(initialValue: .home)
        #endif
    }

    var body: some View {
        ZStack {
            AmbientAurora(intensity: .stealth)

            TabView(selection: $selectedTab) {
                DashboardView()
                    .tabItem {
                        Label("Home", systemImage: "house.fill")
                    }
                    .tag(AppTab.home)

                TrendsView()
                    .tabItem {
                        Label("Trends", systemImage: "chart.xyaxis.line")
                    }
                    .tag(AppTab.trends)

                StatsView()
                    .tabItem {
                        Label("Stats", systemImage: "chart.bar.fill")
                    }
                    .tag(AppTab.stats)

                CoachView()
                    .tabItem {
                        Label("Coach", systemImage: "sparkles")
                    }
                    .tag(AppTab.coach)

                PlansView()
                    .tabItem {
                        Label("Plans", systemImage: "figure.strengthtraining.traditional")
                    }
                    .tag(AppTab.plans)

                SettingsView(onSignOut: onSignOut)
                    .tabItem {
                        Label("Settings", systemImage: "gearshape.fill")
                    }
                    .tag(AppTab.settings)
            }
            .tint(Theme.Palette.brand)
        }
        .preferredColorScheme(.dark)
    }
}

#Preview {
    RootView(onSignOut: {})
}
