import SwiftUI
import UIKit

enum Theme {
    enum Palette {
        /// Semantic colors resolve with the system appearance. Surfaces are
        /// opaque: no blur or layered gradients are needed to read the data.
        private static func adaptive(_ light: String, _ dark: String) -> Color {
            Color(uiColor: UIColor { traits in
                UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
            })
        }

        // Fleet Warehouse's neutral canvas and warm utility text. Health
        // signals stay separate from the brown navigation/action accent.
        static let bg0 = adaptive("#FFFFFF", "#000000")
        static let bg1 = bg0
        static let bg2 = adaptive("#F8F6F3", "#0D0B0A")
        static let bg3 = adaptive("#F1EEEA", "#141210")
        static let bg4 = adaptive("#E8E4DF", "#211D19")
        static let fg0 = adaptive("#20201E", "#FFFFFF")
        static let fg1 = adaptive("#393632", "#D8D3CE")
        static let fg2 = adaptive("#625D57", "#AAA39D")
        static let fg3 = adaptive("#6A645F", "#A29B95")
        // Quiet text still carries information and meets the body-text target.
        static let fg4 = fg3
        static let borderSubtle = adaptive("#E8E4DF", "#1C1A18")
        static let borderDefault = adaptive("#CCC5BE", "#36312D")
        static let borderStrong = adaptive("#9C8B7E", "#75675C")
        static let accent = adaptive("#806047", "#C5AC98")
        static let composerSurface = adaptive("#F8F6F3", "#222220")
        static let brandStrain = adaptive("#A62F4A", "#F19AAC")
        static let brandStrainDim = brandStrain
        static let recovery = adaptive("#176E5C", "#74C9AF")
        static let hrv = adaptive("#6551A8", "#BEADF1")
        static let rhr = adaptive("#A43838", "#F2A09A")
        static let strain = adaptive("#8A5717", "#E4B876")
        static let sleepDeep = adaptive("#285C9D", "#91B9EF")
        static let sleepRem = hrv
        static let sleepLight = recovery
        static let respiration = adaptive("#246784", "#8AC8E2")
        static let spo2 = recovery
        static let skinTemp = strain
        static let zoneRed = rhr
        static let zoneYellow = strain
        static let zoneGreen = recovery
        static let hrZone0 = fg3
        static let hrZone1 = recovery
        static let hrZone2 = respiration
        static let hrZone3 = strain
        static let hrZone4 = rhr
        static let hrZone5 = adaptive("#96283B", "#ED7890")
        static let success = recovery
        static let warning = strain
        static let danger = rhr
        static let info = respiration
        static let ai = hrv
    }

    enum Typeface {
        static let sansRegular = "DMSans-Regular"
        static let sansMedium = "DMSans-Medium"
        static let sansSemibold = "DMSans-SemiBold"
        static let sansBold = "DMSans-Bold"
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
    /// `mono` uses DM Sans for data labels
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
