import SwiftUI

struct WorkoutZoneChartView: View {
    let rows: [WorkoutsPayload.ZoneBreakdown]

    private static let zoneColors: [Color] = [
        Color(hex: "#888888"),
        Color(hex: "#4dabf7"),
        Color(hex: "#00d4aa"),
        Color(hex: "#ffd966"),
        Color(hex: "#ff8c61"),
        Color(hex: "#ff6b6b")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Zone breakdown")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            if rows.isEmpty {
                ContentUnavailableView("No zone data", systemImage: "heart.text.square")
                    .frame(height: 100)
            } else {
                VStack(spacing: 8) {
                    ForEach(rows) { row in
                        ZoneRow(row: row, colors: Self.zoneColors)
                    }
                }
                ZoneLegend(colors: Self.zoneColors)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ZoneRow: View {
    let row: WorkoutsPayload.ZoneBreakdown
    let colors: [Color]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(row.sport ?? "Workout")
                    .font(.caption.weight(.medium))
                Spacer()
                Text(row.date)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            GeometryReader { geo in
                HStack(spacing: 0) {
                    Rectangle().fill(colors[0]).frame(width: geo.size.width * row.zones.z0Pct / 100)
                    Rectangle().fill(colors[1]).frame(width: geo.size.width * row.zones.z1Pct / 100)
                    Rectangle().fill(colors[2]).frame(width: geo.size.width * row.zones.z2Pct / 100)
                    Rectangle().fill(colors[3]).frame(width: geo.size.width * row.zones.z3Pct / 100)
                    Rectangle().fill(colors[4]).frame(width: geo.size.width * row.zones.z4Pct / 100)
                    Rectangle().fill(colors[5]).frame(width: geo.size.width * row.zones.z5Pct / 100)
                }
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .frame(height: 14)
        }
    }
}

private struct ZoneLegend: View {
    let colors: [Color]

    var body: some View {
        HStack(spacing: 12) {
            ForEach(0..<6) { i in
                HStack(spacing: 4) {
                    Rectangle()
                        .fill(colors[i])
                        .frame(width: 10, height: 10)
                    Text("Z\(i)").font(.caption2)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}
