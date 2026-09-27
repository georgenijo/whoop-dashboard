import SwiftUI

struct TodayWorkoutsListView: View {
    let workouts: [StrainPayload.TodayWorkout]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(workouts) { w in
                NavigationLink {
                    WorkoutDetailView(id: w.id)
                } label: {
                    WorkoutRow(workout: w)
                }
                .buttonStyle(TrendsCardPressStyle())
                if w.id != workouts.last?.id {
                    Rectangle()
                        .fill(Theme.Palette.borderSubtle)
                        .frame(height: 1)
                        .padding(.leading, 48)
                }
            }
        }
    }
}

private struct WorkoutRow: View {
    let workout: StrainPayload.TodayWorkout

    private var details: String {
        var parts: [String] = []
        if let time = TrendsFormat.timeOfDay(workout.startTimeIso) { parts.append(time) }
        if let d = workout.durationSec { parts.append(TrendsFormat.hoursMinutes(seconds: d)) }
        if let hr = workout.avgHr { parts.append("\(Int(hr.rounded())) bpm") }
        if let m = workout.distanceM, m > 0 {
            parts.append(Measurement(value: m / 1000, unit: UnitLength.kilometers)
                .formatted(.measurement(width: .abbreviated, usage: .road)))
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: TrendsFormat.sportSymbol(workout.sport))
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.Palette.fg1)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.05)))
            VStack(alignment: .leading, spacing: 3) {
                Text(TrendsFormat.sport(workout.sport))
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                if !details.isEmpty {
                    Text(details)
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            Spacer(minLength: 8)
            if let strain = workout.strain {
                Text(String(format: "%.1f", strain))
                    .font(Theme.FontStyle.mono(17, weight: .medium))
                    .foregroundStyle(Theme.Palette.strain)
            }
            TrendsChevron()
        }
        .padding(.vertical, 10)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
