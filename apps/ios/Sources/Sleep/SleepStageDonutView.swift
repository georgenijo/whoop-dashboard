import SwiftUI
import Charts

struct SleepStageDonutView: View {
    let stages: SleepPayload.LatestSleep.Stages
    let date: String

    private struct StageEntry: Identifiable {
        let name: String
        let ms: Double
        let color: Color
        var id: String { name }
    }

    private var entries: [StageEntry] {
        [
            StageEntry(name: "Deep", ms: stages.deepMs, color: Theme.Palette.sleepDeep),
            StageEntry(name: "REM", ms: stages.remMs, color: Theme.Palette.sleepRem),
            StageEntry(name: "Light", ms: stages.lightMs, color: Theme.Palette.sleepLight),
            StageEntry(name: "Awake", ms: stages.awakeMs, color: Theme.Palette.fg3)
        ]
    }

    private var inBed: Double { max(1, entries.reduce(0) { $0 + $1.ms }) }
    private var asleep: Double { stages.lightMs + stages.deepMs + stages.remMs }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            TrendsCardLabel("Last night", trailing: TrendsFormat.day(date))
            // Donut beside the legend when the legend fits at its natural
            // width; legend under the donut otherwise (narrow columns, large
            // accessibility text sizes).
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.Spacing.lg) {
                    donut
                    legend.frame(maxWidth: .infinity)
                }
                VStack(spacing: Theme.Spacing.md) {
                    donut
                    legend
                }
                .frame(maxWidth: .infinity)
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private var donut: some View {
        ZStack {
            Chart(entries) { e in
                SectorMark(
                    angle: .value(e.name, e.ms),
                    innerRadius: .ratio(0.72),
                    angularInset: 1.5
                )
                .cornerRadius(3)
                .foregroundStyle(e.color)
            }
            .accessibilityHidden(true)
            VStack(spacing: 2) {
                Text(TrendsFormat.hoursMinutes(ms: asleep))
                    .font(Theme.FontStyle.mono(17, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                Text("asleep")
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Asleep")
            .accessibilityValue(TrendsFormat.hoursMinutes(ms: asleep))
        }
        .frame(width: 128, height: 128)
    }

    private var legend: some View {
        VStack(spacing: 10) {
            ForEach(entries) { e in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(e.color)
                        .frame(width: 10, height: 10)
                    Text(e.name)
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg1)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 4)
                    // Durations and shares never wrap: "2h 09m" split
                    // over two lines reads as two numbers.
                    Text(TrendsFormat.hoursMinutes(ms: e.ms))
                        .font(Theme.FontStyle.mono(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .fixedSize()
                    Text("\(Int((e.ms / inBed * 100).rounded()))%")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                        .fixedSize()
                        .frame(minWidth: 36, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}
