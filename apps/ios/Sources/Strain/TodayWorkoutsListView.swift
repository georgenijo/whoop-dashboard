import SwiftUI

struct TodayWorkoutsListView: View {
    let workouts: [StrainPayload.TodayWorkout]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("TODAY'S WORKOUTS")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
                .padding(.bottom, 8)
            VStack(spacing: 0) {
                ForEach(workouts) { w in
                    NavigationLink {
                        WorkoutDetailView(id: w.id)
                    } label: {
                        WorkoutRow(workout: w)
                    }
                    .buttonStyle(.plain)
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

    var body: some View {
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
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
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
