import SwiftUI

struct RecoveryHeroView: View {
    let hero: DashboardPayload.RecoveryHero
    var trend: [TrendPoint] = []
    var onTap: (() -> Void)? = nil
    var showsGuidance = true
    var isHistorical = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var baseline: Double? {
        Self.thirtyDayAverage(trend)
    }

    /// The backend sends the last 30 *readings*, which can span far more
    /// than 30 days when there are gaps, so keep only the last 30 calendar
    /// days before averaging.
    static func thirtyDayAverage(_ points: [TrendPoint], now: Date = Date(), calendar: Calendar = .current) -> Double? {
        let today = calendar.startOfDay(for: now)
        guard let cutoff = calendar.date(byAdding: .day, value: -29, to: today) else { return nil }
        let values = points.compactMap { p -> Double? in
            guard let raw = p.raw, let date = ChartDate.parse(p.date), date >= cutoff, date <= today else { return nil }
            return raw
        }
        guard values.count >= 7 else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }

    var body: some View {
        if let onTap {
            Button(action: onTap) { card(tappable: true) }
                .buttonStyle(HeroPressStyle())
                .accessibilityHint("Opens recovery details")
        } else {
            card(tappable: false)
        }
    }

    private func card(tappable: Bool) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            let headerLayout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(spacing: 6))
            headerLayout {
                Text(isHistorical ? "Latest recovery" : "Recovery")
                    .font(Theme.FontStyle.sans(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg2)
                if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                if let updated = updatedCaption {
                    Text(updated)
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                if tappable && !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }

            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Spacing.md))
                : AnyLayout(HStackLayout(alignment: .center, spacing: Theme.Spacing.lg))
            layout {
                RecoveryScore(score: hero.score)

                VStack(alignment: .leading, spacing: 10) {
                    if let score = hero.score {
                        Text(score < 34 ? "Lower recovery" : score < 67 ? "Moderate recovery" : "Higher recovery")
                            .font(Theme.FontStyle.sans(17, weight: .semibold))
                            .foregroundStyle(Theme.Palette.fg0)
                        if showsGuidance {
                            Text(isHistorical ? "This reading describes your last recorded day, not your readiness today." : RecoveryZone(score: score).guidance)
                                .font(Theme.FontStyle.sans(15))
                                .foregroundStyle(Theme.Palette.fg1)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let baseline {
                            baselineRow(score: score, baseline: baseline)
                        }
                    } else {
                        Text("No recovery score yet today.")
                            .font(Theme.FontStyle.sans(15))
                            .foregroundStyle(Theme.Palette.fg2)
                        Text("It lands after Whoop scores your sleep.")
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .multilineTextAlignment(.leading)
        .glassCard(tint: heroTint, padding: Theme.Spacing.lg)
        .accessibilityElement(children: .combine)
    }

    private var heroTint: GlassTint { .recovery }

    private func baselineRow(score: Double, baseline: Double) -> some View {
        let diff = score.rounded() - baseline.rounded()
        let sign = diff > 0 ? "+" : diff < 0 ? "−" : "±"
        let color = Theme.Palette.fg2
        return HStack(spacing: 5) {
            Text("\(sign)\(Int(abs(diff)))")
                .font(Theme.FontStyle.mono(13, weight: .medium))
                .foregroundStyle(color)
            Text("vs 30-day avg \(Int(baseline.rounded()))%")
                .font(Theme.FontStyle.mono(11))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var updatedCaption: String? {
        guard let date = InsightDate.parse(hero.updatedAt) else { return nil }
        if Calendar.current.isDateInToday(date) {
            return "Synced " + date.formatted(date: .omitted, time: .shortened)
        }
        return "Synced " + date.formatted(.dateTime.month(.abbreviated).day())
    }
}

private struct HeroPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .brightness(configuration.isPressed ? 0.04 : 0)
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: configuration.isPressed)
    }
}

/// A readable score, with color reserved for the health signal. The label,
/// value and state remain available without relying on the color.
private struct RecoveryScore: View {
    let score: Double?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(score.map { "\(Int($0.rounded()))" } ?? "—")
                .font(Theme.FontStyle.mono(56, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
            if let score {
                Text("%")
                    .font(Theme.FontStyle.sans(18))
                    .foregroundStyle(RecoveryZone(score: score).color)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Recovery")
        .accessibilityValue(score.map { "\(Int($0.rounded())) percent, \(RecoveryZone(score: $0).label)" } ?? "No score")
    }
}
