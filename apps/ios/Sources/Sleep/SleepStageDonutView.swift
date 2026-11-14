import SwiftUI

struct SleepStageDonutView: View {
    let stages: SleepPayload.LatestSleep.Stages
    let date: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

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

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            TrendsCardLabel("Sleep stages", trailing: TrendsFormat.day(date))
            GeometryReader { geometry in
                HStack(spacing: 2) {
                    ForEach(entries) { entry in
                        Rectangle()
                            .fill(entry.color)
                            .frame(width: max(0, geometry.size.width - 6) * max(0, entry.ms) / inBed)
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 14)
            .accessibilityHidden(true)
            legend
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private var legend: some View {
        VStack(spacing: 10) {
            ForEach(entries) { e in
                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
                layout {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(e.color)
                        .frame(width: 10, height: 10)
                    Text(e.name)
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg1)
                        .fixedSize(horizontal: false, vertical: true)
                    if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 4) }
                    // Keep the exact duration together at every text size.
                    Text(TrendsFormat.hoursMinutes(ms: e.ms))
                        .font(Theme.FontStyle.mono(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .fixedSize()
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(e.name), \(TrendsFormat.hoursMinutes(ms: e.ms)), \(Int((e.ms / inBed * 100).rounded())) percent")
            }
        }
    }
}
