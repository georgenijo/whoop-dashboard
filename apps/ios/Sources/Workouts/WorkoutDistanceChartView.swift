import SwiftUI
import Charts

struct WorkoutDistanceChartView: View {
    let rows: [WorkoutsPayload.DistanceRow]

    private struct PlotRow: Identifiable {
        let id: String
        let date: Date
        let distanceKm: Double
    }

    private var plotRows: [PlotRow] {
        rows.compactMap { row in
            guard let date = ChartDate.parse(row.date) else { return nil }
            return PlotRow(id: row.workoutId, date: date, distanceKm: row.distanceKm)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("DISTANCE PER WORKOUT")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
            if plotRows.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "ruler")
                        .font(.title2)
                        .foregroundStyle(Theme.Palette.fg3)
                    Text("No distance data")
                        .font(Theme.FontStyle.sans(12))
                        .foregroundStyle(Theme.Palette.fg2)
                }
                .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                Chart(plotRows) { row in
                    BarMark(
                        x: .value("Date", row.date),
                        y: .value("km", row.distanceKm)
                    )
                    .cornerRadius(2)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [Theme.Palette.info, Theme.Palette.info.opacity(0.45)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
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
        .glassCard(padding: Theme.Spacing.md)
    }
}
