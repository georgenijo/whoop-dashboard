import SwiftUI

/// Vitals as a fixed grid: every tile visible at once, no sideways scroll.
/// Rows are balanced (7 tiles at 3 columns lay out 3-2-2, never 3-3-1), so no
/// tile is stranded. Tiles become buttons (with a chevron) only when `onTap`
/// is supplied and the tile has a destination.
struct KPIStripView: View {
    let tiles: [KPITile]
    var columns: Int = 3
    var onTap: ((KPITile) -> Void)? = nil

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// Accessibility text sizes get two wide columns instead of three
    /// narrow ones so values and deltas are never clipped.
    private var effectiveColumns: Int {
        dynamicTypeSize.isAccessibilitySize ? min(columns, 2) : columns
    }

    static func rowSizes(count: Int, columns: Int) -> [Int] {
        guard count > 0 else { return [] }
        let cols = max(1, columns)
        let rows = (count + cols - 1) / cols
        let base = count / rows
        let extra = count % rows
        return (0..<rows).map { $0 < extra ? base + 1 : base }
    }

    private var rows: [[KPITile]] {
        var start = 0
        return Self.rowSizes(count: tiles.count, columns: effectiveColumns).map { size in
            defer { start += size }
            return Array(tiles[start..<start + size])
        }
    }

    /// The most common comparison ("vs yesterday"). It is printed once under
    /// the grid; only tiles comparing against a different day repeat theirs.
    private var sharedContext: String? {
        let contexts = tiles.compactMap { $0.delta.map { KPIDeltaText($0).context } }.filter { !$0.isEmpty }
        let counts = Dictionary(contexts.map { ($0, 1) }, uniquingKeysWith: +)
        return counts.max { a, b in a.value == b.value ? a.key > b.key : a.value < b.value }?.key
    }

    var body: some View {
        let shared = sharedContext
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(row) { tile in
                        cell(tile, showContext: tile.delta.map { KPIDeltaText($0).context != shared } ?? false)
                            .frame(maxHeight: .infinity)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            if let shared {
                Text("Change \(shared)")
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .padding(.leading, 2)
            }
        }
    }

    @ViewBuilder
    private func cell(_ tile: KPITile, showContext: Bool) -> some View {
        if let onTap, tile.href != nil {
            Button { onTap(tile) } label: {
                KPICell(tile: tile, tappable: true, showContext: showContext)
            }
            .buttonStyle(KPIPressStyle())
            .accessibilityHint("Opens \(tile.label) details")
        } else {
            KPICell(tile: tile, tappable: false, showContext: showContext)
        }
    }
}

struct KPIDeltaText {
    let amount: String
    let context: String

    init(_ delta: KPITile.Delta) {
        let label = delta.label.trimmingCharacters(in: .whitespaces)
        if label.hasPrefix("—") || label.lowercased().contains("baseline") {
            amount = "no change"
            context = ""
            return
        }
        if let range = label.range(of: " vs ") {
            amount = Self.grouped(String(label[..<range.lowerBound]))
            context = String(label[range.lowerBound...]).trimmingCharacters(in: .whitespaces)
        } else {
            amount = Self.grouped(label)
            context = ""
        }
    }

    var shortContext: String {
        context.replacingOccurrences(of: " days ago", with: "d ago")
    }

    /// Adds thousands separators to the number inside "↓ 35585".
    private static func grouped(_ amount: String) -> String {
        guard let start = amount.firstIndex(where: \.isNumber) else { return amount }
        let tail = amount[start...]
        let numberPart = tail.prefix(while: { $0.isNumber || $0 == "." })
        guard let value = Double(numberPart), value >= 1000 else { return amount }
        let decimals = numberPart.split(separator: ".").dropFirst().first?.count ?? 0
        let formatted = value.formatted(.number.precision(.fractionLength(decimals)))
        return String(amount[..<start]) + formatted + String(tail.dropFirst(numberPart.count))
    }
}

