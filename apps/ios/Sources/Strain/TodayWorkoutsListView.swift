import SwiftUI

struct TodayWorkoutsListView: View {
    let workouts: [StrainPayload.TodayWorkout]
    @State private var expandedId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Today's workouts")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 0) {
                ForEach(workouts) { w in
                    WorkoutRow(workout: w, isExpanded: expandedId == w.id) {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            expandedId = expandedId == w.id ? nil : w.id
                        }
                    }
                    if w.id != workouts.last?.id {
                        Divider()
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct WorkoutRow: View {
    let workout: StrainPayload.TodayWorkout
    let isExpanded: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(workout.sport ?? "Workout")
                            .font(.subheadline.weight(.semibold))
                        if let start = workout.startTimeIso {
                            Text(start)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if let strain = workout.strain {
                        Text(String(format: "%.1f", strain))
                            .font(.subheadline.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.red.opacity(0.15), in: Capsule())
                            .foregroundStyle(.red)
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if isExpanded {
                    HStack(alignment: .top, spacing: 12) {
                        col("Duration", formatDuration(workout.durationSec))
                        col("Avg HR", workout.avgHr.map { "\(Int($0.rounded())) bpm" } ?? "—")
                        col("Max HR", workout.maxHr.map { "\(Int($0.rounded())) bpm" } ?? "—")
                    }
                    if let dist = workout.distanceM, dist > 0 {
                        Text(String(format: "Distance: %.2f km", dist / 1000))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    private func col(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.medium))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
