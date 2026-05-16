import SwiftUI

struct SleepNeedBreakdownView: View {
    let need: SleepPayload.LatestSleep.NeedBreakdown

    private struct Segment: Identifiable {
        let label: String
        let ms: Double
        let color: Color
        var id: String { label }
    }

    private var segments: [Segment] {
        var s = [
            Segment(label: "Baseline", ms: need.baselineMs, color: Theme.Palette.sleepDeep),
            Segment(label: "Debt",     ms: need.debtMs,     color: Theme.Palette.warning),
            Segment(label: "Strain",   ms: need.strainMs,   color: Theme.Palette.rhr)
        ]
        if need.napMs > 0 {
            s.append(Segment(label: "Nap credit", ms: need.napMs, color: Theme.Palette.recovery))
        }
        return s
    }

    private var totalNeed: Double {
        need.baselineMs + need.debtMs + need.strainMs - need.napMs
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("SLEEP NEED")
                    .font(Theme.FontStyle.sans(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                Text(formatHm(totalNeed))
                    .font(Theme.FontStyle.display(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                    .monospacedDigit()
            }

            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(segments) { seg in
                        Rectangle()
                            .fill(LinearGradient(colors: [seg.color, seg.color.opacity(0.7)],
                                                 startPoint: .top, endPoint: .bottom))
                            .frame(width: max(0, geo.size.width * width(of: seg)))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
            }
            .frame(height: 14)

            VStack(spacing: 6) {
                ForEach(segments) { seg in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(seg.color)
                            .frame(width: 9, height: 9)
                        Text(seg.label)
                            .font(Theme.FontStyle.sans(12))
                            .foregroundStyle(Theme.Palette.fg1)
                        Spacer()
                        Text(formatHm(seg.ms))
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
        }
        .glassCard(tint: .sleep, padding: Theme.Spacing.md)
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
