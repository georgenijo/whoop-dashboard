import Foundation

struct KPITile: Decodable, Identifiable, Hashable {
    let key: Key
    let label: String
    let value: Double?
    let unit: String
    let precision: Int
    let delta: Delta?
    let href: Href
    let colorHex: String

    enum Key: String, Decodable {
        case recovery, hrv, rhr, sleep, strain, spo2
    }

    enum Href: String, Decodable {
        case recovery = "/recovery"
        case sleep = "/sleep"
        case strain = "/strain"
    }

    struct Delta: Decodable, Hashable {
        let label: String
        let dir: Direction

        enum Direction: String, Decodable {
            case up, down, flat
        }
    }

    enum CodingKeys: String, CodingKey {
        case key, label, value, unit, precision, delta, href
        case colorHex = "color_hex"
    }

    var id: String { key.rawValue }
}
