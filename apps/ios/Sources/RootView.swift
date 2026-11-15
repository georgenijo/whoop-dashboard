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
        .tint(Theme.Palette.accent)
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
struct ActivityView: View {
    typealias Section = ActivityHeader.Section
    @State private var section: Section = .trends
    // Each segment keeps its own window: Trends reads recent days, Progress
    // needs enough months for the monthly chart to say anything.
    @State private var trendsRange: DateRange = .d30
    @State private var statsRange: DateRange = .d90
    @State private var trendsPath: [TrendsRoute] = []

    var body: some View {
        VStack(spacing: 0) {
            ActivityHeader(
                section: $section,
                range: section == .progress ? $statsRange : $trendsRange,
                showsRange: section == .progress || trendsPath.isEmpty
            )
            Group {
                switch section {
                case .trends: TrendsView(range: $trendsRange, path: $trendsPath)
                case .progress: StatsView(range: $statsRange)
                case .workouts: NavigationStack { WorkoutsView() }
                }
            }
        }
        .background(Theme.Palette.bg0)
        .measuresFold()
    }
}
