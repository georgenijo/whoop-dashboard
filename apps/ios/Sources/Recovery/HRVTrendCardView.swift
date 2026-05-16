import SwiftUI
import Charts

struct HRVTrendCardView: View {
    let trend: RecoveryPayload.HRVTrend
    let rangeLabel: String
    @State private var mode: TrendMode = .raw

    private var accent: Color { Theme.Palette.hrv }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("HRV")
                        .font(Theme.FontStyle.sans(10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg2)
                    Text(rangeLabel)
                        .font(Theme.FontStyle.mono(10.5))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                Spacer()
                Picker("Mode", selection: $mode) {
                    Text("Raw").tag(TrendMode.raw)
                    Text("7d").tag(TrendMode.ma7)
                    Text("30d").tag(TrendMode.ma30)
                }
                .pickerStyle(.segmented)
                .frame(width: 150)
            }
            chartBody
            if !trend.anomalies.isEmpty {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Theme.Palette.danger)
                        .frame(width: 5, height: 5)
                    Text("\(trend.anomalies.count) anomaly day\(trend.anomalies.count == 1 ? "" : "s")")
                        .font(Theme.FontStyle.mono(10.5))
                        .foregroundStyle(Theme.Palette.danger)
                }
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private struct PlotPoint { let date: String; let value: Double? }

    private var plottable: [PlotPoint] {
        switch mode {
        case .raw: return trend.points.map { PlotPoint(date: $0.date, value: $0.raw) }
        case .ma7: return trend.points.map { PlotPoint(date: $0.date, value: $0.ma7) }
        case .ma30: return trend.points.map { PlotPoint(date: $0.date, value: $0.ma30) }
        }
    }

    @ViewBuilder
    private var chartBody: some View {
        let data = plottable
        if data.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.title2)
                    .foregroundStyle(Theme.Palette.fg3)
                Text("Not enough data yet")
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
            }
            .frame(maxWidth: .infinity, minHeight: 160)
        } else {
            Chart {
                ForEach(data, id: \.date) { p in
                    if let v = p.value {
                        AreaMark(x: .value("Date", p.date),
                                 y: .value("HRV", v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(.linearGradient(
                                colors: [accent.opacity(0.35), accent.opacity(0.0)],
                                startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Date", p.date),
                                 y: .value("HRV", v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(accent)
                            .lineStyle(StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                    }
                }
                ForEach(trend.anomalies, id: \.date) { a in
                    PointMark(x: .value("Date", a.date),
                              y: .value("HRV", a.baselineMs))
                        .symbol(.circle)
                        .symbolSize(70)
                        .foregroundStyle(Theme.Palette.danger)
                }
            }
            .frame(height: 180)
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
