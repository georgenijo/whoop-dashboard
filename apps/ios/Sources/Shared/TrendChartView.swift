import SwiftUI

/// A `MetricChart` in the standard card. Pages use this; reach for
/// `MetricChart` directly only when composing it into a custom card.
struct TrendChartView: View {
    let title: String
    let unit: String
    let colorHex: String
    let points: [TrendPoint]
    var style: MetricChart.Style = .line
    var precision: Int = 0
    var yDomain: ClosedRange<Double>? = nil
    var markers: [MetricChart.Marker] = []

    var body: some View {
        MetricChart(
            title: title,
            unit: unit,
            accent: Color(hex: colorHex),
            points: points,
            style: style,
            precision: precision,
            yDomain: yDomain,
            markers: markers
        )
        .glassCard(padding: Theme.Spacing.md)
    }
}
