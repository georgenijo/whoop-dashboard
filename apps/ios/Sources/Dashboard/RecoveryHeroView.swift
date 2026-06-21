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
                    .frame(width: 120, height: 120)

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
        .glassCard(tint: .recovery, padding: 18)
    }
}

private struct RecoveryRing: View {
    let score: Double?

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.06), lineWidth: 9)
            if let score {
                let color = RecoveryZone(score: score).color
                Circle()
                    .trim(from: 0, to: max(0, min(1, score / 100)))
                    .stroke(color, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .shadow(color: color.opacity(0.6), radius: 6)
                VStack(spacing: 2) {
                    Text("\(Int(score.rounded()))")
                        .font(Theme.FontStyle.mono(42, weight: .semibold))
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
