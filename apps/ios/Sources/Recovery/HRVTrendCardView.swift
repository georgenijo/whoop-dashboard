import SwiftUI

struct HRVTrendCardView: View {
    let trend: RecoveryPayload.HRVTrend
    var days: Int = 30
    var embedded = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            MetricChart(
                title: "HRV",
                unit: "ms",
                accent: Theme.Palette.hrv,
                points: trend.points,
                markers: trend.anomalies.map {
                    .init(date: $0.date, label: String(format: "%.0f%% below baseline", $0.pctBelow))
                },
                height: 150,
                subtitle: "\(days) days",
                showsLegend: false
            )
            if !trend.anomalies.isEmpty {
                HStack(spacing: 6) {
                    Circle()
                        .strokeBorder(Theme.Palette.danger, lineWidth: 1.5)
                        .frame(width: 8, height: 8)
                    Text("\(trend.anomalies.count) day\(trend.anomalies.count == 1 ? "" : "s") well below your baseline")
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg2)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .cardChrome(embedded: embedded)
    }
}

/// A plain series card for the Recovery column (recovery, resting heart rate).
struct RecoverySeriesCard: View {
    let title: String
    let unit: String
    let accent: Color
    let points: [TrendPoint]
    var days: Int = 30
    var yDomain: ClosedRange<Double>? = nil
    var showsZoneBands = false
    var embedded = false

    var body: some View {
        MetricChart(
            title: title,
            unit: unit,
            accent: accent,
            points: points,
            yDomain: yDomain,
            height: 150,
            subtitle: "\(days) days",
            showsLegend: false,
            showsZoneBands: showsZoneBands
        )
        .cardChrome(embedded: embedded)
    }
}
