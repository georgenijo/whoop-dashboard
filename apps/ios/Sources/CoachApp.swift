import SwiftUI

@main
struct CoachApp: App {
    @State private var isSignedIn: Bool = KeychainStore.loadSessionToken() != nil

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
