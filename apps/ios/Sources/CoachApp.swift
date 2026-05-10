import SwiftUI

@main
struct CoachApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

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

    var body: some Scene {
        WindowGroup {
            content
                .environment(\.api, api)
                .onReceive(NotificationCenter.default.publisher(for: .apiUnauthorized)) { _ in
                    isSignedIn = false
                }
                .onAppear {
                    if isSignedIn {
                        PushService.shared.requestAuthorizationIfNeeded()
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
                PushService.shared.requestAuthorizationIfNeeded()
            })
        }
    }
}
