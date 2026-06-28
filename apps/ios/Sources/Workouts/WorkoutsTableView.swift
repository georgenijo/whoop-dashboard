import SwiftUI

struct WorkoutsTableView: View {
    let workouts: [WorkoutsPayload.WorkoutRow]

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
                        NavigationLink {
                            WorkoutDetailView(id: workout.id)
                        } label: {
                            WorkoutRow(workout: workout)
                        }
                        .buttonStyle(.plain)
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

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(workout.sport ?? "Workout")
                    .font(Theme.FontStyle.sans(13.5, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                HStack(spacing: 6) {
                    Text(workout.date)
                    Text("·").foregroundStyle(Theme.Palette.fg4)
                    Text(formatDuration(workout.durationSec))
                    if let avg = workout.avgHr {
                        Text("·").foregroundStyle(Theme.Palette.fg4)
                        Text("\(Int(avg.rounded())) bpm")
                    }
                }
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
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .padding(.vertical, 11)
        .contentShape(Rectangle())
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
