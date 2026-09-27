import SwiftUI

struct HRVTrendCardView: View {
    let trend: RecoveryPayload.HRVTrend

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            MetricChart(
                title: "HRV",
                unit: "ms",
                accent: Theme.Palette.hrv,
                points: trend.points,
                markers: trend.anomalies.map {
                    .init(date: $0.date, label: String(format: "%.0f%% below baseline", $0.pctBelow))
                }
            )
            if !trend.anomalies.isEmpty {
                HStack(spacing: 6) {
                    Circle()
                        .strokeBorder(Theme.Palette.danger, lineWidth: 1.5)
                        .frame(width: 8, height: 8)
                    Text("\(trend.anomalies.count) day\(trend.anomalies.count == 1 ? "" : "s") well below your baseline")
                        .font(Theme.FontStyle.sans(12))
                        .foregroundStyle(Theme.Palette.fg2)
                }
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}
