import Foundation

final class StatsService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load(range: DateRange) async throws -> StatsPayload {
        try await api.get(
            "/api/ios/stats",
            query: [URLQueryItem(name: "range", value: range.rawValue)]
        )
    }
}
