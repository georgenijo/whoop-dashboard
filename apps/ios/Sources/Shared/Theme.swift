import SwiftUI

enum Theme {
    enum Palette {
        // Quiet Instrument neutrals: barely-warm charcoal, deliberately below
        // maximum contrast. These values are sRGB conversions of the web
        // design system's canonical OKLCH tokens.
        static let bg = Color(hex: "#171614")
        static let bgSunk = Color(hex: "#12100f")
        static let bgLift = Color(hex: "#211f1d")
        static let fg = Color(hex: "#e0ddda")
        static let fgHi = Color(hex: "#f4f1ee")
        static let fg2 = Color(hex: "#b3b0ae")
        static let fg3 = Color(hex: "#8b8985")
        static let rule = Color(hex: "#32302e")
        static let ruleSoft = Color(hex: "#23211f")

        // Brand is reserved for the product mark, focus, and primary actions.
        static let brand = Color(hex: "#df6862")

        // State.
        static let ok = Color(hex: "#6fbe95")
        static let warn = Color(hex: "#e0b771")
        static let bad = Color(hex: "#e8777d")

        // Data colors stay metric-specific and intentionally low-chroma.
        static let recovery = Color(hex: "#71bd9d")
        static let strain = Color(hex: "#cfb070")
        static let sleepDeep = Color(hex: "#83a7d6")
        static let hrv = Color(hex: "#b2a0d6")
        static let rhr = Color(hex: "#cb8eb6")
        static let spo2 = Color(hex: "#83bdc3")
        static let sleepRem = hrv
        static let sleepLight = recovery
        static let respiration = spo2
        static let skinTemp = strain

        static let zoneRed = bad
        static let zoneYellow = warn
        static let zoneGreen = ok

        static let hrZone0 = fg3
        static let hrZone1 = recovery
        static let hrZone2 = spo2
        static let hrZone3 = strain
        static let hrZone4 = rhr
        static let hrZone5 = bad

        static let success = ok
        static let warning = warn
        static let danger = bad
        static let info = spo2
        static let ai = hrv

        // Compatibility aliases keep existing feature views working while
        // they move onto the semantic Quiet Instrument vocabulary.
        static let bg0 = bg
        static let bg1 = bgSunk
        static let bg2 = bgLift
        static let bg3 = bgLift
        static let bg4 = rule
        static let fg0 = fgHi
        static let fg1 = fg
        static let fg4 = rule
        static let borderSubtle = ruleSoft
        static let borderDefault = rule
        static let borderStrong = fg3
        static let brandStrain = brand
        static let brandStrainDim = bad
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

    enum FontStyle {
        static func display(_ size: CGFloat, weight: Weight = .semibold) -> Font {
            Font.custom(weight.sans, size: size)
        }
        static func sans(_ size: CGFloat, weight: Weight = .regular) -> Font {
            Font.custom(weight.sans, size: size)
        }
        static func mono(_ size: CGFloat, weight: Weight = .regular) -> Font {
            Font.custom(weight.mono, size: size)
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
        static let lg: CGFloat = 24
        static let xl: CGFloat = 36
        static let xxl: CGFloat = 56
    }

    enum Radius {
        static let sm: CGFloat = 3
        static let md: CGFloat = 6
        static let lg: CGFloat = 6
        static let xl: CGFloat = 6
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
