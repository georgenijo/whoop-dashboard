import SwiftUI
import Charts

struct RecoveryTrendCardView: View {
    let points: [TrendPoint]

    private let accent = Theme.Palette.recovery

    private var values: [(date: String, value: Double)] {
        points.compactMap { p in p.raw.map { (p.date, $0) } }
    }

    private var average: Double? {
        guard !values.isEmpty else { return nil }
        return values.map(\.value).reduce(0, +) / Double(values.count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text("RECOVERY · 30D")
                    .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                if let avg = average {
                    Text("avg \(Int(avg.rounded()))%")
                        .font(Theme.FontStyle.mono(10.5))
                        .foregroundStyle(accent)
                }
            }
            chart
        }
        .padding(16)
        .background(Theme.Palette.bgLift)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Palette.rule, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }

    @ViewBuilder
    private var chart: some View {
        if values.isEmpty {
            Text("Not enough data yet")
                .font(Theme.FontStyle.sans(12))
                .foregroundStyle(Theme.Palette.fg3)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        } else {
            Chart {
                ForEach(values, id: \.date) { point in
                    LineMark(x: .value("Date", point.date), y: .value("Recovery", point.value))
                        .interpolationMethod(.catmullRom)
                        .foregroundStyle(accent)
                        .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .butt, lineJoin: .round))
                }
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartYScale(domain: 0...100)
            .frame(height: 64)
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
        RecoveryTrendCardView(points: mock).padding()
    }
    .preferredColorScheme(.dark)
}
