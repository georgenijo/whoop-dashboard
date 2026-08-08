import SwiftUI

enum RecoveryZone {
    case compromised
    case adequate
    case primed

    init(score: Double) {
        switch score {
        case ..<34: self = .compromised
        case ..<67: self = .adequate
        default: self = .primed
        }
    }

    var color: Color {
        switch self {
        case .compromised: return Theme.Palette.zoneRed
        case .adequate: return Theme.Palette.zoneYellow
        case .primed: return Theme.Palette.zoneGreen
        }
    }

    var label: String {
        switch self {
        case .compromised: return "Compromised"
        case .adequate: return "Adequate"
        case .primed: return "Primed"
        }
    }

    var guidance: String {
        switch self {
        case .compromised: return "Recovery's low. Keep today easy — rest or active recovery."
        case .adequate: return "Recovery's moderate. A steady session is a good call."
        case .primed: return "You're recovered. A good day to push strain."
        }
    }
}

struct ZonePill: View {
    let score: Double
    var prefix: String?

    var body: some View {
        let zone = RecoveryZone(score: score)
        let color = zone.color
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 5, height: 5)
            Text((prefix.map { "\($0) · " } ?? "") + zone.label.uppercased())
                .font(Theme.FontStyle.sans(10.5, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(color)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(color.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
    }
}
