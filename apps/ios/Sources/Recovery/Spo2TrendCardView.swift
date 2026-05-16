import SwiftUI
import Charts

struct Spo2TrendCardView: View {
    let trend: RecoveryPayload.Spo2Trend

    private var accent: Color { Theme.Palette.spo2 }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("SpO₂")
                        .font(Theme.FontStyle.sans(10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg2)
                    if let avg = trend.avg {
                        Text(String(format: "avg %.1f%%", avg))
                            .font(Theme.FontStyle.mono(10.5))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                Spacer()
                if let low = trend.lowest, let best = trend.best {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(String(format: "low %.1f%%", low))
                            .font(Theme.FontStyle.mono(10))
                            .foregroundStyle(Theme.Palette.fg3)
                        Text(String(format: "best %.1f%%", best))
                            .font(Theme.FontStyle.mono(10))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
            chartBody
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    @ViewBuilder
    private var chartBody: some View {
        if trend.points.isEmpty || trend.points.allSatisfy({ $0.value == nil }) {
            VStack(spacing: 8) {
                Image(systemName: "lungs")
                    .font(.title2)
                    .foregroundStyle(Theme.Palette.fg3)
                Text("Not enough data yet")
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
            }
            .frame(maxWidth: .infinity, minHeight: 140)
        } else {
            Chart {
                ForEach(trend.points, id: \.date) { p in
                    if let v = p.value {
                        LineMark(x: .value("Date", p.date),
                                 y: .value("SpO₂", v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(accent)
                            .lineStyle(StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                    }
                }
            }
            .frame(height: 160)
            .chartYScale(domain: trend.yMin ... trend.yMax)
            .chartXAxis {
                AxisMarks(preset: .aligned, values: .automatic(desiredCount: 4)) { _ in
                    AxisValueLabel()
                        .foregroundStyle(Theme.Palette.fg3)
                        .font(Theme.FontStyle.mono(9.5))
                    AxisGridLine()
                        .foregroundStyle(Theme.Palette.borderSubtle)
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { _ in
                    AxisValueLabel()
                        .foregroundStyle(Theme.Palette.fg3)
                        .font(Theme.FontStyle.mono(9.5))
                    AxisGridLine()
                        .foregroundStyle(Theme.Palette.borderSubtle)
                }
            }
        }
    }
}
