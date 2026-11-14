import SwiftUI

extension Notification.Name {
    /// Opens a new Coach draft. Posting never sends a message automatically.
    static let coachComposeRequested = Notification.Name("com.georgenijo.coach.composeRequested")
}

struct CoachComposeRequest: Equatable {
    let id = UUID()
    let draft: String?
}

/// Keeps a compose request until the lazily created Coach tab can consume it.
/// A transient notification alone can arrive before that tab is mounted.
@MainActor
@Observable
final class AppNavigation {
    var composeRequest: CoachComposeRequest?
    nonisolated init() {}
}

private struct AppNavigationKey: EnvironmentKey {
    static let defaultValue = AppNavigation()
}

extension EnvironmentValues {
    var appNavigation: AppNavigation {
        get { self[AppNavigationKey.self] }
        set { self[AppNavigationKey.self] = newValue }
    }
}
