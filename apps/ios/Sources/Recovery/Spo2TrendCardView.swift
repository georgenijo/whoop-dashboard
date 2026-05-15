import SwiftUI
import Charts

struct Spo2TrendCardView: View {
    let trend: RecoveryPayload.Spo2Trend

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("SpO₂")
                        .font(.headline)
                    if let avg = trend.avg {
                        Text(String(format: "avg %.1f%%", avg))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if let low = trend.lowest, let best = trend.best {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(String(format: "low %.1f%%", low))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(String(format: "best %.1f%%", best))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            chartBody
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private var chartBody: some View {
        if trend.points.isEmpty || trend.points.allSatisfy({ $0.value == nil }) {
            ContentUnavailableView("Not enough data yet", systemImage: "lungs")
                .frame(height: 160)
        } else {
            Chart {
                ForEach(trend.points, id: \.date) { p in
                    if let v = p.value {
                        LineMark(x: .value("Date", p.date),
                                 y: .value("SpO₂", v))
                            .interpolationMethod(.catmullRom)
                            .foregroundStyle(Color(hex: "#a78bfa"))
                    }
                }
            }
            .frame(height: 160)
            .chartYScale(domain: trend.yMin ... trend.yMax)
            .chartXAxis { AxisMarks(preset: .aligned, values: .automatic(desiredCount: 4)) }
            .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) }
        }
    }
}
