import SwiftUI
import Charts

struct WorkoutDistanceChartView: View {
    let rows: [WorkoutsPayload.DistanceRow]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("DISTANCE PER WORKOUT")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
            if rows.isEmpty {
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
                Chart(rows) { row in
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
        .glassCard(padding: Theme.Spacing.md)
    }
}