private struct KPICell: View {
    let tile: KPITile
    let tappable: Bool
    let showContext: Bool

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var accent: Color { Color(hex: tile.colorHex) }
    private var wraps: Bool { dynamicTypeSize.isAccessibilitySize }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text(tile.label.uppercased())
                    .font(Theme.FontStyle.sans(11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.Palette.fg2)
                    .lineLimit(wraps ? 2 : 1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                if tappable {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(formattedValue)
                    .font(Theme.FontStyle.mono(24, weight: .medium))
                    .foregroundStyle(tile.value == nil ? Theme.Palette.fg3 : Theme.Palette.fg0)
                    .contentTransition(.numericText())
                if !tile.unit.isEmpty, tile.value != nil {
                    Text(tile.unit)
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(accent)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.6)

            deltaRow
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg + 2)
                .fill(Color.white.opacity(0.035))
        )
        .overlay(alignment: .topLeading) {
            Capsule()
                .fill(accent)
                .frame(width: 14, height: 2)
                .padding(.leading, 12)
                .opacity(0.9)
        }
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg + 2)
                .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.lg + 2))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tile.label)
        .accessibilityValue(accessibilityValue)
    }

    @ViewBuilder
    private var deltaRow: some View {
        if let delta = tile.delta {
            let text = KPIDeltaText(delta)
            let context = showContext && !text.context.isEmpty ? " " + text.shortContext : ""
            (Text(text.amount).foregroundStyle(deltaColor(delta.dir))
                + Text(context).foregroundStyle(Theme.Palette.fg3))
                .font(Theme.FontStyle.mono(11, weight: .medium))
                .lineLimit(wraps ? 3 : 1)
                .minimumScaleFactor(wraps ? 1 : 0.8)
                .fixedSize(horizontal: false, vertical: wraps)
        } else {
            Text("no comparison")
                .font(Theme.FontStyle.mono(11))
                .foregroundStyle(Theme.Palette.fg4)
                .lineLimit(wraps ? 2 : 1)
                .minimumScaleFactor(0.8)
        }
    }

    private func deltaColor(_ dir: KPITile.Delta.Direction) -> Color {
        switch dir {
        case .up: return Theme.Palette.zoneGreen
        case .down: return Theme.Palette.zoneRed
        case .flat: return Theme.Palette.fg2
        }
    }

    private var formattedValue: String {
        guard let v = tile.value else { return "—" }
        return v.formatted(.number.precision(.fractionLength(tile.precision)))
    }

    private var accessibilityValue: String {
        guard tile.value != nil else { return "No data" }
        var parts = ["\(formattedValue) \(tile.unit)"]
        if let delta = tile.delta {
            parts.append(delta.label.replacingOccurrences(of: "↑", with: "up")
                .replacingOccurrences(of: "↓", with: "down"))
        }
        return parts.joined(separator: ", ")
    }
}

private struct KPIPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .brightness(configuration.isPressed ? 0.06 : 0)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

#Preview {
    let d = { (l: String, dir: KPITile.Delta.Direction) in KPITile.Delta(label: l, dir: dir) }
    let mock: [KPITile] = [
        KPITile(key: .hrv, label: "HRV", value: 62, unit: "ms", precision: 0,
                delta: d("↑ 4 ms vs yesterday", .up), href: .recovery, colorHex: "#7b61ff"),
        KPITile(key: .rhr, label: "RHR", value: 48, unit: "bpm", precision: 0,
                delta: d("↑ 2 bpm vs yesterday", .down), href: .recovery, colorHex: "#ff6b6b"),
        KPITile(key: .sleep, label: "Sleep", value: 7.4, unit: "h", precision: 1,
                delta: d("↓ 0.6h vs yesterday", .down), href: .sleep, colorHex: "#00d4aa"),
        KPITile(key: .strain, label: "Strain", value: 9.2, unit: "", precision: 1,
                delta: nil, href: .strain, colorHex: "#ffaa00"),
        KPITile(key: .spo2, label: "SpO2", value: 96.1, unit: "%", precision: 1,
                delta: d("↑ 0.2% vs yesterday", .up), href: .recovery, colorHex: "#00d4aa"),
        KPITile(key: .steps, label: "Steps", value: 8423, unit: "", precision: 0,
                delta: d("↑ 1204 vs yesterday", .up), href: .steps, colorHex: "#5ac8fa")
    ]
    return ZStack {
        Color.black
        KPIStripView(tiles: mock) { _ in }.padding()
    }
    .preferredColorScheme(.dark)
}
