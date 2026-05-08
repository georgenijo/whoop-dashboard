import SwiftUI

struct SettingsView: View {
    var onSignOut: () -> Void

    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Version", value: versionString)
                }

                Section {
                    Button(role: .destructive) {
                        confirmingSignOut = true
                    } label: {
                        Text("Sign out")
                    }
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog(
                "Sign out of Coach?",
                isPresented: $confirmingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    KeychainStore.deleteSessionToken()
                    onSignOut()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You'll need to sign in with Apple again to use Coach.")
            }
        }
    }

    private var versionString: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String
        let build = info?["CFBundleVersion"] as? String
        switch (short, build) {
        case let (s?, b?): return "\(s) (\(b))"
        case let (s?, nil): return s
        default: return "—"
        }
    }
}

#Preview {
    SettingsView(onSignOut: {})
}
