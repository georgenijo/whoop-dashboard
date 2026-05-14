import Foundation

enum WhoopConnectorStatus: String, Decodable {
    case connected
    case needsReconnect = "needs_reconnect"
    case disconnected
}

struct WhoopConnector: Decodable {
    let provider: String
    let status: WhoopConnectorStatus
    let expiresAt: String?
    let scope: String?
    let source: String?
    let lastSyncAt: String?

    enum CodingKeys: String, CodingKey {
        case provider
        case status
        case expiresAt = "expires_at"
        case scope
        case source
        case lastSyncAt = "last_sync_at"
    }
}

struct WhoopConnectorService {
    let api: APIClient

    func fetch() async throws -> WhoopConnector {
        try await api.get("/api/connectors/whoop")
    }
}
