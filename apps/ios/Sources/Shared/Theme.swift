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
        static let fg3 = Color(hex: "#6b6b74")
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
