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
            StageEntry(name: "Light", ms: stages.lightMs, color: Theme.Palette.sleepLight),
            StageEntry(name: "Deep",  ms: stages.deepMs,  color: Theme.Palette.sleepDeep),
            StageEntry(name: "REM",   ms: stages.remMs,   color: Theme.Palette.sleepRem),
            StageEntry(name: "Awake", ms: stages.awakeMs, color: Theme.Palette.rhr)
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 4) {
                Text("STAGES")
                    .font(Theme.FontStyle.sans(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.fg2)
                Text(date)
                    .font(Theme.FontStyle.mono(10.5))
                    .foregroundStyle(Theme.Palette.fg3)
            }

            HStack(spacing: 18) {
                Chart(entries) { e in
                    SectorMark(
                        angle: .value(e.name, e.ms),
                        innerRadius: .ratio(0.66),
                        angularInset: 1.5
                    )
                    .cornerRadius(4)
                    .foregroundStyle(e.color)
                }
                .frame(width: 120, height: 120)
                .shadow(color: Theme.Palette.sleepDeep.opacity(0.25), radius: 12)

                VStack(spacing: 9) {
                    ForEach(entries) { e in
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(e.color)
                                .frame(width: 9, height: 9)
                                .shadow(color: e.color.opacity(0.6), radius: 3)
                            Text(e.name)
                                .font(Theme.FontStyle.sans(12.5, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg1)
                            Spacer()
                            Text(formatHm(e.ms))
                                .font(Theme.FontStyle.mono(11.5))
                                .foregroundStyle(Theme.Palette.fg2)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private func formatHm(_ ms: Double) -> String {
        let total = Int(ms / 60_000)
        return String(format: "%dh %02dm", total / 60, total % 60)
    }
}
