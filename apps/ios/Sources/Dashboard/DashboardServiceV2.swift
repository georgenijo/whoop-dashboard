import Foundation

final class DashboardServiceV2 {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load(range: DateRange = .d30) async throws -> DashboardPayload {
        try await api.get(
            "/api/ios/dashboard",
            query: [URLQueryItem(name: "range", value: range.rawValue)]
        )
    }
}
