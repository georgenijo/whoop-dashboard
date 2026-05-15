import SwiftUI

struct RecoveryHeroView: View {
    let hero: DashboardPayload.RecoveryHero

    var body: some View {
        VStack(spacing: 12) {
            Text("Recovery")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 24) {
                RecoveryRing(score: hero.score)
                    .frame(width: 120, height: 120)
                VStack(alignment: .leading, spacing: 6) {
                    StatRow(label: "HRV", value: hero.hrvMs.map { "\(Int($0.rounded())) ms" })
                    StatRow(label: "RHR", value: hero.rhrBpm.map { "\(Int($0.rounded())) bpm" })
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct RecoveryRing: View {
    let score: Double?

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.gray.opacity(0.2), lineWidth: 12)
            if let score {
                Circle()
                    .trim(from: 0, to: max(0, min(1, score / 100)))
                    .stroke(ringColor(score: score), style: StrokeStyle(lineWidth: 12, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                    Text("\(Int(score.rounded()))")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                    Text("%")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("—")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func ringColor(score: Double) -> Color {
        switch score {
        case ..<34: return .red
        case ..<67: return .yellow
        default: return .green
        }
    }
}

private struct StatRow: View {
    let label: String
    let value: String?

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value ?? "—")
                .font(.subheadline.weight(.medium))
        }
    }
}
