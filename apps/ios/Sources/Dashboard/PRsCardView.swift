import SwiftUI

struct PRsCardView: View {
    let prs: DashboardPayload.PRs

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("PERSONAL RECORDS")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
                .padding(.bottom, 4)

            if let bestHrv = prs.bestHrv {
                PRRow(icon: "waveform.path.ecg", iconTint: Theme.Palette.hrv, label: "Best HRV",
                      value: "\(Int(bestHrv.value.rounded())) ms", detail: bestHrv.date)
            }
            if let lowestRhr = prs.lowestRhr {
                PRRow(icon: "heart.fill", iconTint: Theme.Palette.rhr, label: "Lowest RHR",
                      value: "\(Int(lowestRhr.value.rounded())) bpm", detail: lowestRhr.date)
            }
            if let recoveryStreak = prs.recoveryStreak {
                PRRow(icon: "flame.fill", iconTint: Theme.Palette.recovery, label: "Recovery streak (≥67%)",
                      value: "\(recoveryStreak.count) days",
                      detail: "\(recoveryStreak.startDate) → \(recoveryStreak.endDate)")
            }
            if let sleepStreak = prs.sleepPerfStreak {
                PRRow(icon: "moon.fill", iconTint: Theme.Palette.sleepDeep, label: "Sleep perf streak (≥85%)",
                      value: "\(sleepStreak.count) days",
                      detail: "\(sleepStreak.startDate) → \(sleepStreak.endDate)")
            }
            if let logStreak = prs.loggingStreak {
                PRRow(icon: "calendar", iconTint: Theme.Palette.fg2, label: "Logging streak",
                      value: "\(logStreak.count) days",
                      detail: "\(logStreak.startDate) → \(logStreak.endDate)")
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

private struct PRRow: View {
    let icon: String
    let iconTint: Color
    let label: String
    let value: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(iconTint.opacity(0.14))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(iconTint.opacity(0.25), lineWidth: 1)
                    )
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(iconTint)
            }
            .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg1)
                Text(detail)
                    .font(Theme.FontStyle.mono(10))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            Spacer()
            Text(value)
                .font(Theme.FontStyle.display(15, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .monospacedDigit()
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Theme.Palette.borderSubtle)
                .frame(height: 1)
        }
    }
}
