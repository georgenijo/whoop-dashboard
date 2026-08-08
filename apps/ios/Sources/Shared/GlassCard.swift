import SwiftUI

enum GlassTint {
    case neutral
    case recovery
    case strain
    case sleep
    case ai

    var border: Color {
        Theme.Palette.rule
    }
}

struct GlassCardModifier: ViewModifier {
    let tint: GlassTint
    let padding: CGFloat
    let radius: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Theme.Palette.bgLift)
            .overlay(
                RoundedRectangle(cornerRadius: radius)
                    .strokeBorder(tint.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: radius))
    }

}

extension View {
    func glassCard(
        tint: GlassTint = .neutral,
        padding: CGFloat = Theme.Spacing.md,
        radius: CGFloat = Theme.Radius.xl
    ) -> some View {
        modifier(GlassCardModifier(tint: tint, padding: padding, radius: radius))
    }
}
