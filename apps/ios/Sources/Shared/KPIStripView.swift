import SwiftUI

struct KPIStripView: View {
    let tiles: [KPITile]
    var onTap: (KPITile) -> Void = { _ in }

    private var strip: [KPITile] { Array(tiles.prefix(4)) }

    var body: some View {
        HStack(spacing: 1) {
            ForEach(Array(strip.enumerated()), id: \.offset) { index, tile in
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
                if index < strip.count - 1 {
                    Rectangle()
                        .fill(Theme.Palette.borderSubtle)
                        .frame(width: 1)
                }
            }
        }
        .background(Theme.Palette.bg2)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }
}

private struct KPICell: View {
    let tile: KPITile

    private var accent: Color { Color(hex: tile.colorHex) }

    var body: some View {
        VStack(spacing: 4) {
            Text(tile.label.uppercased())
                .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg3)
                .lineLimit(1)
            Text(formattedValue)
                .font(Theme.FontStyle.mono(19, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .monospacedDigit()
            Text(tile.unit.isEmpty ? " " : tile.unit)
                .font(Theme.FontStyle.mono(8.5))
                .foregroundStyle(accent)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal, 6)
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
