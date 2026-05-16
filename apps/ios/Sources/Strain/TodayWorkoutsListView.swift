import SwiftUI

struct TodayWorkoutsListView: View {
    let workouts: [StrainPayload.TodayWorkout]
    @State private var expandedId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("TODAY'S WORKOUTS")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
                .padding(.bottom, 8)
            VStack(spacing: 0) {
                ForEach(workouts) { w in
                    WorkoutRow(workout: w, isExpanded: expandedId == w.id) {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            expandedId = expandedId == w.id ? nil : w.id
                        }
                    }
                    if w.id != workouts.last?.id {
                        Rectangle()
                            .fill(Theme.Palette.borderSubtle)
                            .frame(height: 1)
                    }
                }
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

private struct WorkoutRow: View {
    let workout: StrainPayload.TodayWorkout
    let isExpanded: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                HStack(spacing: 12) {
                    SportIcon(sport: workout.sport)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(workout.sport ?? "Workout")
                            .font(Theme.FontStyle.sans(13.5, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        if let start = workout.startTimeIso {
                            Text(start)
                                .font(Theme.FontStyle.mono(10.5))
                                .foregroundStyle(Theme.Palette.fg3)
                        }
                    }
                    Spacer()
                    if let strain = workout.strain {
                        Text(String(format: "%.1f", strain))
                            .font(Theme.FontStyle.display(18, weight: .medium))
                            .foregroundStyle(Theme.Palette.strain)
                            .monospacedDigit()
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                if isExpanded {
                    HStack(spacing: 12) {
                        col("DURATION", formatDuration(workout.durationSec))
                        col("AVG HR", workout.avgHr.map { "\(Int($0.rounded())) bpm" } ?? "—")
                        col("MAX HR", workout.maxHr.map { "\(Int($0.rounded())) bpm" } ?? "—")
                    }
                    if let dist = workout.distanceM, dist > 0 {
                        Text(String(format: "Distance · %.2f km", dist / 1000))
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

    private func col(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(Theme.FontStyle.sans(9, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg3)
            Text(value)
                .font(Theme.FontStyle.mono(11.5, weight: .medium))
                .foregroundStyle(Theme.Palette.fg1)
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

private struct SportIcon: View {
    let sport: String?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.white.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
                )
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.Palette.fg1)
        }
        .frame(width: 36, height: 36)
    }

    private var systemName: String {
        guard let s = sport?.lowercased() else { return "figure.run" }
        if s.contains("run") { return "figure.run" }
        if s.contains("cycle") || s.contains("bike") { return "bicycle" }
        if s.contains("walk") || s.contains("hike") { return "figure.walk" }
        if s.contains("weight") || s.contains("strength") || s.contains("lift") { return "dumbbell.fill" }
        if s.contains("swim") { return "figure.pool.swim" }
        if s.contains("yoga") { return "figure.yoga" }
        if s.contains("row") { return "figure.rower" }
        return "figure.run"
    }
}
