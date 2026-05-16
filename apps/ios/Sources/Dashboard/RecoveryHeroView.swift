import SwiftUI

struct RecoveryHeroView: View {
    let hero: DashboardPayload.RecoveryHero

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("RECOVERY")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)

            HStack(alignment: .center, spacing: 20) {
                RecoveryRing(score: hero.score)
                    .frame(width: 110, height: 110)

                VStack(alignment: .leading, spacing: 10) {
                    if let score = hero.score {
                        ZonePill(score: score)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        StatRow(label: "HRV", value: hero.hrvMs.map { "\(Int($0.rounded())) ms" })
                        StatRow(label: "RHR", value: hero.rhrBpm.map { "\(Int($0.rounded())) bpm" })
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
                .stroke(Color.white.opacity(0.06), lineWidth: 8)
            if let score {
                Circle()
                    .trim(from: 0, to: max(0, min(1, score / 100)))
                    .stroke(
                        zoneColor(score),
                        style: StrokeStyle(lineWidth: 8, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .shadow(color: zoneColor(score).opacity(0.7), radius: 6)
                VStack(spacing: 2) {
                    Text("\(Int(score.rounded()))")
                        .font(Theme.FontStyle.display(40, weight: .medium))
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

private func zoneColor(_ score: Double) -> Color {
    switch score {
    case ..<34: return Theme.Palette.zoneRed
    case ..<67: return Theme.Palette.zoneYellow
    default: return Theme.Palette.zoneGreen
    }
}

private func zoneLabel(_ score: Double) -> String {
    switch score {
    case ..<34: return "Compromised"
    case ..<67: return "Adequate"
    default: return "Primed"
    }
}

private struct ZonePill: View {
    let score: Double

    var body: some View {
        let color = zoneColor(score)
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 5, height: 5)
                .shadow(color: color.opacity(0.8), radius: 3)
            Text(zoneLabel(score).uppercased())
                .font(Theme.FontStyle.sans(10.5, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(color)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(color.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
    }
}

private struct StatRow: View {
    let label: String
    let value: String?

    var body: some View {
        HStack {
            Text(label)
                .font(Theme.FontStyle.sans(11.5, weight: .medium))
                .foregroundStyle(Theme.Palette.fg2)
            Spacer()
            Text(value ?? "—")
                .font(Theme.FontStyle.mono(12, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
        }
    }
}
