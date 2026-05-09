import Foundation

struct DashboardService {
    let api: APIClient

    func today() async throws -> DashboardSummary {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        let localDate = formatter.string(from: Date())
        return try await api.get(
            "/api/dashboard/today",
            query: [URLQueryItem(name: "date", value: localDate)]
        )
    }
}
