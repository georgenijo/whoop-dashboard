import SwiftUI
import Charts

enum SportMetric: String, CaseIterable, Identifiable {
    case sessions = "Sessions"
    case kj = "kJ"
    case duration = "Duration"
    var id: String { rawValue }
}

struct SportFrequencyChartView: View {
    let items: [WorkoutsPayload.SportFreq]
    @State private var metric: SportMetric = .sessions

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sport breakdown")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            Picker("Metric", selection: $metric) {
                ForEach(SportMetric.allCases) { m in
                    Text(m.rawValue).tag(m)
                }
            }
            .pickerStyle(.segmented)
            if items.isEmpty {
                ContentUnavailableView("No workouts in range", systemImage: "figure.run")
                    .frame(height: 200)
            } else {
                Chart(items) { item in
                    SectorMark(
                        angle: .value(metric.rawValue, value(for: item)),
                        innerRadius: .ratio(0.55),
                        angularInset: 1.5
                    )
                    .cornerRadius(4)
                    .foregroundStyle(Color(hex: item.colorHex))
                }
                .frame(height: 200)
                legend
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func value(for item: WorkoutsPayload.SportFreq) -> Double {
        switch metric {
        case .sessions: return Double(item.sessions)
        case .kj: return item.kj
        case .duration: return item.durationMin
        }
    }

    private var legend: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
            ForEach(items) { item in
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color(hex: item.colorHex))
                        .frame(width: 10, height: 10)
                    Text(item.sport)
                        .font(.caption)
                        .lineLimit(1)
                    Spacer()
                    Text(legendValueText(for: item))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func legendValueText(for item: WorkoutsPayload.SportFreq) -> String {
        switch metric {
        case .sessions: return "\(item.sessions)"
        case .kj: return "\(Int(item.kj.rounded())) kJ"
        case .duration: return "\(Int(item.durationMin.rounded())) min"
        }
    }
}
