import Foundation

final class SleepService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load(range: DateRange) async throws -> SleepPayload {
        try await api.get(
            "/api/ios/sleep",
            query: [URLQueryItem(name: "range", value: range.rawValue)]
        )
    }
}
