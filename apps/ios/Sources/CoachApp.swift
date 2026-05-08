import SwiftUI

@main
struct CoachApp: App {
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

    var body: some Scene {
        WindowGroup {
            if isSignedIn {
                RootView(onSignOut: {
                    isSignedIn = false
                })
            } else {
                AuthView(onSignedIn: {
                    isSignedIn = true
                })
            }
        }
    }
}
