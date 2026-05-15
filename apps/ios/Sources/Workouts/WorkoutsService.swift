import Foundation

final class WorkoutsService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load(range: DateRange) async throws -> WorkoutsPayload {
        try await api.get(
            "/api/ios/workouts",
            query: [URLQueryItem(name: "range", value: range.rawValue)]
        )
    }
}
