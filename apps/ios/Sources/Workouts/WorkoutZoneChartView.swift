import SwiftUI

struct WorkoutZoneChartView: View {
    let rows: [WorkoutsPayload.ZoneBreakdown]

    private static let zoneColors: [Color] = [
        Theme.Palette.hrZone0,
        Theme.Palette.hrZone1,
        Theme.Palette.hrZone2,
        Theme.Palette.hrZone3,
        Theme.Palette.hrZone4,
        Theme.Palette.hrZone5
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("ZONE BREAKDOWN")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
            if rows.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "heart.text.square")
                        .font(.title2)
                        .foregroundStyle(Theme.Palette.fg3)
                    Text("No zone data")
                        .font(Theme.FontStyle.sans(12))
                        .foregroundStyle(Theme.Palette.fg2)
                }
                .frame(maxWidth: .infinity, minHeight: 100)
            } else {
                VStack(spacing: 10) {
                    ForEach(rows) { row in
                        ZoneRow(row: row, colors: Self.zoneColors)
                    }
                }
                ZoneLegend(colors: Self.zoneColors)
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

private struct ZoneRow: View {
    let row: WorkoutsPayload.ZoneBreakdown
    let colors: [Color]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(row.sport ?? "Workout")
                    .font(Theme.FontStyle.sans(12, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg1)
                Spacer()
                Text(row.date)
                    .font(Theme.FontStyle.mono(10))
                    .foregroundStyle(Theme.Palette.fg3)
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
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1))
            }
            .frame(height: 12)
        }
    }
}

private struct ZoneLegend: View {
    let colors: [Color]

    var body: some View {
        HStack(spacing: 12) {
            ForEach(0..<6, id: \.self) { i in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(colors[i])
                        .frame(width: 8, height: 8)
                    Text("Z\(i)")
                        .font(Theme.FontStyle.mono(9.5, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg2)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}
