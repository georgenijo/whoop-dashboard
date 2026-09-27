import SwiftUI

/// The latest contributing signals. The score itself lives only in the hero
/// chart above; this card explains it.
struct RecoveryFactorsCardView: View {
    let factors: [Factor]

    struct Factor: Identifiable {
        let label: String
        let value: String
        let delta: String?
        let direction: Direction
        let color: Color
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
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            TrendsCardLabel("Latest signals", trailing: "vs previous")
            VStack(spacing: 0) {
                ForEach(factors) { factor in
                    row(factor)
                    if factor.id != factors.last?.id {
                        Rectangle()
                            .fill(Theme.Palette.borderSubtle)
                            .frame(height: 1)
                    }
                }
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private func row(_ factor: Factor) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Circle()
                .fill(factor.color)
                .frame(width: 7, height: 7)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 5 }
            Text(factor.label)
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg1)
            Spacer(minLength: 8)
            Text(factor.value)
                .font(Theme.FontStyle.mono(15, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
            Text(factor.delta ?? "—")
                .font(Theme.FontStyle.mono(11))
                .foregroundStyle(color(factor.direction))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(width: 138, alignment: .trailing)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private func color(_ direction: Factor.Direction) -> Color {
        switch direction {
        case .better: return Theme.Palette.success
        case .worse: return Theme.Palette.danger
        case .flat: return Theme.Palette.fg3
        }
    }
}
