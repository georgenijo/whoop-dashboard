import SwiftUI

struct AIInsightCardView: View {
    let insight: DashboardPayload.AIInsight

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkle")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.Palette.ai)
                .padding(.top, 2)

            if let text = insight.text {
                MarkdownView(content: text)
                    .font(Theme.FontStyle.sans(12.5))
                    .foregroundStyle(Theme.Palette.fg2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("No insight yet")
                    .font(Theme.FontStyle.sans(12.5))
                    .foregroundStyle(Theme.Palette.fg3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if insight.isStale {
                Text("stale")
                    .font(Theme.FontStyle.mono(9))
                    .foregroundStyle(Theme.Palette.fg4)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.white.opacity(0.025))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }
}
