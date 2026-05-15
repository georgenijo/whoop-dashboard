import SwiftUI

struct WorkoutsTableView: View {
    let workouts: [WorkoutsPayload.WorkoutRow]
    @State private var expandedId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("All workouts")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            if workouts.isEmpty {
                ContentUnavailableView(
                    "No workouts in range",
                    systemImage: "figure.walk",
                    description: Text("Adjust the date range or sync Whoop.")
                )
                .frame(height: 160)
            } else {
                VStack(spacing: 0) {
                    ForEach(workouts) { workout in
                        WorkoutRow(workout: workout, isExpanded: expandedId == workout.id) {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                expandedId = expandedId == workout.id ? nil : workout.id
                            }
                        }
                        if workout.id != workouts.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
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
                            .font(.subheadline.weight(.semibold))
                        Text(workout.date)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let strain = workout.strain {
                        Text(String(format: "%.1f", strain))
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(.tint)
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if isExpanded {
                    HStack(alignment: .top) {
                        DetailColumn(label: "Duration", value: formatDuration(workout.durationSec))
                        DetailColumn(label: "Avg HR", value: workout.avgHr.map { "\(Int($0.rounded())) bpm" } ?? "—")
                        DetailColumn(label: "Max HR", value: workout.maxHr.map { "\(Int($0.rounded())) bpm" } ?? "—")
                        DetailColumn(label: "kcal", value: workout.kilojoule.map { "\(Int(($0 * 0.239).rounded()))" } ?? "—")
                    }
                    if let m = workout.distanceM, m > 0 {
                        Text(String(format: "Distance: %.2f km", m / 1000))
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
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.medium))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
