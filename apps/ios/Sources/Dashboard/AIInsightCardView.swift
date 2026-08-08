import SwiftUI

struct AIInsightCardView: View {
    let insight: DashboardPayload.AIInsight

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack {
                Text("COACH")
                    .font(Theme.FontStyle.sans(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.ai)
                Spacer()
                if insight.isStale {
                    Text("STALE")
                        .font(Theme.FontStyle.mono(9))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }

            if let text = insight.text {
                MarkdownView(content: text)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("No insight yet")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Palette.bgLift)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Palette.rule, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}
