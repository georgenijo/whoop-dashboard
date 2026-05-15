import SwiftUI

struct PRsCardView: View {
    let prs: DashboardPayload.PRs

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Personal Records")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let bestHrv = prs.bestHrv {
                PRRow(icon: "waveform.path.ecg", label: "Best HRV",
                      value: "\(Int(bestHrv.value.rounded())) ms",
                      detail: bestHrv.date)
            }
            if let lowestRhr = prs.lowestRhr {
                PRRow(icon: "heart.fill", label: "Lowest RHR",
                      value: "\(Int(lowestRhr.value.rounded())) bpm",
                      detail: lowestRhr.date)
            }
            if let recoveryStreak = prs.recoveryStreak {
                PRRow(icon: "flame.fill", label: "Recovery streak (≥67%)",
                      value: "\(recoveryStreak.count) days",
                      detail: "\(recoveryStreak.startDate) → \(recoveryStreak.endDate)")
            }
            if let sleepStreak = prs.sleepPerfStreak {
                PRRow(icon: "moon.fill", label: "Sleep perf streak (≥85%)",
                      value: "\(sleepStreak.count) days",
                      detail: "\(sleepStreak.startDate) → \(sleepStreak.endDate)")
            }
            if let logStreak = prs.loggingStreak {
                PRRow(icon: "calendar", label: "Logging streak",
                      value: "\(logStreak.count) days",
                      detail: "\(logStreak.startDate) → \(logStreak.endDate)")
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct PRRow: View {
    let icon: String
    let label: String
    let value: String
    let detail: String

    var body: some View {
        HStack {
            Image(systemName: icon)
                .foregroundStyle(.tint)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.subheadline)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
        }
    }
}
