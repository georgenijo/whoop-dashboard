import SwiftUI

struct KPIStripView: View {
    let tiles: [KPITile]
    var onTap: (KPITile) -> Void = { _ in }

    private let columns: [GridItem] = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(tiles) { tile in
                Button {
                    onTap(tile)
                } label: {
                    KPITileView(tile: tile)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct KPITileView: View {
    let tile: KPITile

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(tile.label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(formattedValue)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: tile.colorHex))
                if !tile.unit.isEmpty {
                    Text(tile.unit)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            if let delta = tile.delta {
                HStack(spacing: 2) {
                    Image(systemName: deltaIcon(delta.dir))
                        .font(.caption2)
                    Text(delta.label)
                        .font(.caption2)
                }
                .foregroundStyle(deltaColor(delta.dir))
            } else {
                Text(" ")
                    .font(.caption2)
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var formattedValue: String {
        guard let v = tile.value else { return "—" }
        return String(format: "%.\(tile.precision)f", v)
    }

    private func deltaIcon(_ dir: KPITile.Delta.Direction) -> String {
        switch dir {
        case .up: return "arrow.up"
        case .down: return "arrow.down"
        case .flat: return "minus"
        }
    }

    private func deltaColor(_ dir: KPITile.Delta.Direction) -> Color {
        switch dir {
        case .up: return .green
        case .down: return .red
        case .flat: return .secondary
        }
    }
}

#Preview {
    let mock: [KPITile] = [
        KPITile(key: .recovery, label: "Recovery", value: 76, unit: "%", precision: 0,
                delta: .init(label: "+4", dir: .up), href: .recovery, colorHex: "#00d4aa"),
        KPITile(key: .hrv, label: "HRV", value: 58, unit: "ms", precision: 0,
                delta: .init(label: "+2", dir: .up), href: .recovery, colorHex: "#ffd966"),
        KPITile(key: .rhr, label: "RHR", value: 52, unit: "bpm", precision: 0,
                delta: .init(label: "-1", dir: .down), href: .recovery, colorHex: "#ff8c61"),
        KPITile(key: .sleep, label: "Sleep", value: 7.3, unit: "h", precision: 1,
                delta: .init(label: "+0.2", dir: .up), href: .sleep, colorHex: "#4dabf7"),
        KPITile(key: .strain, label: "Strain", value: 12.5, unit: "score", precision: 1,
                delta: nil, href: .strain, colorHex: "#ff6b6b"),
        KPITile(key: .spo2, label: "SpO₂", value: 97.2, unit: "%", precision: 1,
                delta: .init(label: "flat", dir: .flat), href: .recovery, colorHex: "#a78bfa")
    ]
    return KPIStripView(tiles: mock).padding()
}
