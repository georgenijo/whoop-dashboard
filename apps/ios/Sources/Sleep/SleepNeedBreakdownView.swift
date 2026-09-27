import SwiftUI

/// Sleep need, read as a sum: what you needed, what made up that need, and
/// how much of it you actually got.
struct SleepNeedBreakdownView: View {
    let need: SleepPayload.LatestSleep.NeedBreakdown
    var asleepMs: Double? = nil

    private struct Part: Identifiable {
        let label: String
        let sign: String
        let ms: Double
        let color: Color
        var id: String { label }
    }

    private var parts: [Part] {
        var p = [
            Part(label: "Baseline", sign: "", ms: need.baselineMs, color: Theme.Palette.sleepDeep),
            Part(label: "Sleep debt", sign: "+", ms: need.debtMs, color: Theme.Palette.warning),
            Part(label: "From strain", sign: "+", ms: need.strainMs, color: Theme.Palette.rhr)
        ]
        if need.napMs > 0 {
            p.append(Part(label: "Nap credit", sign: "−", ms: need.napMs, color: Theme.Palette.recovery))
        }
        return p
    }

    private var totalNeed: Double {
        max(0, need.baselineMs + need.debtMs + need.strainMs - need.napMs)
    }

    private var fraction: Double? {
        guard let asleepMs, totalNeed > 0 else { return nil }
        return min(1, asleepMs / totalNeed)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            TrendsCardLabel("Sleep need")
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.lg) {
                figure(label: "Needed", value: TrendsFormat.hoursMinutes(ms: totalNeed), color: Theme.Palette.fg0)
                if let asleepMs {
                    figure(label: "Got", value: TrendsFormat.hoursMinutes(ms: asleepMs), color: Theme.Palette.fg0)
                }
                Spacer(minLength: 0)
                if let fraction {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(Int((fraction * 100).rounded()))%")
                            .font(Theme.FontStyle.mono(22, weight: .medium))
                            .foregroundStyle(fraction >= 0.85 ? Theme.Palette.success : Theme.Palette.warning)
                        Text("of need met")
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
            if let fraction {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.Palette.bg4)
                        Capsule()
                            .fill(Theme.Palette.sleepDeep)
                            .frame(width: max(8, geo.size.width * fraction))
                    }
                }
                .frame(height: 8)
                .accessibilityHidden(true)
            }
            VStack(spacing: 8) {
                ForEach(parts) { part in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(part.color)
                            .frame(width: 10, height: 10)
                        Text(part.label)
                            .font(Theme.FontStyle.sans(15))
                            .foregroundStyle(Theme.Palette.fg1)
                        Spacer()
                        Text("\(part.sign)\(part.sign.isEmpty ? "" : " ")\(TrendsFormat.hoursMinutes(ms: part.ms))")
                            .font(Theme.FontStyle.mono(13, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg1)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .glassCard(tint: .sleep, padding: Theme.Spacing.md)
    }

    private func figure(label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(Theme.FontStyle.mono(22, weight: .medium))
                .foregroundStyle(color)
            Text(label)
                .font(Theme.FontStyle.mono(11))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .accessibilityElement(children: .combine)
    }
}
