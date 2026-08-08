import SwiftUI

struct KPIStripView: View {
    let tiles: [KPITile]
    var onTap: (KPITile) -> Void = { _ in }

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.xs),
        GridItem(.flexible(), spacing: Theme.Spacing.xs),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: Theme.Spacing.xs) {
            ForEach(tiles) { tile in
                if tile.href != nil {
                    Button {
                        onTap(tile)
                    } label: {
                        KPICell(tile: tile)
                    }
                    .buttonStyle(.plain)
                } else {
                    KPICell(tile: tile)
                }
            }
        }
    }
}

private struct KPICell: View {
    let tile: KPITile

    private var accent: Color {
        switch tile.key {
        case .recovery: return Theme.Palette.recovery
        case .hrv: return Theme.Palette.hrv
        case .rhr: return Theme.Palette.rhr
        case .sleep: return Theme.Palette.sleepDeep
        case .strain: return Theme.Palette.strain
        case .spo2: return Theme.Palette.spo2
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(tile.label.uppercased())
                .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg3)
                .lineLimit(1)
            HStack(alignment: .lastTextBaseline, spacing: Theme.Spacing.xxs) {
                Text(formattedValue)
                    .font(Theme.FontStyle.mono(24, weight: .medium))
                    .foregroundStyle(Theme.Palette.fgHi)
                    .monospacedDigit()
                Text(tile.unit)
                    .font(Theme.FontStyle.mono(9))
                    .foregroundStyle(accent)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 64, alignment: .leading)
        .padding(Theme.Spacing.sm)
        .background(Theme.Palette.bgLift)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Palette.rule, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .contentShape(Rectangle())
    }

    private var formattedValue: String {
        guard let v = tile.value else { return "—" }
        return String(format: "%.\(tile.precision)f", v)
    }
}

#Preview {
    let mock: [KPITile] = [
        KPITile(key: .hrv, label: "HRV", value: 62, unit: "ms", precision: 0,
                delta: nil, href: .recovery, colorHex: "#7b61ff"),
        KPITile(key: .rhr, label: "RHR", value: 48, unit: "bpm", precision: 0,
                delta: nil, href: .recovery, colorHex: "#ff6b6b"),
        KPITile(key: .sleep, label: "Sleep", value: 7.4, unit: "h", precision: 1,
                delta: nil, href: .sleep, colorHex: "#0055ff"),
        KPITile(key: .strain, label: "Strain", value: 9.2, unit: "", precision: 1,
                delta: nil, href: .strain, colorHex: "#ffaa00")
    ]
    return ZStack {
        Color.black
        KPIStripView(tiles: mock).padding()
    }
    .preferredColorScheme(.dark)
}
