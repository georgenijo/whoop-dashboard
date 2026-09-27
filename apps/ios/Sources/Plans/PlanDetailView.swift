import SwiftUI

struct PlanDetailView: View {
    let plan: WorkoutPlan

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                header

                if let why = plan.plan.why {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "sparkle")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.Palette.ai)
                            .padding(.top, 2)
                        Text(why)
                            .font(Theme.FontStyle.sans(15))
                            .foregroundStyle(Theme.Palette.fg1)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .glassCard(tint: .ai, padding: Theme.Spacing.md)
                }

                ForEach(Array(plan.plan.days.enumerated()), id: \.offset) { _, day in
                    DayCard(day: day)
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(plan.title)
                .font(Theme.FontStyle.sans(28, weight: .bold))
                .foregroundStyle(Theme.Palette.fg0)
            if let description = plan.description {
                Text(description)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: Theme.Spacing.xs) {
                if plan.isActive {
                    Text("Active")
                        .font(Theme.FontStyle.sans(12, weight: .semibold))
                        .foregroundStyle(Theme.Palette.recovery)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Theme.Palette.recovery.opacity(0.14), in: Capsule())
                }
                MetaTag(text: "\(plan.plan.days.count)-day")
                if let tag = plan.tag {
                    MetaTag(text: tag)
                }
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct DayCard: View {
    let day: WorkoutPlan.Day

    private var accent: Color { Color(hex: day.intensity.colorHex) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(day.name)
                        .font(Theme.FontStyle.sans(17, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg0)
                    if let focus = day.focus {
                        Text(focus)
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                Spacer()
                Text(day.intensity.label)
                    .font(Theme.FontStyle.sans(12, weight: .semibold))
                    .foregroundStyle(accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(accent.opacity(0.14), in: Capsule())
                    .overlay(Capsule().strokeBorder(accent.opacity(0.35), lineWidth: 1))
            }

            if day.exercises.isEmpty {
                Text("Rest — no lifts.")
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg3)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(day.exercises.enumerated()), id: \.offset) { index, exercise in
                        ExerciseRow(exercise: exercise)
                        if index < day.exercises.count - 1 {
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

private struct ExerciseRow: View {
    let exercise: WorkoutPlan.Exercise

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.name)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg1)
                if let note = exercise.note {
                    Text(note)
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            Spacer()
            Text(exercise.scheme)
                .font(Theme.FontStyle.mono(13, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
        }
        .padding(.vertical, 11)
    }
}

#Preview {
    NavigationStack {
        PlanDetailView(plan: PlansSample.plan)
    }
    .preferredColorScheme(.dark)
}
