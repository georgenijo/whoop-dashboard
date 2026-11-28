import Foundation

/// Deep-link targets a tapped push can carry in its top-level `route` key.
///
/// The server sets `route` next to `aps` (see
/// `apps/web/src/lib/whoop/reauth-push.ts`). Unknown or missing routes
/// parse to `nil` so a tap just opens the app where it was.
enum PushRoute: Equatable, Sendable {
    /// Whoop's refresh chain died (#287). Opens Settings, where
    /// `WhoopConnectorCard` shows the "Reconnect Whoop" button.
    case whoopReconnect

    init?(userInfo: [AnyHashable: Any]) {
        guard let raw = userInfo["route"] as? String else { return nil }
        switch raw {
        case "settings/connectors": self = .whoopReconnect
        default: return nil
        }
    }
}

extension Notification.Name {
    /// Posted on the main actor when the user taps a push carrying a known
    /// route. `object` is the `PushRoute`.
    static let pushRouteRequested = Notification.Name(
        "com.georgenijo.coach.pushRouteRequested"
    )
}

/// Holds a tapped route until `RootView` is on screen to act on it.
///
/// A tap that cold-launches the app reaches the notification delegate before
/// `RootView` has subscribed (or before sign-in finishes), so a bare
/// `NotificationCenter` post would be lost. `RootView` drains `pending` on
/// appear and clears it whenever it handles a live post.
@MainActor
final class PushRouter {
    static let shared = PushRouter()

    private(set) var pending: PushRoute?

    /// Parse `userInfo` off the main actor (it isn't Sendable) and pass the
    /// resulting route here.
    func handle(_ route: PushRoute) {
        pending = route
        NotificationCenter.default.post(name: .pushRouteRequested, object: route)
    }

    /// Returns and clears the waiting route, if any.
    func consume() -> PushRoute? {
        defer { pending = nil }
        return pending
    }
}
