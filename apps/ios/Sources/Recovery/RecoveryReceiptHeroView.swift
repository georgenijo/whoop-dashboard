import SwiftUI

struct RecoveryReceiptHeroView: View {
    let score: Double?
    let timestampLabel: String
    let factors: [Factor]

    struct Factor: Identifiable {
        let id = UUID()
        let label: String
        let value: String
        let delta: String?
        let direction: Direction
        let color: Color

        enum Direction { case up, down, flat, neutral }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("RECOVERY SCORE")
                        .font(Theme.FontStyle.sans(10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg2)
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        if let score {
                            Text("\(Int(score.rounded()))")
                                .font(Theme.FontStyle.display(56, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg0)
                                .monospacedDigit()
                        } else {
                            Text("—")
                                .font(Theme.FontStyle.display(56, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg2)
                        }
                        Text("%")
                            .font(Theme.FontStyle.display(18))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
                Spacer()
                Text(timestampLabel.uppercased())
                    .font(Theme.FontStyle.mono(10))
                    .tracking(1.0)
                    .foregroundStyle(Theme.Palette.fg3)
            }
            .padding(.bottom, 12)

            DashedDivider()

            VStack(spacing: 8) {
                ForEach(factors) { factor in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        HStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 1)
                                .fill(factor.color)
                                .frame(width: 5, height: 5)
                            Text(factor.label)
                                .font(Theme.FontStyle.mono(12))
                                .foregroundStyle(Theme.Palette.fg1)
                        }
                        Spacer()
                        Text(factor.value)
                            .font(Theme.FontStyle.mono(11.5))
                            .foregroundStyle(Theme.Palette.fg3)
                        if let delta = factor.delta {
                            Text(delta)
                                .font(Theme.FontStyle.mono(11.5, weight: .semibold))
                                .foregroundStyle(deltaColor(factor.direction))
                                .frame(minWidth: 50, alignment: .trailing)
                        } else {
                            Text("—")
                                .font(Theme.FontStyle.mono(11.5))
                                .foregroundStyle(Theme.Palette.fg3)
                                .frame(minWidth: 50, alignment: .trailing)
                        }
                    }
                }
            }
            .padding(.vertical, 14)

            DashedDivider()

            HStack {
                Text("Status")
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                Text(statusLabel.uppercased())
                    .font(Theme.FontStyle.mono(11, weight: .semibold))
                    .foregroundStyle(statusColor)
            }
            .padding(.top, 12)
        }
        .glassCard(tint: .recovery, padding: Theme.Spacing.md)
    }

    private func deltaColor(_ dir: Factor.Direction) -> Color {
        switch dir {
        case .up: return Theme.Palette.success
        case .down: return Theme.Palette.danger
        case .flat: return Theme.Palette.fg3
        case .neutral: return Theme.Palette.fg2
        }
    }

    private var statusLabel: String {
        guard let s = score else { return "—" }
        switch s {
        case ..<34: return "Compromised"
        case ..<67: return "Adequate"
        default: return "Primed"
        }
    }

    private var statusColor: Color {
        guard let s = score else { return Theme.Palette.fg3 }
        switch s {
        case ..<34: return Theme.Palette.zoneRed
        case ..<67: return Theme.Palette.zoneYellow
        default: return Theme.Palette.zoneGreen
        }
    }
}

private struct DashedDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.clear)
            .frame(height: 1)
            .overlay(
                Line()
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                    .foregroundStyle(Theme.Palette.borderDefault)
            )
    }
}

private struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return p
    }
}
