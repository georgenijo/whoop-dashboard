import SwiftUI

struct SettingsView: View {
    var onSignOut: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Version", value: "0.1.0")
                }

                Section {
                    Button(role: .destructive) {
                        KeychainStore.deleteSessionToken()
                        onSignOut()
                    } label: {
                        Text("Sign out")
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView(onSignOut: {})
}
