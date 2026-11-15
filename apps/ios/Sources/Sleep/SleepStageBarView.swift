import SwiftUI

/// Where the night went: one bar and, per stage, its share and duration.
/// Awake time is part of the bar, so the shares add up to time in bed.
struct SleepStageBarView: View {
    let stages: SleepPayload.LatestSleep.Stages
    var embedded = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    struct Entry: Identifiable, Equatable {
        let name: String
        let ms: Double
        let percent: Int
        var id: String { name }
    }

    /// Awake, Light, Deep, REM with whole-percent shares of time in bed.
    static func entries(_ stages: SleepPayload.LatestSleep.Stages) -> [Entry] {
        let parts: [(String, Double)] = [
            ("Awake", stages.awakeMs), ("Light", stages.lightMs), ("Deep", stages.deepMs), ("REM", stages.remMs)
        ]
        let total = max(1, parts.reduce(0) { $0 + max(0, $1.1) })
        return parts.map { Entry(name: $0.0, ms: max(0, $0.1), percent: Int((max(0, $0.1) / total * 100).rounded())) }
    }

    private static func color(_ name: String) -> Color {
        switch name {
        case "Awake": return Theme.Palette.fg3
        case "Light": return Theme.Palette.sleepLight
        case "Deep": return Theme.Palette.sleepDeep
        default: return Theme.Palette.sleepRem
        }
    }

    private var entries: [Entry] { Self.entries(stages) }
    private var inBed: Double { max(1, entries.reduce(0) { $0 + $1.ms }) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            GeometryReader { geometry in
                HStack(spacing: 2) {
                    ForEach(entries) { entry in
                        Rectangle()
                            .fill(Self.color(entry.name))
                            .frame(width: max(0, geometry.size.width - 6) * entry.ms / inBed)
                    }
                }
            }
            .frame(height: 14)
            .accessibilityHidden(true)

            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Spacing.sm))
                : AnyLayout(HStackLayout(alignment: .top, spacing: Theme.Spacing.sm))
            layout {
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Rectangle().fill(Self.color(entry.name)).frame(width: 8, height: 8)
                            Text(entry.name)
                                .font(Theme.FontStyle.sans(15))
                                .foregroundStyle(Theme.Palette.fg1)
                        }
                        Text("\(entry.percent)%")
                            .font(Theme.FontStyle.mono(17, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        Text(TrendsFormat.hoursMinutes(ms: entry.ms))
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(entry.name)
                    .accessibilityValue("\(TrendsFormat.hoursMinutes(ms: entry.ms)), \(entry.percent) percent")
                }
            }
        }
        .cardChrome(embedded: embedded, padding: Theme.Spacing.lg)
    }
}
