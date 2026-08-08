import SwiftUI

struct SettingsView: View {
    var onSignOut: () -> Void

    @Environment(\.api) private var api

    @State private var confirmingSignOut = false
    @State private var isSyncing = false
    @State private var syncStatus: SyncStatus?
    @State private var clearTask: Task<Void, Never>?

    enum SyncStatus {
        case ok(r: Int, s: Int, w: Int, ms: Int)
        case skipped(at: Date)
        case error
    }

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
                    VStack(alignment: .leading, spacing: 6) {
                        Button {
                            triggerSync()
                        } label: {
                            HStack {
                                Text("Sync Whoop now")
                                    .font(Theme.FontStyle.sans(13, weight: .medium))
                                    .foregroundStyle(Theme.Palette.fg1)
                                Spacer()
                                if isSyncing {
                                    ProgressView()
                                        .controlSize(.small)
                                        .tint(Theme.Palette.fg2)
                                }
                            }
                        }
                        .disabled(isSyncing)

                        if let line = statusLine {
                            Text(line.text)
                                .font(Theme.FontStyle.sans(11))
                                .foregroundStyle(line.color)
                        }
                    }
                    .listRowBackground(rowBackground)
                } header: {
                    Text("DATA")
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
            .background(Theme.Palette.bg)
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

    private func triggerSync() {
        clearTask?.cancel()
        clearTask = nil
        syncStatus = nil
        isSyncing = true

        Task {
            do {
                let resp = try await api.postSync()
                let status: SyncStatus
                let logStatus: String
                if resp.skipped == true {
                    status = .skipped(at: resp.lastSyncAt ?? Date())
                    logStatus = "skipped"
                } else if resp.ok {
                    status = .ok(
                        r: resp.recovery ?? 0,
                        s: resp.sleep ?? 0,
                        w: resp.workouts ?? 0,
                        ms: resp.durationMs ?? 0
                    )
                    logStatus = "ok"
                } else {
                    status = .error
                    logStatus = "error"
                }
                await MainActor.run {
                    syncStatus = status
                    isSyncing = false
                    scheduleClear()
                }
                ClientLogger.shared.lifecycle("sync_manual_ios", details: ["status": logStatus])
            } catch {
                await MainActor.run {
                    syncStatus = .error
                    isSyncing = false
                    scheduleClear()
                }
                ClientLogger.shared.lifecycle("sync_manual_ios", details: ["status": "error"])
            }
        }
    }

    private func scheduleClear() {
        clearTask = Task {
            try? await Task.sleep(for: .seconds(8))
            if Task.isCancelled { return }
            await MainActor.run {
                syncStatus = nil
            }
        }
    }

    private var statusLine: (text: String, color: Color)? {
        guard let status = syncStatus else { return nil }
        switch status {
        case let .ok(r, s, w, ms):
            let seconds = String(format: "%.1f", Double(ms) / 1000)
            return ("Synced \u{2022} R\(r) S\(s) W\(w) \u{2022} \(seconds)s", Theme.Palette.fg3)
        case let .skipped(at):
            return ("Already synced \(Self.timeFormatter.string(from: at))", Theme.Palette.fg3)
        case .error:
            return ("Sync failed", Theme.Palette.brandStrain)
        }
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()

    @ViewBuilder
    private var rowBackground: some View {
        Theme.Palette.bgLift
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
