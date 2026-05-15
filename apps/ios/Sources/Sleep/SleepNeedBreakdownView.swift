import SwiftUI

struct SleepNeedBreakdownView: View {
    let need: SleepPayload.LatestSleep.NeedBreakdown

    private struct Segment: Identifiable {
        let label: String
        let ms: Double
        let colorHex: String
        var id: String { label }
    }

    private var segments: [Segment] {
        var s = [
            Segment(label: "Baseline", ms: need.baselineMs, colorHex: "#4dabf7"),
            Segment(label: "Debt",     ms: need.debtMs,     colorHex: "#ff8c61"),
            Segment(label: "Strain",   ms: need.strainMs,   colorHex: "#ff6b6b")
        ]
        if need.napMs > 0 {
            s.append(Segment(label: "Nap credit", ms: need.napMs, colorHex: "#00d4aa"))
        }
        return s
    }

    private var totalNeed: Double {
        need.baselineMs + need.debtMs + need.strainMs - need.napMs
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Sleep need")
                    .font(.headline)
                Spacer()
                Text(formatHm(totalNeed))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(segments) { seg in
                        Rectangle()
                            .fill(Color(hex: seg.colorHex))
                            .frame(width: max(0, geo.size.width * width(of: seg)))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .frame(height: 18)
            VStack(spacing: 6) {
                ForEach(segments) { seg in
                    HStack(spacing: 6) {
                        Rectangle()
                            .fill(Color(hex: seg.colorHex))
                            .frame(width: 10, height: 10)
                        Text(seg.label)
                            .font(.caption)
                        Spacer()
                        Text(formatHm(seg.ms))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func width(of seg: Segment) -> Double {
        let total = max(1, segments.reduce(0) { $0 + $1.ms })
        return seg.ms / total
    }

    private func formatHm(_ ms: Double) -> String {
        let total = Int(ms / 60_000)
        let h = total / 60
        let m = total % 60
        return String(format: "%dh %02dm", h, m)
    }
}
