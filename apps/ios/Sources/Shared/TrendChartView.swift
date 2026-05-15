import SwiftUI
import Charts

enum TrendMode: String, CaseIterable, Identifiable {
    case raw = "Raw"
    case ma7 = "7d"
    case ma30 = "30d"
    var id: String { rawValue }
}

struct TrendChartView: View {
    let title: String
    let subtitle: String?
    let unit: String
    let colorHex: String
    let points: [TrendPoint]
    var showRollingToggle: Bool = true
    var enableMa30: Bool = true

    @State private var mode: TrendMode = .raw

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if showRollingToggle {
                Picker("Mode", selection: $mode) {
                    ForEach(visibleModes) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
            }
            chartBody
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var visibleModes: [TrendMode] {
        enableMa30 ? TrendMode.allCases : [.raw, .ma7]
    }

    @ViewBuilder
    private var chartBody: some View {
        let plotData = plottable
        if plotData.isEmpty {
            ContentUnavailableView(
                "Not enough data yet",
                systemImage: "chart.line.uptrend.xyaxis"
            )
            .frame(height: 180)
        } else {
            Chart {
                ForEach(plotData, id: \.date) { point in
                    if let v = point.value {
                        LineMark(x: .value("Date", point.date),
                                 y: .value(title, v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(Color(hex: colorHex))
                        AreaMark(x: .value("Date", point.date),
                                 y: .value(title, v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(.linearGradient(
                                colors: [Color(hex: colorHex).opacity(0.3), .clear],
                                startPoint: .top, endPoint: .bottom))
                    }
                }
            }
            .frame(height: 180)
            .chartXAxis {
                AxisMarks(preset: .aligned, values: .automatic(desiredCount: 4))
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4))
            }
        }
    }

    private struct PlotPoint { let date: String; let value: Double? }

    private var plottable: [PlotPoint] {
        switch mode {
        case .raw: return points.map { PlotPoint(date: $0.date, value: $0.raw) }
        case .ma7: return points.map { PlotPoint(date: $0.date, value: $0.ma7) }
        case .ma30: return points.map { PlotPoint(date: $0.date, value: $0.ma30) }
        }
    }
}

#Preview {
    let mock: [TrendPoint] = (0..<30).map { i in
        let day = String(format: "2026-04-%02d", i + 1)
        let v = 60.0 + Double(i) * 0.5 + sin(Double(i) * 0.3) * 8
        return TrendPoint(date: day, raw: v, ma7: v - 1, ma30: v - 2)
    }
    return TrendChartView(
        title: "Recovery score",
        subtitle: "Last 30 days",
        unit: "%",
        colorHex: "#00d4aa",
        points: mock
    )
    .padding()
}
