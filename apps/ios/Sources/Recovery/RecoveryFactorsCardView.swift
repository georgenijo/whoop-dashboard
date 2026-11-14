import SwiftUI

/// "What moved it": the latest contributing signals as a Signal / Today /
/// Change table. Changes are neutral arrows with the 30-day average beneath;
/// direction is not a verdict, so nothing is colored green or red.
struct RecoveryFactorsCardView: View {
    let factors: [Factor]
    var embedded = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    struct Factor: Identifiable {
        let label: String
        let value: String
        let delta: String?
        let direction: Direction
        let color: Color
        var unit: String = ""
        var average: String? = nil
        var id: String { label }

        enum Direction {
            case better, worse, flat

            /// The API's `dir` is already the improvement signal: it reverses
            /// lower-is-better metrics (RHR) server-side, so no inversion here.
            init(api dir: KPITile.Delta.Direction?) {
                switch dir {
                case .up: self = .better
                case .down: self = .worse
                case .flat, .none: self = .flat
                }
            }
        }

        var spoken: String {
            var parts = ["\(value) \(unit)".trimmingCharacters(in: .whitespaces)]
            if let delta { parts.append("change " + delta.replacingOccurrences(of: "↑", with: "up").replacingOccurrences(of: "↓", with: "down")) }
            if let average { parts.append("average \(average)") }
            return parts.joined(separator: ", ")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            LedgerHeader(title: "What moved it", subtitle: "change vs previous · 30-day average")
            if !dynamicTypeSize.isAccessibilitySize {
                columnHeader
            }
            VStack(spacing: 0) {
                ForEach(factors) { factor in
                    LedgerRule()
                    row(factor)
                }
            }
        }
        .cardChrome(embedded: embedded, padding: 0)
    }

    private var columnHeader: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Text("Signal").frame(maxWidth: .infinity, alignment: .leading)
            Text("Today")
            Text("Change").frame(minWidth: 64, alignment: .trailing)
        }
        .font(Theme.FontStyle.sans(13))
        .foregroundStyle(Theme.Palette.fg3)
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.bottom, 6)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func row(_ factor: Factor) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .center, spacing: Theme.Spacing.sm))
        layout {
            HStack(spacing: 8) {
                Rectangle().fill(factor.color).frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                Text(factor.label)
                    .font(Theme.FontStyle.sans(17))
                    .foregroundStyle(Theme.Palette.fg0)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(factor.value)
                    .font(Theme.FontStyle.mono(17, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                if !factor.unit.isEmpty {
                    Text(factor.unit)
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg2)
                }
            }
            .fixedSize()

            VStack(alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing, spacing: 2) {
                Text(factor.delta ?? "—")
                    .font(Theme.FontStyle.mono(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg1)
                if let average = factor.average {
                    Text("avg \(average)")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            .fixedSize()
            .frame(minWidth: dynamicTypeSize.isAccessibilitySize ? 0 : 64,
                   alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(factor.label)
        .accessibilityValue(factor.spoken)
    }
}
