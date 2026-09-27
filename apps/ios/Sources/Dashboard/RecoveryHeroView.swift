import SwiftUI

struct RecoveryHeroView: View {
    let hero: DashboardPayload.RecoveryHero
    var trend: [TrendPoint] = []
    var onTap: (() -> Void)? = nil

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
            HStack(spacing: 6) {
                Text("RECOVERY")
                    .font(Theme.FontStyle.sans(11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                if let updated = updatedCaption {
                    Text(updated)
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                if tappable {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }

            HStack(alignment: .center, spacing: Theme.Spacing.lg) {
                RecoveryRing(score: hero.score)

                VStack(alignment: .leading, spacing: 10) {
                    if let score = hero.score {
                        ZonePill(score: score)
                        Text(RecoveryZone(score: score).guidance)
                            .font(Theme.FontStyle.sans(15))
                            .foregroundStyle(Theme.Palette.fg1)
                            .fixedSize(horizontal: false, vertical: true)
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
        let color: Color = diff > 0 ? Theme.Palette.zoneGreen : diff < 0 ? Theme.Palette.zoneRed : Theme.Palette.fg2
        return HStack(spacing: 5) {
            Text("\(sign)\(Int(abs(diff)))")
                .font(Theme.FontStyle.mono(13, weight: .medium))
                .foregroundStyle(color)
            Text("vs 30-day avg \(Int(baseline.rounded()))%")
                .font(Theme.FontStyle.mono(11))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
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
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .brightness(configuration.isPressed ? 0.04 : 0)
            .animation(.snappy(duration: 0.2), value: configuration.isPressed)
    }
}

private struct RecoveryRing: View {
    let score: Double?
    @Environment(\.redactionReasons) private var redaction

    private let size: CGFloat = 136
    private let lineWidth: CGFloat = 11

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.07), lineWidth: lineWidth)
            if let score {
                let color = redaction.isEmpty ? RecoveryZone(score: score).color : Theme.Palette.fg4
                let fraction = max(0.005, min(1, score / 100))
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(
                        AngularGradient(
                            colors: [color.opacity(0.35), color],
                            center: .center,
                            startAngle: .degrees(0),
                            endAngle: .degrees(360 * fraction)
                        ),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .shadow(color: color.opacity(0.45), radius: 8)
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text("\(Int(score.rounded()))")
                        .font(Theme.FontStyle.mono(50, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .contentTransition(.numericText())
                    Text("%")
                        .font(Theme.FontStyle.mono(16))
                        .foregroundStyle(color)
                }
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .padding(.horizontal, lineWidth + 6)
            } else {
                Text("—")
                    .font(Theme.FontStyle.mono(40, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Recovery")
        .accessibilityValue(score.map { "\(Int($0.rounded())) percent, \(RecoveryZone(score: $0).label)" } ?? "No score")
    }
}
