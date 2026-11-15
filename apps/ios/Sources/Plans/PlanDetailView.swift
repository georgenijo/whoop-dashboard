import SwiftUI

struct PlanDetailView: View {
    let plan: WorkoutPlan
    /// Today's recovery, for the "recovery now" figure. Optional: the detail
    /// view also opens from places that only have the plan.
    var recovery: PlanRecovery? = nil

    @State private var expanded: Set<Int> = []
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        ScrollView {
            // Inner display: the title and rationale sit left of the fold,
            // the sessions right of it; nothing spans the hinge.
            FoldColumns(spacing: Theme.Spacing.md) {
                header
                whyCard
                recoveryGuide
                adjustButton
            } trailing: {
                sessionLedger
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .measuresFold()
        .scrollIndicators(.hidden)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(plan.title)
                .font(Theme.FontStyle.sans(28, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                Text(facts)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
                if plan.isActive { ActiveTag() }
            }
            if let provenance = PlansPresentation.provenance(plan) {
                Text(provenance)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            if let description = plan.description {
                Text(description)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var facts: String {
        var parts = [PlansPresentation.countText(plan)]
        if let tag = plan.tag { parts.append(tag) }
        return parts.joined(separator: " · ")
    }

    // MARK: Why this plan

    private var rationale: String? {
        plan.plan.why ?? plan.recoveryContext?.note
    }

    private var stats: [(label: String, value: String, color: Color?)] {
        var result: [(String, String, Color?)] = []
        if let then = plan.recoveryContext?.recoveryScore {
            result.append(("Recovery then", PlansPresentation.percent(then), nil))
        }
        if let hrv = plan.recoveryContext?.hrvTrendPct {
            result.append(("HRV then", PlansPresentation.signedPercent(hrv), nil))
        }
        if let now = recovery?.today?.recoveryScore {
            result.append(("Recovery now", PlansPresentation.percent(now), RecoveryZone(score: now).color))
        }
        return result
    }

    @ViewBuilder
    private var whyCard: some View {
        if rationale != nil || !stats.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("Why this plan")
                        .font(Theme.FontStyle.sans(15, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg0)
                    if !stats.isEmpty {
                        Text("recovery when it was made")
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                .padding(Theme.Spacing.md)
                .accessibilityAddTraits(.isHeader)

                if let rationale {
                    Text(rationale)
                        .font(Theme.FontStyle.sans(17))
                        .foregroundStyle(Theme.Palette.fg1)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Theme.Spacing.md)
                        .padding(.bottom, Theme.Spacing.md)
                }

                if !stats.isEmpty {
                    CoachLedgerRule()
                    let layout = dynamicTypeSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
                        : AnyLayout(HStackLayout(alignment: .top, spacing: 0))
                    layout {
                        ForEach(Array(stats.enumerated()), id: \.offset) { index, stat in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(stat.label)
                                    .font(Theme.FontStyle.sans(13))
                                    .foregroundStyle(Theme.Palette.fg2)
                                Text(stat.value)
                                    .font(Theme.FontStyle.mono(26, weight: .medium))
                                    .foregroundStyle(stat.color ?? Theme.Palette.fg0)
                            }
                            .padding(Theme.Spacing.sm)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .overlay(alignment: .trailing) {
                                if index < stats.count - 1 && !dynamicTypeSize.isAccessibilitySize {
                                    Rectangle().fill(CoachLedger.rule).frame(width: 1)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
            .coachLedgerOutline()
        }
    }

    // MARK: Recovery guide

    private var recoveryGuide: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("How Coach reads recovery")
                .font(Theme.FontStyle.sans(15, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .padding(Theme.Spacing.md)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array([RecoveryBand.high, .mid, .low].enumerated()), id: \.offset) { _, band in
                CoachLedgerRule()
                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    : AnyLayout(HStackLayout(alignment: .top, spacing: 14))
                layout {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Rectangle().fill(band.color).frame(width: 9, height: 9)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(band.ruleLabel)
                                .font(Theme.FontStyle.sans(15, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg0)
                            Text(band.range)
                                .font(Theme.FontStyle.sans(13))
                                .foregroundStyle(Theme.Palette.fg3)
                        }
                    }
                    .frame(width: dynamicTypeSize.isAccessibilitySize ? nil : 128, alignment: .leading)
                    Text(band.guidance)
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg1)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.vertical, 12)
                .accessibilityElement(children: .combine)
            }
        }
        .coachLedgerOutline()
    }

    private var adjustButton: some View {
        Button {
            CoachCompose.request(PlansPresentation.adjustDraft(planTitle: plan.title))
        } label: {
            Label("Adjust with Coach", systemImage: "sparkle")
                .font(Theme.FontStyle.sans(15, weight: .medium))
                .foregroundStyle(Theme.Palette.accent)
                .padding(.horizontal, Theme.Spacing.md)
                .frame(minHeight: 48)
                .overlay(Rectangle().strokeBorder(Theme.Palette.borderDefault, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(ChatPressStyle())
        .accessibilityHint("Opens Coach with a draft message. Nothing is sent until you send it.")
    }

    // MARK: Sessions

    private var sessionLedger: some View {
        let numbers = PlansPresentation.sessionNumbers(plan.plan.days)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Sessions")
                    .font(Theme.FontStyle.sans(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                Spacer()
                Text("intensity")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            .padding(Theme.Spacing.md)
            .accessibilityAddTraits(.isHeader)

            ForEach(Array(plan.plan.days.enumerated()), id: \.offset) { index, day in
                CoachLedgerRule()
                if PlansPresentation.hasDetails(day) {
                    sessionRow(index: index, number: numbers[index], day: day)
                } else {
                    restRow(day)
                }
            }
        }
        .coachLedgerOutline()
    }

    private func sessionRow(index: Int, number: Int?, day: WorkoutPlan.Day) -> some View {
        let isOpen = expanded.contains(index)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.2)) {
                    if isOpen { expanded.remove(index) } else { expanded.insert(index) }
                }
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    Text(number.map(String.init) ?? "–")
                        .font(Theme.FontStyle.mono(15))
                        .foregroundStyle(number == nil ? Theme.Palette.fg3 : Theme.Palette.fg1)
                        .frame(width: 32, height: 32)
                        .overlay(
                            Rectangle().strokeBorder(
                                number == nil ? Theme.Palette.borderDefault : Theme.Palette.borderStrong,
                                style: StrokeStyle(lineWidth: 1, dash: number == nil ? [3, 3] : [])
                            )
                        )
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(day.name)
                            .font(Theme.FontStyle.sans(17, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                            .multilineTextAlignment(.leading)
                        Text(subtitle(day))
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg2)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 6) {
                        IntensityMark(intensity: day.intensity)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.Palette.fg3)
                            .rotationEffect(.degrees(isOpen ? 90 : 0))
                    }
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.vertical, 12)
                .frame(minHeight: 56)
                .contentShape(Rectangle())
            }
            .buttonStyle(ChatPressStyle())
            .accessibilityLabel(number.map { "Session \($0), \(day.name)" } ?? day.name)
            .accessibilityValue("\(day.intensity.label) intensity, \(isOpen ? "expanded" : "collapsed")")
            .accessibilityHint("Shows the exercises")

            if isOpen {
                VStack(spacing: 0) {
                    ForEach(Array(day.exercises.enumerated()), id: \.offset) { _, exercise in
                        exerciseRow(exercise)
                    }
                }
                .padding(.leading, Theme.Spacing.md + 44)
                .padding(.trailing, Theme.Spacing.md)
                .padding(.bottom, Theme.Spacing.sm)
            }
        }
    }

    private func subtitle(_ day: WorkoutPlan.Day) -> String {
        let names = PlansPresentation.exerciseSummary(day)
        if let focus = day.focus, !focus.isEmpty { return "\(focus.capitalized) · \(names)" }
        return names
    }

    private func exerciseRow(_ exercise: WorkoutPlan.Exercise) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 3))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 10))
        return VStack(alignment: .leading, spacing: 3) {
            layout {
                Text(exercise.name)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg1)
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
                Text(exercise.scheme)
                    .font(Theme.FontStyle.mono(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
            }
            if let note = exercise.note, !note.isEmpty {
                Text(note)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func restRow(_ day: WorkoutPlan.Day) -> some View {
        HStack(spacing: 12) {
            Text("–")
                .font(Theme.FontStyle.mono(15))
                .foregroundStyle(Theme.Palette.fg3)
                .frame(width: 32, height: 32)
                .overlay(Rectangle().strokeBorder(Theme.Palette.borderDefault, style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                .accessibilityHidden(true)
            Text(day.name)
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 10)
        .frame(minHeight: 48)
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    NavigationStack {
        PlanDetailView(plan: PlansSample.plan, recovery: PlansSample.recovery)
    }
    .preferredColorScheme(.dark)
}
