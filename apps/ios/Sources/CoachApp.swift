import SwiftUI

@main
struct CoachApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    @Environment(\.scenePhase) private var scenePhase

    @State private var isSignedIn: Bool = {
        guard
            KeychainStore.loadSessionToken() != nil,
            let expiresAt = KeychainStore.loadSessionExpiresAt(),
            expiresAt > .now
        else {
            KeychainStore.deleteSessionToken()
            return false
        }
        return true
    }()

    private let api = APIClient()
    @State private var chatInFlight = ChatInFlightStore()
    @State private var wasBackgrounded = false

    init() {
        NSSetUncaughtExceptionHandler { exception in
            ClientLogger.shared.error(
                "uncaught: \(exception.name.rawValue)",
                details: [
                    "name": exception.name.rawValue,
                    "reason": exception.reason ?? "",
                    "stack": exception.callStackSymbols.joined(separator: "\n"),
                ]
            )
        }
    }

    var body: some Scene {
        WindowGroup {
            content
                .environment(\.api, api)
                .environment(\.chatInFlight, chatInFlight)
                .preferredColorScheme(.dark)
                .onReceive(NotificationCenter.default.publisher(for: .apiUnauthorized)) { _ in
                    isSignedIn = false
                }
                .onAppear {
                    if isSignedIn {
                        PushService.shared.requestAuthorizationIfNeeded()
                    }
                }
                .onChange(of: scenePhase) { _, newPhase in
                    switch newPhase {
                    case .active:
                        ClientLogger.shared.lifecycle("foreground")
                        if wasBackgrounded {
                            wasBackgrounded = false
                            let store = chatInFlight
                            let client = api
                            Task { await Self.reconcileInFlight(store: store, api: client) }
                        }
                    case .background:
                        wasBackgrounded = true
                        ClientLogger.shared.lifecycle("background")
                    default:
                        break
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isSignedIn {
            RootView(onSignOut: {
                isSignedIn = false
            })
        } else {
            AuthView(onSignedIn: {
                isSignedIn = true
                ClientLogger.shared.lifecycle("signin")
                PushService.shared.requestAuthorizationIfNeeded()
            })
        }
    }

    /// On foreground, reconcile every thread left mid-turn by a backgrounded or
    /// dropped send. A turn is terminal once the server has persisted an
    /// assistant reply as the last message; only then do we clear the in-flight
    /// marker and tell any live ChatView to refresh. Threads still running
    /// server-side stay marked and are retried on the next foreground, so a
    /// reply that lands while we were backgrounded is never lost. Owned here at
    /// app scope so recovery works regardless of which screen is mounted.
    @MainActor
    private static func reconcileInFlight(store: ChatInFlightStore, api: APIClient) async {
        let ids = store.inFlight
        for id in ids {
            do {
                let detail = try await ChatService(api: api).threadDetail(id: id)
                if detail.messages.last?.role == .assistant {
                    store.inFlight.remove(id)
                    NotificationCenter.default.post(name: .chatThreadNeedsRefresh, object: id)
                }
                // Else: turn still running server-side. Keep the marker; the
                // next foreground retries.
            } catch {
                // Transient (offline / 5xx). Keep the marker; retry next foreground.
            }
        }
    }
}
