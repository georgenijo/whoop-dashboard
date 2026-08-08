import SwiftUI

struct RecoveryHeroView: View {
    let hero: DashboardPayload.RecoveryHero

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("RECOVERY")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)

            HStack(alignment: .center, spacing: 18) {
                RecoveryRing(score: hero.score)
                    .frame(width: 112, height: 112)

                VStack(alignment: .leading, spacing: 12) {
                    if let score = hero.score {
                        ZonePill(score: score)
                        Text(RecoveryZone(score: score).guidance)
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg2)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("No recovery score yet today.")
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, 12)
        }
        .glassCard(tint: .recovery, padding: Theme.Spacing.md)
    }
}

private struct RecoveryRing: View {
    let score: Double?

    var body: some View {
        ZStack {
            Circle()
                .stroke(Theme.Palette.rule, lineWidth: 7)
            if let score {
                let color = RecoveryZone(score: score).color
                Circle()
                    .trim(from: 0, to: max(0, min(1, score / 100)))
                    .stroke(color, style: StrokeStyle(lineWidth: 7, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 2) {
                    Text("\(Int(score.rounded()))")
                        .font(Theme.FontStyle.mono(40, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .monospacedDigit()
                    Text("PERCENT")
                        .font(Theme.FontStyle.mono(8))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg3)
                }
            } else {
                Text("—")
                    .font(Theme.FontStyle.display(34, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg2)
            }
        }
    }
}
