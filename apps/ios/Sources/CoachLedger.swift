import SwiftUI

/// Ruled-group primitives for Coach, Plans and Settings. Groups carry a
/// `borderDefault` outline; rows inside them are separated by a rule that is
/// still visible on OLED black (`borderSubtle` is about 1.2:1 there).
enum CoachLedger {
    static let rule = Color(uiColor: UIColor { traits in
        UIColor(Color(hex: traits.userInterfaceStyle == .dark ? "#2A2622" : "#E8E4DF"))
    })
}

extension View {
    /// Square group outline.
    func coachLedgerOutline() -> some View {
        background(Theme.Palette.bg0)
            .overlay(Rectangle().strokeBorder(Theme.Palette.borderDefault, lineWidth: 1))
    }
}

struct LedgerRule: View {
    var body: some View {
        Rectangle().fill(CoachLedger.rule).frame(height: 1)
    }
}

/// Small sentence-case label above a group.
struct LedgerLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(Theme.FontStyle.sans(13, weight: .medium))
            .foregroundStyle(Theme.Palette.fg2)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Outlined square icon used at the leading edge of ledger rows.
struct LedgerIcon: View {
    let systemName: String
    var tint: Color = Theme.Palette.fg1

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: 32, height: 32)
            .overlay(Rectangle().strokeBorder(Theme.Palette.borderDefault, lineWidth: 1))
            .accessibilityHidden(true)
    }
}
