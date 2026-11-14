import SwiftUI

struct RootView: View {
    var onSignOut: () -> Void

    enum Tab: Hashable { case home, coach, activity, plans }
    @State private var tab: Tab = .home
    @State private var showsSettings = false
    @State private var navigation = AppNavigation()

    var body: some View {
        TabView(selection: $tab) {
            DashboardView(onOpenSettings: { showsSettings = true })
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag(Tab.home)
            CoachView()
                .tabItem { Label("Coach", systemImage: "bubble.left.and.bubble.right") }
                .tag(Tab.coach)
            ActivityView()
                .tabItem { Label("Activity", systemImage: "chart.xyaxis.line") }
                .tag(Tab.activity)
            PlansView()
                .tabItem { Label("Plans", systemImage: "figure.strengthtraining.traditional") }
                .tag(Tab.plans)
        }
        .environment(\.appNavigation, navigation)
        .tint(Theme.Palette.recovery)
        .background(Theme.Palette.bg0)
        .sheet(isPresented: $showsSettings) {
            SettingsView(onSignOut: {
                showsSettings = false
                onSignOut()
            })
        }
        .onReceive(NotificationCenter.default.publisher(for: .coachComposeRequested)) { note in
            navigation.composeRequest = CoachComposeRequest(draft: note.object as? String)
            tab = .coach
        }
    }
}

/// Each analytical destination is created only when selected. Visiting Today
/// should not fetch and render every historical chart in the background.
private struct ActivityView: View {
    enum Section: String, CaseIterable { case trends = "Trends", progress = "Progress", workouts = "Workouts" }
    @State private var section: Section = .trends

    var body: some View {
        VStack(spacing: 0) {
            Picker("Activity", selection: $section) {
                ForEach(Section.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.vertical, Theme.Spacing.xs)
            Group {
                switch section {
                case .trends: TrendsView()
                case .progress: StatsView()
                case .workouts: NavigationStack { WorkoutsView() }
                }
            }
        }
        .background(Theme.Palette.bg0)
    }
}
