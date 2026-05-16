import SwiftUI

struct AIInsightCardView: View {
    let insight: DashboardPayload.AIInsight

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(spacing: 8) {
                PulsingDot()
                Text("COACH")
                    .font(Theme.FontStyle.sans(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.ai)
                Spacer()
                if insight.isStale {
                    Text("STALE")
                        .font(Theme.FontStyle.sans(9, weight: .bold))
                        .tracking(1.0)
                        .foregroundStyle(Theme.Palette.warning)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Theme.Palette.warning.opacity(0.18), in: Capsule())
                }
            }

            if let text = insight.text {
                Text(text)
                    .font(Theme.FontStyle.sans(14))
                    .lineSpacing(3)
                    .foregroundStyle(Theme.Palette.fg0)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("Not yet generated")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
            }
        }
        .glassCard(tint: .ai, padding: Theme.Spacing.md)
    }
}

private struct PulsingDot: View {
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(Theme.Palette.ai)
            .frame(width: 7, height: 7)
            .shadow(color: Theme.Palette.ai, radius: 6)
            .shadow(color: Theme.Palette.ai.opacity(0.4), radius: 12)
            .scaleEffect(pulse ? 0.8 : 1.0)
            .opacity(pulse ? 0.55 : 1.0)
            .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: pulse)
            .onAppear { pulse = true }
    }
}
