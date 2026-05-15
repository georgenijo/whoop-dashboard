import Foundation

final class RecoveryService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load(range: DateRange) async throws -> RecoveryPayload {
        try await api.get(
            "/api/ios/recovery",
            query: [URLQueryItem(name: "range", value: range.rawValue)]
        )
    }
}
