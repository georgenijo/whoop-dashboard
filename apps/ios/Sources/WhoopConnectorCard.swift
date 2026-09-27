import SwiftUI

private let isoWithFractional: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

private let isoPlain: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

private let relativeFormatter: RelativeDateTimeFormatter = {
    let f = RelativeDateTimeFormatter()
    f.unitsStyle = .short
    return f
}()

struct WhoopConnectorCard: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase

    @State private var connector: WhoopConnector?
    @State private var loading = false
    @State private var loadError: String?
    @State private var reconnecting = false
    @State private var lastRefreshAt: Date?

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.Palette.brandStrain)
                .frame(width: 32, height: 32)
                .background(Theme.Palette.brandStrain.opacity(0.14), in: RoundedRectangle(cornerRadius: Theme.Radius.md))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: Theme.Spacing.xs) {
                    Text("Whoop")
                        .font(Theme.FontStyle.sans(15, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                    statusBadge
                }
                Text(detailText)
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: Theme.Spacing.xs)

            if connector?.status == .needsReconnect {
                Button(action: { Task { await handleReconnect() } }) {
                    Group {
                        if reconnecting {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Reconnect")
                                .font(Theme.FontStyle.sans(13, weight: .semibold))
                        }
                    }
                    .frame(minWidth: 84, minHeight: 36)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.Palette.brandStrain)
                .disabled(reconnecting)
                .frame(minHeight: 44)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .contain)
        .task { await refresh() }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { Task { await refresh() } }
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        if let status = connector?.status {
            HStack(spacing: 4) {
                Circle()
                    .fill(badgeColor(for: status))
                    .frame(width: 6, height: 6)
                    .shadow(color: badgeColor(for: status).opacity(0.7), radius: 3)
                Text(badgeLabel(for: status))
                    .font(Theme.FontStyle.sans(13, weight: .medium))
                    .foregroundStyle(badgeColor(for: status))
            }
        } else if loading {
            ProgressView().controlSize(.small)
        }
    }

    private var detailText: String {
        if let err = loadError { return err }
        guard let connector else { return "Loading…" }
        if let last = connector.lastSyncAt, let formatted = relative(from: last) {
            return "Last sync \(formatted)"
        }
        return "No sync yet"
    }

    private func badgeColor(for status: WhoopConnectorStatus) -> Color {
        switch status {
        case .connected: return Theme.Palette.success
        case .needsReconnect: return Theme.Palette.warning
        case .disconnected: return Theme.Palette.fg3
        }
    }

    private func badgeLabel(for status: WhoopConnectorStatus) -> String {
        switch status {
        case .connected: return "Connected"
        case .needsReconnect: return "Needs reconnect"
        case .disconnected: return "Disconnected"
        }
    }

    @MainActor
    private func handleReconnect() async {
        guard !reconnecting else { return }
        reconnecting = true
        defer { reconnecting = false }
        loadError = nil
        do {
            let service = WhoopConnectorService(api: api)
            let authorizeURL = try await service.startIosAuthorizeURL()
            let session = OAuthSession()
            let callback = try await session.start(
                authorizeURL: authorizeURL,
                callbackScheme: "coach"
            )
            handle(callback: callback)
        } catch OAuthSessionError.canceled {
            // User dismissed the in-app browser. No-op — leave existing state intact.
        } catch OAuthSessionError.failed(let message) {
            loadError = "Reconnect failed: \(message)"
        } catch {
            loadError = "Reconnect failed."
        }
        // Always re-fetch — the backend may have updated tokens even on a
        // surface-level "canceled" if the user completed Whoop's screen first.
        await refresh(force: true)
    }

    private func handle(callback url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return
        }
        let status = components.queryItems?.first { $0.name == "status" }?.value
        if status == "error" {
            let code = components.queryItems?.first { $0.name == "code" }?.value
            loadError = "Reconnect failed (\(code ?? "unknown"))."
        }
    }

    @MainActor
    private func refresh(force: Bool = false) async {
        if loading { return }
        // Debounce — `.task` and `scenePhase == .active` both fire when the
        // OAuth sheet dismisses. Without this, the connector endpoint sees
        // two back-to-back GETs.
        if !force, let last = lastRefreshAt, Date().timeIntervalSince(last) < 0.5 {
            return
        }
        loading = true
        defer {
            loading = false
            lastRefreshAt = Date()
        }
        do {
            let service = WhoopConnectorService(api: api)
            connector = try await service.fetch()
            loadError = nil
        } catch APIError.unauthorized {
            // APIClient.handleUnauthorized already posted .apiUnauthorized
            // and wiped the keychain; CoachApp will bounce to AuthView.
            // Surface a hint in case the unmount lags by a frame.
            loadError = "Sign in expired."
        } catch {
            loadError = "Couldn't load connector status."
        }
    }

    private func relative(from iso: String) -> String? {
        let date = isoWithFractional.date(from: iso) ?? isoPlain.date(from: iso)
        guard let date else { return nil }
        return relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}
