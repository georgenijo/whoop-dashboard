import SwiftUI

struct KPIStripView: View {
    let tiles: [KPITile]
    var onTap: (KPITile) -> Void = { _ in }

    private let columns: [GridItem] = [
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
        GridItem(.flexible(), spacing: Theme.Spacing.sm)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: Theme.Spacing.sm) {
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

    private var accent: Color { Color(hex: tile.colorHex) }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .center, spacing: 6) {
                    Text(tile.label.uppercased())
                        .font(Theme.FontStyle.sans(10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg2)
                        .lineLimit(1)
                    Spacer()
                    Circle()
                        .fill(accent)
                        .frame(width: 6, height: 6)
                        .shadow(color: accent.opacity(0.7), radius: 3)
                }
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(formattedValue)
                        .font(Theme.FontStyle.display(26, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .monospacedDigit()
                    if !tile.unit.isEmpty {
                        Text(tile.unit)
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                if let delta = tile.delta {
                    HStack(spacing: 3) {
                        Image(systemName: deltaIcon(delta.dir))
                            .font(.system(size: 9, weight: .medium))
                        Text(delta.label)
                            .font(Theme.FontStyle.mono(9.5, weight: .medium))
                    }
                    .foregroundStyle(deltaColor(delta.dir))
                } else {
                    Text(" ")
                        .font(.caption2)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(tileBackground)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.xl)
                .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.xl))
    }

    @ViewBuilder
    private var tileBackground: some View {
        ZStack {
            LinearGradient(
                colors: [Color.white.opacity(0.04), Color.white.opacity(0.01)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [accent.opacity(0.18), .clear],
                center: UnitPoint(x: 1.0, y: 0.0),
                startRadius: 0,
                endRadius: 160
            )
        }
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
        case .up: return Theme.Palette.success
        case .down: return Theme.Palette.danger
        case .flat: return Theme.Palette.fg3
        }
    }
}

#Preview {
    let mock: [KPITile] = [
        KPITile(key: .recovery, label: "Recovery", value: 76, unit: "%", precision: 0,
                delta: .init(label: "+4", dir: .up), href: .recovery, colorHex: "#00d4aa"),
        KPITile(key: .hrv, label: "HRV", value: 58, unit: "ms", precision: 0,
                delta: .init(label: "+2", dir: .up), href: .recovery, colorHex: "#7b61ff"),
        KPITile(key: .rhr, label: "RHR", value: 52, unit: "bpm", precision: 0,
                delta: .init(label: "-1", dir: .down), href: .recovery, colorHex: "#ff6b6b"),
        KPITile(key: .sleep, label: "Sleep", value: 7.3, unit: "h", precision: 1,
                delta: .init(label: "+0.2", dir: .up), href: .sleep, colorHex: "#0055ff"),
        KPITile(key: .strain, label: "Strain", value: 12.5, unit: "score", precision: 1,
                delta: nil, href: .strain, colorHex: "#ffaa00"),
        KPITile(key: .spo2, label: "SpO₂", value: 97.2, unit: "%", precision: 1,
                delta: .init(label: "flat", dir: .flat), href: .recovery, colorHex: "#00d4aa")
    ]
    return ZStack {
        Color.black
        KPIStripView(tiles: mock).padding()
    }
    .preferredColorScheme(.dark)
}
