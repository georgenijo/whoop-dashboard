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
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("SPORT BREAKDOWN")
                    .font(Theme.FontStyle.sans(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                Picker("Metric", selection: $metric) {
                    ForEach(SportMetric.allCases) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 180)
            }
            if items.isEmpty {
                emptyState
            } else {
                Chart(items) { item in
                    SectorMark(
                        angle: .value(metric.rawValue, value(for: item)),
                        innerRadius: .ratio(0.6),
                        angularInset: 1.5
                    )
                    .cornerRadius(4)
                    .foregroundStyle(Color(hex: item.colorHex))
                }
                .frame(height: 200)
                legend
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "figure.run")
                .font(.title2)
                .foregroundStyle(Theme.Palette.fg3)
            Text("No workouts in range")
                .font(Theme.FontStyle.sans(12))
                .foregroundStyle(Theme.Palette.fg2)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
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
                        .frame(width: 8, height: 8)
                        .shadow(color: Color(hex: item.colorHex).opacity(0.7), radius: 3)
                    Text(item.sport)
                        .font(Theme.FontStyle.sans(11.5))
                        .foregroundStyle(Theme.Palette.fg1)
                        .lineLimit(1)
                    Spacer()
                    Text(legendValueText(for: item))
                        .font(Theme.FontStyle.mono(10.5))
                        .foregroundStyle(Theme.Palette.fg3)
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
