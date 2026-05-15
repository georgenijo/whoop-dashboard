import SwiftUI

struct AIInsightCardView: View {
    let insight: DashboardPayload.AIInsight

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("AI Insight", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if insight.isStale {
                    Text("STALE")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.2), in: Capsule())
                        .foregroundStyle(.orange)
                }
            }
            if let text = insight.text {
                Text(text)
                    .font(.callout)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("Not yet generated")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}
