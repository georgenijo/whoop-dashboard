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
                            for id in chatInFlight.inFlight {
                                NotificationCenter.default.post(
                                    name: .chatThreadNeedsRefresh,
                                    object: id
                                )
                            }
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
}
