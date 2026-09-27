import SwiftUI

/// A compact MetricChart card for the Trends hub. The chart is read-only here
/// so the whole card is one clean tap target; scrubbing lives on the detail page.
struct TrendsHubCard<Footer: View>: View {
    let title: String
    let unit: String
    let accent: Color
    let points: [TrendPoint]
    var style: MetricChart.Style = .line
    var precision: Int = 0
    var yDomain: ClosedRange<Double>? = nil
    var markers: [MetricChart.Marker] = []
    var format: ((Double) -> String)? = nil
    /// The footer's facts, spoken with the card so VoiceOver hears the same
    /// context (zone, delta, low days) that is shown.
    var context: [String?] = []
    @ViewBuilder var footer: () -> Footer

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            MetricChart(
                title: title,
                unit: unit,
                accent: accent,
                points: points,
                style: style,
                precision: precision,
                yDomain: yDomain,
                markers: markers,
                height: 112,
                format: format
            )
            .allowsHitTesting(false)
            HStack(spacing: Theme.Spacing.sm) {
                footer()
                Spacer(minLength: 0)
            }
        }
        .glassCard(padding: Theme.Spacing.md)
        .overlay(alignment: .topTrailing) { TrendsChevron().padding(Theme.Spacing.md) }
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.xl))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        let show: (Double) -> String = { format?($0) ?? $0.formatted(.number.precision(.fractionLength(precision))) }
        return TrendsA11y.summary(values: points.compactMap(\.raw), unit: unit, show: show, context: context)
    }
}

enum TrendsA11y {
    static func summary(values: [Double], unit: String, show: (Double) -> String, context: [String?]) -> String {
        var parts: [String] = []
        if let last = values.last {
            let average = values.reduce(0, +) / Double(values.count)
            parts.append("Latest \(show(last))\(unit.isEmpty ? "" : " \(unit)"), average \(show(average))")
        } else {
            parts.append("No data")
        }
        parts += context.compactMap { $0 }.filter { !$0.isEmpty }
        return parts.joined(separator: ". ")
    }
}

struct TrendsChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.Palette.fg3)
            .accessibilityHidden(true)
    }
}

struct WorkoutsSummaryCard: View {
    let payload: WorkoutsPayload

    private var sports: [WorkoutsPayload.SportFreq] {
        payload.sportFrequency.sorted { $0.sessions > $1.sessions }
    }

    private var totalMinutes: Double { payload.sportFrequency.reduce(0) { $0 + $1.durationMin } }
    private var totalKcal: Double { payload.sportFrequency.reduce(0) { $0 + $1.kj } / 4.184 }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("WORKOUTS")
                    .font(Theme.FontStyle.sans(11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                TrendsChevron()
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(payload.totalCount)")
                    .font(Theme.FontStyle.mono(30, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .contentTransition(.numericText())
                Text(payload.totalCount == 1 ? "session" : "sessions")
                    .font(Theme.FontStyle.mono(13))
                    .foregroundStyle(Theme.Palette.strain)
                Spacer(minLength: 0)
                if payload.totalCount > 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(TrendsFormat.hoursMinutes(minutes: Int(totalMinutes.rounded())))
                            .font(Theme.FontStyle.mono(11, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg2)
                        Text("\(Int(totalKcal.rounded()).formatted()) kcal")
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
            if sports.isEmpty {
                Text("No workouts in this range")
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
            } else {
                mixBar
                legend
            }
        }
        .glassCard(padding: Theme.Spacing.md)
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.xl))
        .accessibilityElement(children: .combine)
    }

    private var mixBar: some View {
        let total = max(1, sports.reduce(0) { $0 + $1.sessions })
        return GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(sports) { sport in
                    Rectangle()
                        .fill(Color(hex: sport.colorHex))
                        .frame(width: max(2, (geo.size.width - CGFloat(sports.count - 1) * 2) * CGFloat(sport.sessions) / CGFloat(total)))
                }
            }
        }
        .frame(height: 8)
        .clipShape(Capsule())
    }

    private var legend: some View {
        let shown = Array(sports.prefix(3))
        let rest = sports.count - shown.count
        return HStack(spacing: Theme.Spacing.sm) {
            ForEach(shown) { sport in
                HStack(spacing: 5) {
                    Circle()
                        .fill(Color(hex: sport.colorHex))
                        .frame(width: 7, height: 7)
                    Text(TrendsFormat.sport(sport.sport))
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg1)
                        .lineLimit(1)
                    Text("\(sport.sessions)")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            if rest > 0 {
                Text("+\(rest)")
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            Spacer(minLength: 0)
        }
    }
}
