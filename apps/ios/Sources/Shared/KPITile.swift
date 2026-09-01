import Foundation

struct KPITile: Decodable, Identifiable, Hashable {
    let key: Key
    let label: String
    let value: Double?
    let unit: String
    let precision: Int
    let delta: Delta?
    let href: Href?
    let colorHex: String

    enum Key: String, Decodable {
        case recovery, hrv, rhr, sleep, strain, spo2, steps
    }

    enum Href: String, Decodable, Hashable {
        case recovery = "/recovery"
        case sleep = "/sleep"
        case strain = "/strain"
        case steps = "/steps"
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

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(Key.self, forKey: .key)
        label = try c.decode(String.self, forKey: .label)
        value = try c.decodeIfPresent(Double.self, forKey: .value)
        unit = try c.decode(String.self, forKey: .unit)
        precision = try c.decode(Int.self, forKey: .precision)
        delta = try c.decodeIfPresent(Delta.self, forKey: .delta)
        colorHex = try c.decode(String.self, forKey: .colorHex)
        if let raw = try c.decodeIfPresent(String.self, forKey: .href) {
            href = Href(rawValue: raw)
        } else {
            href = nil
        }
    }

    init(key: Key, label: String, value: Double?, unit: String, precision: Int,
         delta: Delta?, href: Href?, colorHex: String) {
        self.key = key
        self.label = label
        self.value = value
        self.unit = unit
        self.precision = precision
        self.delta = delta
        self.href = href
        self.colorHex = colorHex
    }

    var id: String { key.rawValue }
}
