import SwiftUI

enum Theme {
    enum Palette {
        static let bg0 = Color(hex: "#000000")
        static let bg1 = Color(hex: "#0a0a0b")
        static let bg2 = Color(hex: "#121214")
        static let bg3 = Color(hex: "#1a1a1e")
        static let bg4 = Color(hex: "#242429")

        static let fg0 = Color(hex: "#ffffff")
        static let fg1 = Color(hex: "#e7e7ea")
        static let fg2 = Color(hex: "#a1a1aa")
        /// Tertiary text. #8e8e98 keeps 5.8:1 on cards (bg2) and 4.8:1 on the
        /// lightest surface (bg4); the old #6b6b74 sat at 3.0–3.6:1, below the
        /// 4.5:1 floor for small text.
        static let fg3 = Color(hex: "#8e8e98")
        static let fg4 = Color(hex: "#3f3f46")

        static let borderSubtle = Color.white.opacity(0.06)
        static let borderDefault = Color.white.opacity(0.10)
        static let borderStrong = Color.white.opacity(0.18)

        static let brandStrain = Color(hex: "#ff0043")
        static let brandStrainDim = Color(hex: "#cc0036")

        static let recovery = Color(hex: "#00d4aa")
        static let hrv = Color(hex: "#7b61ff")
        static let rhr = Color(hex: "#ff6b6b")
        static let strain = Color(hex: "#ffaa00")
        static let sleepDeep = Color(hex: "#0055ff")
        static let sleepRem = Color(hex: "#7b61ff")
        static let sleepLight = Color(hex: "#00d4aa")
        static let respiration = Color(hex: "#00aaff")
        static let spo2 = Color(hex: "#00d4aa")
        static let skinTemp = Color(hex: "#ffaa00")

        static let zoneRed = Color(hex: "#ff4444")
        static let zoneYellow = Color(hex: "#ffaa00")
        static let zoneGreen = Color(hex: "#00d4aa")

        static let hrZone0 = Color(hex: "#666666")
        static let hrZone1 = Color(hex: "#00d4aa")
        static let hrZone2 = Color(hex: "#00aaff")
        static let hrZone3 = Color(hex: "#ffaa00")
        static let hrZone4 = Color(hex: "#ff6b6b")
        static let hrZone5 = Color(hex: "#ff0000")

        static let success = Color(hex: "#00d4aa")
        static let warning = Color(hex: "#ffaa00")
        static let danger = Color(hex: "#ff4444")
        static let info = Color(hex: "#00aaff")
        static let ai = Color(hex: "#7b61ff")
    }

    enum Typeface {
        static let sansRegular = "Geist-Regular"
        static let sansMedium = "Geist-Medium"
        static let sansSemibold = "Geist-SemiBold"
        static let sansBold = "Geist-Bold"
        static let monoRegular = "GeistMono-Regular"
        static let monoMedium = "GeistMono-Medium"
        static let monoSemibold = "GeistMono-SemiBold"
    }

    /// Every text style resolves through here, so readability is decided in
    /// one place. Call sites still pass the size they were designed at; that
    /// design size is mapped onto a scale that never drops below 12 pt and
    /// sits 2 pt above the original small sizes (11 → 13, 13 → 15, 15 → 17),
    /// which keeps the relative hierarchy while clearing the HIG minimums.
    /// Display sizes (above 24 pt) are left as designed. All fonts scale with
    /// Dynamic Type.
    ///
    /// `mono` no longer means a monospaced face: data labels render in Geist
    /// with tabular figures, so digits still line up in columns without the
    /// wide, gappy letterforms of Geist Mono. Use `code` for real code.
    enum FontStyle {
        static func display(_ size: CGFloat, weight: Weight = .semibold) -> Font {
            Font.custom(weight.sans, size: readable(size), relativeTo: textStyle(for: size))
        }
        static func sans(_ size: CGFloat, weight: Weight = .regular) -> Font {
            Font.custom(weight.sans, size: readable(size), relativeTo: textStyle(for: size))
        }
        static func mono(_ size: CGFloat, weight: Weight = .regular) -> Font {
            Font.custom(weight.sans, size: readable(size), relativeTo: textStyle(for: size))
                .monospacedDigit()
        }
        /// Monospaced face for code spans and code blocks only.
        static func code(_ size: CGFloat, weight: Weight = .regular) -> Font {
            Font.custom(weight.mono, size: readable(size), relativeTo: .footnote)
        }

        static let minimumSize: CGFloat = 12

        static func readable(_ size: CGFloat) -> CGFloat {
            size > 24 ? size : max(minimumSize, size + 2)
        }

        /// Dynamic Type curve to follow: big numbers grow like titles, small
        /// labels like captions, so the largest accessibility sizes don't blow
        /// a 64 pt score up at body-text rates.
        static func textStyle(for size: CGFloat) -> Font.TextStyle {
            switch size {
            case ..<11: return .caption
            case ..<13: return .footnote
            case ..<15: return .subheadline
            case ..<18: return .body
            case ..<24: return .title3
            case ..<34: return .title
            default: return .largeTitle
            }
        }

        enum Weight {
            case regular, medium, semibold, bold

            var sans: String {
                switch self {
                case .regular: return Typeface.sansRegular
                case .medium: return Typeface.sansMedium
                case .semibold: return Typeface.sansSemibold
                case .bold: return Typeface.sansBold
                }
            }
            var mono: String {
                switch self {
                case .regular: return Typeface.monoRegular
                case .medium: return Typeface.monoMedium
                case .semibold, .bold: return Typeface.monoSemibold
                }
            }
        }
    }

    enum Spacing {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 20
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    enum Radius {
        static let sm: CGFloat = 4
        static let md: CGFloat = 8
        static let lg: CGFloat = 12
        static let xl: CGFloat = 16
        static let pill: CGFloat = 9999
    }
}

extension View {
    func displayFont(_ size: CGFloat, weight: Theme.FontStyle.Weight = .semibold) -> some View {
        font(Theme.FontStyle.display(size, weight: weight))
    }
    func sansFont(_ size: CGFloat, weight: Theme.FontStyle.Weight = .regular) -> some View {
        font(Theme.FontStyle.sans(size, weight: weight))
    }
    func monoFont(_ size: CGFloat, weight: Theme.FontStyle.Weight = .regular) -> some View {
        font(Theme.FontStyle.mono(size, weight: weight))
    }
}
