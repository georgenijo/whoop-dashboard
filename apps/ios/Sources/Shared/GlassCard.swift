import SwiftUI

enum GlassTint {
    case neutral
    case recovery
    case strain
    case sleep
    case ai

    var border: Color {
        switch self {
        case .neutral: return Theme.Palette.borderSubtle
        case .recovery: return Color(hex: "#00d4aa").opacity(0.22)
        case .strain: return Color(hex: "#ffaa00").opacity(0.22)
        case .sleep: return Color(hex: "#0055ff").opacity(0.28)
        case .ai: return Color(hex: "#7b61ff").opacity(0.3)
        }
    }

    var accent: Color? {
        switch self {
        case .neutral: return nil
        case .recovery: return Color(hex: "#00d4aa")
        case .strain: return Color(hex: "#ffaa00")
        case .sleep: return Color(hex: "#0055ff")
        case .ai: return Color(hex: "#7b61ff")
        }
    }
}

struct GlassCardModifier: ViewModifier {
    let tint: GlassTint
    let padding: CGFloat
    let radius: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(background)
            .overlay(
                RoundedRectangle(cornerRadius: radius)
                    .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: radius))
    }

    private var background: some View {
        Theme.Palette.bg0
    }

}

extension View {
    func glassCard(
        tint: GlassTint = .neutral,
        padding: CGFloat = Theme.Spacing.md,
        radius: CGFloat = 0
    ) -> some View {
        modifier(GlassCardModifier(tint: tint, padding: padding, radius: radius))
    }
}
