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
            HStack(spacing: Theme.Spacing.lg) {
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
                    VStack(spacing: 2) {
                        Text(TrendsFormat.hoursMinutes(ms: asleep))
                            .font(Theme.FontStyle.mono(17, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        Text("asleep")
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                .frame(width: 128, height: 128)
                .accessibilityHidden(true)

                VStack(spacing: 10) {
                    ForEach(entries) { e in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(e.color)
                                .frame(width: 10, height: 10)
                            Text(e.name)
                                .font(Theme.FontStyle.sans(15))
                                .foregroundStyle(Theme.Palette.fg1)
                            Spacer(minLength: 4)
                            Text(TrendsFormat.hoursMinutes(ms: e.ms))
                                .font(Theme.FontStyle.mono(13, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg0)
                            Text("\(Int((e.ms / inBed * 100).rounded()))%")
                                .font(Theme.FontStyle.mono(11))
                                .foregroundStyle(Theme.Palette.fg3)
                                .frame(width: 32, alignment: .trailing)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}
