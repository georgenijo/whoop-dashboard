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

    /// Mint an iOS-flow Whoop OAuth authorize URL for the signed-in user.
    /// The backend issues a signed `state` with `flow=ios` (5-min TTL); the
    /// callback skips the cookie-pair CSRF check and bounces to
    /// `coach://oauth-complete` when done.
    func startIosAuthorizeURL() async throws -> URL {
        struct Response: Decodable {
            let authorizeUrl: String
            enum CodingKeys: String, CodingKey {
                case authorizeUrl = "authorize_url"
            }
        }
        struct EmptyBody: Encodable {}
        let response: Response = try await api.post(
            "/api/auth/whoop/ios-start",
            body: EmptyBody()
        )
        guard let url = URL(string: response.authorizeUrl) else {
            throw APIError.badResponse
        }
        return url
    }
}
