import Foundation

final class StrainService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load(range: DateRange) async throws -> StrainPayload {
        try await api.get(
            "/api/ios/strain",
            query: [URLQueryItem(name: "range", value: range.rawValue)]
        )
    }
}
