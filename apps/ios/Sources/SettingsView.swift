import SwiftUI

struct SettingsView: View {
    var onSignOut: () -> Void

    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    WhoopConnectorCard()
                        .listRowBackground(rowBackground)
                } header: {
                    Text("CONNECTORS")
                        .font(Theme.FontStyle.sans(10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg2)
                }

                Section {
                    HStack {
                        Text("Version")
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg1)
                        Spacer()
                        Text(versionString)
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    .listRowBackground(rowBackground)
                }

                Section {
                    Button(role: .destructive) {
                        confirmingSignOut = true
                    } label: {
                        Text("Sign out")
                            .font(Theme.FontStyle.sans(13, weight: .medium))
                            .foregroundStyle(Theme.Palette.brandStrain)
                    }
                    .listRowBackground(rowBackground)
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .confirmationDialog(
                "Sign out of Coach?",
                isPresented: $confirmingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    ClientLogger.shared.lifecycle("signout")
                    KeychainStore.deleteSessionToken()
                    onSignOut()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You'll need to sign in with Apple again to use Coach.")
            }
        }
    }

    @ViewBuilder
    private var rowBackground: some View {
        LinearGradient(
            colors: [Color.white.opacity(0.04), Color.white.opacity(0.01)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
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
