import Foundation

enum DateRange: String, CaseIterable, Identifiable {
    case d7 = "7d"
    case d14 = "14d"
    case d30 = "30d"
    case d90 = "90d"

    var id: String { rawValue }
    var label: String { rawValue }
    var days: Int {
        switch self {
        case .d7: return 7
        case .d14: return 14
        case .d30: return 30
        case .d90: return 90
        }
    }
}
