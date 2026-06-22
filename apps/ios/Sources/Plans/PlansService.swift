import Foundation

final class PlansService {
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load() async throws -> PlansResult {
        let response: PlansResponse = try await api.get("/api/plans")
        return PlansResult(plans: response.plans, recovery: response.recovery)
    }
}

struct PlansResult {
    let plans: [WorkoutPlan]
    let recovery: PlanRecovery?
}
