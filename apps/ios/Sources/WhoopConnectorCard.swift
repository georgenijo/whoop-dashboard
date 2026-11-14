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
    @State private var operationMessage: String?
    @State private var loadError: String?
    @State private var reconnecting = false
    @State private var lastRefreshAt: Date?
    @State private var confirmingDisconnect = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                Image(systemName: "waveform.path.ecg")
                    .font(.title3)
                    .foregroundStyle(Theme.Palette.recovery)
                    .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 6) {
                    name
                    statusBadge
                    Text(detailText)
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            if let status = connector?.status {
                if status != .connected {
                    Button(status == .disconnected ? "Connect Whoop" : "Reconnect Whoop") {
                        Task { await handleReconnect() }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .buttonStyle(.bordered)
                    .tint(Theme.Palette.recovery)
                    .disabled(reconnecting)
                } else {
                    Button("Disconnect Whoop", role: .destructive) { confirmingDisconnect = true }
                        .frame(minHeight: 44)
                        .disabled(reconnecting)
                }
            } else if loadError != nil {
                Button("Retry") { Task { await refresh(force: true) } }
                    .frame(minHeight: 44)
            }
            if reconnecting { ProgressView("Updating connection…") }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .confirmationDialog("Disconnect Whoop?", isPresented: $confirmingDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { Task { await disconnect() } }
        } message: {
            Text("New Whoop data will stop syncing. Your saved history stays in Coach.")
        }
        .accessibilityElement(children: .contain)
        .task { await refresh() }
        .onReceive(NotificationCenter.default.publisher(for: .coachDataDidSync)) { _ in
            Task { await refresh(force: true) }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { Task { await refresh() } }
        }
    }

    private var name: some View {
        Text("Whoop")
            .font(Theme.FontStyle.sans(15, weight: .medium))
            .foregroundStyle(Theme.Palette.fg0)
    }

    @ViewBuilder
    private var statusBadge: some View {
        if let status = connector?.status {
            HStack(spacing: 4) {
                Circle()
                    .fill(badgeColor(for: status))
                    .frame(width: 6, height: 6)
                Text(badgeLabel(for: status))
                    .font(Theme.FontStyle.sans(13, weight: .medium))
                    .foregroundStyle(badgeColor(for: status))
            }
        } else if loading {
            ProgressView().controlSize(.small)
        }
    }

    private var detailText: String {
        if let operationMessage { return operationMessage }
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
        case .needsReconnect: return "Reconnect needed"
        case .disconnected: return "Disconnected"
        }
    }

    @MainActor
    private func disconnect() async {
        guard !reconnecting else { return }
        reconnecting = true
        operationMessage = nil
        defer { reconnecting = false }
        do {
            struct Body: Encodable {}
            struct Result: Decodable { let ok: Bool; let dbRemoved: Bool; let revoked: Bool?
                enum CodingKeys: String, CodingKey { case ok, revoked; case dbRemoved = "db_removed" }
            }
            let result: Result = try await api.post("/api/auth/whoop/disconnect", body: Body())
            guard result.ok else { throw APIError.badResponse }
            await refresh(force: true)
            if connector?.status != .disconnected {
                operationMessage = "Couldn’t remove the connection. Please try again."
            } else if result.revoked != true {
                operationMessage = "Disconnected locally. Whoop could not confirm revocation; you can also revoke access in Whoop."
            }
            NotificationCenter.default.post(name: .coachDataDidSync, object: nil)
        } catch {
            operationMessage = "Couldn’t disconnect. Please try again."
        }
    }

    @MainActor
    private func handleReconnect() async {
        guard !reconnecting else { return }
        reconnecting = true
        operationMessage = nil
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
            operationMessage = "Reconnect failed: \(message)"
        } catch {
            operationMessage = "Reconnect failed."
        }
        // Always re-fetch — the backend may have updated tokens even on a
        // surface-level "canceled" if the user completed Whoop's screen first.
        await refresh(force: true)
        NotificationCenter.default.post(name: .coachDataDidSync, object: nil)
    }

    private func handle(callback url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return
        }
        let status = components.queryItems?.first { $0.name == "status" }?.value
        if status == "error" {
            let code = components.queryItems?.first { $0.name == "code" }?.value
            operationMessage = "Reconnect failed (\(code ?? "unknown"))."
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
