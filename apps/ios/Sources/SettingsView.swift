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
            VStack(spacing: 0) {
                PageHeader("Settings")
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        section("Connections") {
                            WhoopConnectorCard()
                                .glassCard(padding: Theme.Spacing.md)
                        }

                        section("Data") {
                            VStack(alignment: .leading, spacing: 0) {
                                Button {
                                    triggerSync()
                                } label: {
                                    SettingsRow(icon: "arrow.triangle.2.circlepath", tint: Theme.Palette.recovery,
                                                title: "Sync Whoop now") {
                                        if isSyncing {
                                            ProgressView()
                                                .controlSize(.small)
                                                .tint(Theme.Palette.fg2)
                                        }
                                    }
                                }
                                .buttonStyle(PressableCardStyle())
                                .disabled(isSyncing)

                                if let line = statusLine {
                                    Text(line.text)
                                        .font(Theme.FontStyle.mono(11))
                                        .foregroundStyle(line.color)
                                        .padding(.leading, 44)
                                        .padding(.bottom, 4)
                                        .transition(.opacity)
                                }
                            }
                            .animation(.snappy, value: statusLine?.text)
                            .glassCard(padding: Theme.Spacing.md)
                        }

                        section("About") {
                            SettingsRow(icon: "info.circle", tint: Theme.Palette.fg2, title: "Version") {
                                Text(versionString)
                                    .font(Theme.FontStyle.mono(13))
                                    .foregroundStyle(Theme.Palette.fg3)
                            }
                            .accessibilityElement(children: .combine)
                            .glassCard(padding: Theme.Spacing.md)
                        }

                        Button(role: .destructive) {
                            confirmingSignOut = true
                        } label: {
                            SettingsRow(icon: "rectangle.portrait.and.arrow.right", tint: Theme.Palette.brandStrain,
                                        title: "Sign out", titleColor: Theme.Palette.brandStrain) {
                                EmptyView()
                            }
                            .glassCard(padding: Theme.Spacing.md)
                        }
                        .buttonStyle(PressableCardStyle())
                        .padding(.top, Theme.Spacing.lg)
                    }
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.bottom, Theme.Spacing.xxl)
                }
                .scrollIndicators(.hidden)
            }
            .toolbar(.hidden, for: .navigationBar)
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

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            CardLabel(title)
                .padding(.leading, 4)
            content()
        }
        .padding(.top, Theme.Spacing.xs)
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

private struct SettingsRow<Trailing: View>: View {
    let icon: String
    let tint: Color
    let title: String
    var titleColor: Color = Theme.Palette.fg1
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: Theme.Radius.md))
            Text(title)
                .font(Theme.FontStyle.sans(15, weight: .medium))
                .foregroundStyle(titleColor)
            Spacer(minLength: Theme.Spacing.xs)
            trailing()
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

#Preview {
    SettingsView(onSignOut: {})
        .preferredColorScheme(.dark)
}
