import Foundation

final class PlansService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load() async throws -> [WorkoutPlan] {
        let response: PlansResponse = try await api.get("/api/plans")
        return response.plans
    }
}
