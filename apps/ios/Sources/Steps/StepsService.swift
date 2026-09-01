import Foundation

final class StepsService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load(range: DateRange) async throws -> StepsPayload {
        try await api.get(
            "/api/ios/steps",
            query: [URLQueryItem(name: "range", value: range.rawValue)]
        )
    }
}
