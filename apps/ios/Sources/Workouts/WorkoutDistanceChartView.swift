import SwiftUI
import Charts

struct WorkoutDistanceChartView: View {
    let rows: [WorkoutsPayload.DistanceRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Distance per workout")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            if rows.isEmpty {
                ContentUnavailableView("No distance data", systemImage: "ruler")
                    .frame(height: 180)
            } else {
                Chart(rows) { row in
                    BarMark(
                        x: .value("Date", row.date),
                        y: .value("km", row.distanceKm)
                    )
                    .foregroundStyle(Color(hex: "#4dabf7"))
                }
                .frame(height: 180)
                .chartXAxis {
                    AxisMarks(preset: .aligned, values: .automatic(desiredCount: 4))
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}
