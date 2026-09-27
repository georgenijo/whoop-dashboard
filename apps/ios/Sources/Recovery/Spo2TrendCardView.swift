import SwiftUI

struct Spo2TrendCardView: View {
    let trend: RecoveryPayload.Spo2Trend

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            MetricChart(
                title: "SpO₂",
                unit: "%",
                accent: Theme.Palette.spo2,
                points: trend.points.map { TrendPoint(date: $0.date, raw: $0.value, ma7: nil, ma30: nil) },
                precision: 1,
                yDomain: trend.yMin ... trend.yMax
            )
            if let low = trend.lowest, let best = trend.best {
                Text(String(format: "Low %.1f%%  ·  Best %.1f%%", low, best))
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}
