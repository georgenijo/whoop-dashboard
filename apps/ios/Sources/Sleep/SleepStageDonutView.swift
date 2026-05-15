import SwiftUI
import Charts

struct SleepStageDonutView: View {
    let stages: SleepPayload.LatestSleep.Stages
    let date: String

    private struct StageEntry: Identifiable {
        let name: String
        let ms: Double
        let colorHex: String
        var id: String { name }
    }

    private var entries: [StageEntry] {
        [
            StageEntry(name: "Light", ms: stages.lightMs, colorHex: "#4dabf7"),
            StageEntry(name: "Deep",  ms: stages.deepMs,  colorHex: "#1d4ed8"),
            StageEntry(name: "REM",   ms: stages.remMs,   colorHex: "#a78bfa"),
            StageEntry(name: "Awake", ms: stages.awakeMs, colorHex: "#888888")
        ]
    }

    private var total: Double { entries.reduce(0) { $0 + $1.ms } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sleep stages")
                    .font(.headline)
                Text(date)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 16) {
                Chart(entries) { e in
                    SectorMark(
                        angle: .value(e.name, e.ms),
                        innerRadius: .ratio(0.6),
                        angularInset: 1.5
                    )
                    .cornerRadius(4)
                    .foregroundStyle(Color(hex: e.colorHex))
                }
                .frame(width: 120, height: 120)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(entries) { e in
                        HStack(spacing: 6) {
                            Rectangle()
                                .fill(Color(hex: e.colorHex))
                                .frame(width: 10, height: 10)
                            Text(e.name)
                                .font(.caption)
                            Spacer()
                            Text(formatHm(e.ms))
                                .font(.caption.weight(.medium))
                                .monospacedDigit()
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func formatHm(_ ms: Double) -> String {
        let total = Int(ms / 60_000)
        return String(format: "%dh %02dm", total / 60, total % 60)
    }
}
