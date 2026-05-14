import SwiftUI

struct WhoopConnectorCard: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase

    @State private var connector: WhoopConnector?
    @State private var loading = false
    @State private var loadError: String?
    @State private var safariURL: IdentifiedURL?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Whoop")
                    .font(.body)
                    .fontWeight(.medium)
                statusBadge
                Spacer()
                if connector?.status == .needsReconnect {
                    Button("Reconnect", action: handleReconnect)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                }
            }

            Text(detailText)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .task { await refresh() }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { Task { await refresh() } }
        }
        .sheet(item: $safariURL) { wrapper in
            SafariView(url: wrapper.url) {
                Task { await refresh() }
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        if let status = connector?.status {
            HStack(spacing: 4) {
                Circle()
                    .fill(badgeColor(for: status))
                    .frame(width: 7, height: 7)
                Text(badgeLabel(for: status))
                    .font(.caption)
                    .foregroundStyle(badgeColor(for: status))
            }
        } else if loading {
            ProgressView().controlSize(.small)
        }
    }

    private var detailText: String {
        if let err = loadError { return err }
        guard let connector else { return "Loading…" }
        var parts: [String] = []
        if let last = connector.lastSyncAt, let formatted = relative(from: last) {
            parts.append("Last sync \(formatted)")
        } else {
            parts.append("No sync yet")
        }
        return parts.joined(separator: " · ")
    }

    private func badgeColor(for status: WhoopConnectorStatus) -> Color {
        switch status {
        case .connected: return .green
        case .needsReconnect: return .orange
        case .disconnected: return .secondary
        }
    }

    private func badgeLabel(for status: WhoopConnectorStatus) -> String {
        switch status {
        case .connected: return "Connected"
        case .needsReconnect: return "Needs reconnect"
        case .disconnected: return "Disconnected"
        }
    }

    private func handleReconnect() {
        let url = api.baseURL.appending(path: "api/auth/login")
        safariURL = IdentifiedURL(url: url)
    }

    @MainActor
    private func refresh() async {
        if loading { return }
        loading = true
        defer { loading = false }
        do {
            let service = WhoopConnectorService(api: api)
            connector = try await service.fetch()
            loadError = nil
        } catch APIError.unauthorized {
            loadError = nil
        } catch {
            loadError = "Couldn't load connector status."
        }
    }

    private func relative(from iso: String) -> String? {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = isoFormatter.date(from: iso) ?? {
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            return plain.date(from: iso)
        }()
        guard let date else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

private struct IdentifiedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

#Preview {
    WhoopConnectorCard()
}
