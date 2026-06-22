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

    private var accent: Color { Color(hex: colorHex) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title.uppercased())
                        .font(Theme.FontStyle.sans(10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg2)
                    if let subtitle {
                        Text(subtitle)
                            .font(Theme.FontStyle.mono(10.5))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                Spacer()
                if showRollingToggle {
                    Picker("Mode", selection: $mode) {
                        ForEach(visibleModes) { m in
                            Text(m.rawValue).tag(m)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: enableMa30 ? 140 : 110)
                }
            }
            chartBody
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private var visibleModes: [TrendMode] {
        enableMa30 ? TrendMode.allCases : [.raw, .ma7]
    }

    @ViewBuilder
    private var chartBody: some View {
        let plotData = plottable
        if plotData.isEmpty {
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
                ForEach(plotData, id: \.date) { point in
                    if let v = point.value {
                        AreaMark(x: .value("Date", point.date),
                                 y: .value(title, v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(.linearGradient(
                                colors: [accent.opacity(0.35), accent.opacity(0.0)],
                                startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Date", point.date),
                                 y: .value(title, v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(accent)
                            .lineStyle(StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                    }
                }
            }
            .frame(height: 180)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    AxisValueLabel(format: .dateTime.month(.abbreviated).day())
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

    private struct PlotPoint { let date: Date; let value: Double? }

    private var plottable: [PlotPoint] {
        let selected: (TrendPoint) -> Double?
        switch mode {
        case .raw: selected = { $0.raw }
        case .ma7: selected = { $0.ma7 }
        case .ma30: selected = { $0.ma30 }
        }
        return points.compactMap { p in
            guard let date = ChartDate.parse(p.date) else { return nil }
            return PlotPoint(date: date, value: selected(p))
        }
    }
}

#Preview {
    let mock: [TrendPoint] = (0..<30).map { i in
        let day = String(format: "2026-04-%02d", i + 1)
        let v = 60.0 + Double(i) * 0.5 + sin(Double(i) * 0.3) * 8
        return TrendPoint(date: day, raw: v, ma7: v - 1, ma30: v - 2)
    }
    return ZStack {
        Color.black
        TrendChartView(
            title: "Recovery score",
            subtitle: "Last 30 days",
            unit: "%",
            colorHex: "#00d4aa",
            points: mock
        )
        .padding()
    }
    .preferredColorScheme(.dark)
}
