import SwiftUI

extension Color {
    init(hex: String) {
        let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let canonical = Self.quietInstrumentHex(for: cleaned.lowercased())
        guard canonical.count == 6,
              let value = UInt64(canonical, radix: 16) else {
            self = .gray
            return
        }
        let r = Double((value >> 16) & 0xff) / 255.0
        let g = Double((value >> 8) & 0xff) / 255.0
        let b = Double(value & 0xff) / 255.0
        self = Color(red: r, green: g, blue: b)
    }

    /// API payloads and saved plans can still contain colors from the former
    /// high-chroma theme. Translate those known values at the rendering edge
    /// so existing data adopts Quiet Instrument without changing its schema.
    private static func quietInstrumentHex(for value: String) -> String {
        switch value {
        case "000000": return "171614"
        case "0a0a0b": return "12100f"
        case "121214", "1a1a1e": return "211f1d"
        case "242429": return "32302e"
        case "ffffff": return "f4f1ee"
        case "e7e7ea": return "e0ddda"
        case "a1a1aa": return "b3b0ae"
        case "6b6b74", "666666": return "8b8985"
        case "3f3f46": return "32302e"
        case "ff0043": return "df6862"
        case "cc0036", "ff4444", "ff0000": return "e8777d"
        case "00d4aa": return "71bd9d"
        case "7b61ff", "8b6fff", "6a4dff", "b7a8ff": return "b2a0d6"
        case "ff6b6b", "ff7abf", "c2185b": return "cb8eb6"
        case "ffaa00", "ffd166", "ff8800": return "cfb070"
        case "0055ff": return "83a7d6"
        case "00aaff": return "83bdc3"
        default: return value
        }
    }
}
