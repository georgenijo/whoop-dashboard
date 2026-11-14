import SwiftUI

/// Three recovery bands with a pin at the score and labeled ranges, so the
/// zone is stated in words and position, never by color alone.
struct ZoneScale: View {
    let score: Double
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    static let zones: [RecoveryZone] = [.compromised, .adequate, .primed]

    /// Relative width of each band: 0–33, 34–66, 67–100.
    static let bandWeights: [Double] = [34, 33, 34]

    /// 0...1 position of the pin along the full 0–100 scale.
    static func pinFraction(_ score: Double) -> Double {
        min(max(score / 100, 0), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                let gap: CGFloat = 4
                let usable = geo.size.width - gap * 2
                let total = Self.bandWeights.reduce(0, +)
                HStack(spacing: gap) {
                    ForEach(0..<3, id: \.self) { i in
                        Rectangle()
                            .fill(Self.zones[i].color.opacity(0.62))
                            .frame(width: usable * Self.bandWeights[i] / total, height: 4)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .center)
                Rectangle()
                    .fill(Theme.Palette.fg0)
                    .frame(width: 3, height: 16)
                    .offset(x: max(0, min(geo.size.width - 3, geo.size.width * Self.pinFraction(score) - 1.5)))
                    .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(height: 16)
            .accessibilityHidden(true)

            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(0..<3, id: \.self) { i in label(i, alignment: .leading) }
                }
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        label(0, alignment: .leading).fixedSize()
                        label(1, alignment: .center)
                        label(2, alignment: .trailing).fixedSize()
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        label(0, alignment: .leading, showsName: false)
                        label(1, alignment: .center, showsName: false)
                        label(2, alignment: .trailing, showsName: false)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Recovery scale")
        .accessibilityValue("Score \(Int(score.rounded())). Low 0 to 33, moderate 34 to 66, high 67 to 100.")
    }

    private func label(_ i: Int, alignment: Alignment, showsName: Bool = true) -> some View {
        let zone = Self.zones[i]
        return Text(showsName ? "\(zone.bandName) · \(zone.bandRange)" : zone.bandRange)
            .font(Theme.FontStyle.mono(11))
            .foregroundStyle(Theme.Palette.fg2)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: alignment)
    }
}
