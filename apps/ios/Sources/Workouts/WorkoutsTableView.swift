import SwiftUI

struct WorkoutsTableView: View {
    let workouts: [WorkoutsPayload.WorkoutRow]
    @State private var expandedId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("ALL WORKOUTS")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
                .padding(.bottom, 8)
            if workouts.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "figure.walk")
                        .font(.title2)
                        .foregroundStyle(Theme.Palette.fg3)
                    Text("No workouts in range")
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg1)
                    Text("Adjust the date range or sync Whoop.")
                        .font(Theme.FontStyle.sans(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                .frame(maxWidth: .infinity, minHeight: 140)
            } else {
                VStack(spacing: 0) {
                    ForEach(workouts) { workout in
                        WorkoutRow(workout: workout, isExpanded: expandedId == workout.id) {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                expandedId = expandedId == workout.id ? nil : workout.id
                            }
                        }
                        if workout.id != workouts.last?.id {
                            Rectangle()
                                .fill(Theme.Palette.borderSubtle)
                                .frame(height: 1)
                        }
                    }
                }
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

private struct WorkoutRow: View {
    let workout: WorkoutsPayload.WorkoutRow
    let isExpanded: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(workout.sport ?? "Workout")
                            .font(Theme.FontStyle.sans(13.5, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        Text(workout.date)
                            .font(Theme.FontStyle.mono(10.5))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    Spacer()
                    if let strain = workout.strain {
                        Text(String(format: "%.1f", strain))
                            .font(Theme.FontStyle.display(16, weight: .medium))
                            .foregroundStyle(Theme.Palette.strain)
                            .monospacedDigit()
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                if isExpanded {
                    HStack(spacing: 10) {
                        DetailColumn(label: "DURATION", value: formatDuration(workout.durationSec))
                        DetailColumn(label: "AVG HR", value: workout.avgHr.map { "\(Int($0.rounded())) bpm" } ?? "—")
                        DetailColumn(label: "MAX HR", value: workout.maxHr.map { "\(Int($0.rounded())) bpm" } ?? "—")
                        DetailColumn(label: "KCAL", value: workout.kilojoule.map { "\(Int(($0 * 0.239).rounded()))" } ?? "—")
                    }
                    if let m = workout.distanceM, m > 0 {
                        Text(String(format: "Distance · %.2f km", m / 1000))
                            .font(Theme.FontStyle.mono(10.5))
                            .foregroundStyle(Theme.Palette.fg3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    private func formatDuration(_ secs: Double?) -> String {
        guard let s = secs else { return "—" }
        let total = Int(s.rounded())
        let h = total / 3600
        let m = (total % 3600) / 60
        if h > 0 { return "\(h)h \(m)m" }
        return "\(m)m"
    }
}

private struct DetailColumn: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(Theme.FontStyle.sans(9, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg3)
            Text(value)
                .font(Theme.FontStyle.mono(11, weight: .medium))
                .foregroundStyle(Theme.Palette.fg1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
