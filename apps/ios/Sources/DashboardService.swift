import Foundation

struct DashboardService {
    let api: APIClient

    func today() async throws -> DashboardSummary {
        try await api.get("/api/dashboard/today")
    }
}
