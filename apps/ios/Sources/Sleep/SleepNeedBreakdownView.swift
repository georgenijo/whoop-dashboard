import SwiftUI

/// Sleep need, read as a sum: the parts add up to the total the hero cites.
struct SleepNeedBreakdownView: View {
    let need: SleepPayload.LatestSleep.NeedBreakdown
    var embedded = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    struct Part: Identifiable, Equatable {
        let label: String
        let sign: String
        let ms: Double
        var id: String { label }
    }

    static func parts(_ need: SleepPayload.LatestSleep.NeedBreakdown) -> [Part] {
        var parts = [
            Part(label: "Baseline", sign: "", ms: need.baselineMs),
            Part(label: "From strain", sign: "+", ms: need.strainMs),
            Part(label: "Sleep debt", sign: "+", ms: need.debtMs)
        ]
        parts.append(Part(label: "Nap credit", sign: need.napMs > 0 ? "−" : "", ms: need.napMs))
        return parts
    }

    static func total(_ need: SleepPayload.LatestSleep.NeedBreakdown) -> Double {
        max(0, need.baselineMs + need.debtMs + need.strainMs - need.napMs)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            LedgerHeader(title: "Sleep need", subtitle: "what the night was measured against")
            ForEach(Self.parts(need)) { part in
                LedgerRule()
                row(label: part.label, value: Self.format(part), emphasized: false)
            }
            LedgerRule()
            row(label: "Total needed", value: TrendsFormat.hoursMinutes(ms: Self.total(need)), emphasized: true)
            if need.debtMs > 0 {
                Text("Sleep debt raises the estimate of need; it isn’t last night’s shortfall.")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(Theme.Spacing.md)
            }
        }
        .cardChrome(embedded: embedded, padding: 0)
    }

    static func format(_ part: Part) -> String {
        let text = TrendsFormat.hoursMinutes(ms: part.ms)
        return part.sign.isEmpty ? text : "\(part.sign)\(text)"
    }

    private func row(label: String, value: String, emphasized: Bool) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        return layout {
            Text(label)
                .font(Theme.FontStyle.sans(17, weight: emphasized ? .semibold : .regular))
                .foregroundStyle(emphasized ? Theme.Palette.fg0 : Theme.Palette.fg1)
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
            Text(value)
                .font(Theme.FontStyle.mono(17, weight: emphasized ? .semibold : .medium))
                .foregroundStyle(Theme.Palette.fg0)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 14)
        .accessibilityElement(children: .combine)
    }
}
