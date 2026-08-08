import SwiftUI

struct TodayKpisView: View {
    let today: StrainPayload.Today

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("TODAY")
                    .font(Theme.FontStyle.sans(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                Text("\(today.workoutCount) workout\(today.workoutCount == 1 ? "" : "s")")
                    .font(Theme.FontStyle.mono(10.5))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            HStack(spacing: 8) {
                tile(label: "Calories", primary: kcalText, sub: kjText, accent: Theme.Palette.strain)
                tile(label: "Avg HR", primary: hrText(today.avgHr), sub: "all day", accent: Theme.Palette.rhr)
                tile(label: "Max HR", primary: hrText(today.maxHr), sub: maxPctText, accent: Theme.Palette.danger)
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private var kcalText: String {
        guard let k = today.totalKcal else { return "—" }
        return "\(Int(k.rounded()))"
    }

    private var kjText: String? {
        guard let kj = today.totalKilojoule else { return nil }
        return "\(Int(kj.rounded())) kJ"
    }

    private var maxPctText: String? {
        guard let max = today.maxHr, max > 0 else { return nil }
        return "max recorded"
    }

    private func hrText(_ v: Double?) -> String {
        guard let v else { return "—" }
        return "\(Int(v.rounded()))"
    }

    private func tile(label: String, primary: String, sub: String?, accent: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg2)
            Text(primary)
                .font(Theme.FontStyle.display(22, weight: .medium))
                .foregroundStyle(accent)
                .monospacedDigit()
            if let sub {
                Text(sub)
                    .font(Theme.FontStyle.mono(9.5))
                    .foregroundStyle(Theme.Palette.fg3)
            } else {
                Text(" ")
                    .font(Theme.FontStyle.mono(9.5))
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.Palette.bgLift)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Palette.rule, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}
