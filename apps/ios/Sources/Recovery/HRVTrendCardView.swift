import SwiftUI
import Charts

struct HRVTrendCardView: View {
    let trend: RecoveryPayload.HRVTrend
    let rangeLabel: String
    @State private var mode: TrendMode = .raw

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("HRV")
                    .font(.headline)
                Text(rangeLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Picker("Mode", selection: $mode) {
                Text("Raw").tag(TrendMode.raw)
                Text("7d").tag(TrendMode.ma7)
                Text("30d").tag(TrendMode.ma30)
            }
            .pickerStyle(.segmented)
            chartBody
            if !trend.anomalies.isEmpty {
                Text("\(trend.anomalies.count) anomaly day\(trend.anomalies.count == 1 ? "" : "s")")
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
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
            ContentUnavailableView("Not enough data yet", systemImage: "chart.line.uptrend.xyaxis")
                .frame(height: 180)
        } else {
            Chart {
                ForEach(data, id: \.date) { p in
                    if let v = p.value {
                        LineMark(x: .value("Date", p.date),
                                 y: .value("HRV", v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(Color(hex: "#ffd966"))
                        AreaMark(x: .value("Date", p.date),
                                 y: .value("HRV", v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(.linearGradient(
                                colors: [Color(hex: "#ffd966").opacity(0.3), .clear],
                                startPoint: .top, endPoint: .bottom))
                    }
                }
                ForEach(trend.anomalies, id: \.date) { a in
                    PointMark(x: .value("Date", a.date),
                              y: .value("HRV", a.baselineMs))
                        .symbol(.circle)
                        .symbolSize(80)
                        .foregroundStyle(.red)
                }
            }
            .frame(height: 180)
            .chartXAxis { AxisMarks(preset: .aligned, values: .automatic(desiredCount: 4)) }
            .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) }
        }
    }
}
