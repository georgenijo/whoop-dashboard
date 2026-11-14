import Foundation

/// One formatter set per decoder, rather than three allocations per date.
/// JSONDecoder owns this closure; concurrent clients never share mutable
/// formatters. DateFormatter and ISO8601DateFormatter support concurrent reads.
enum APIDateDecoding {
    static func strategy() -> JSONDecoder.DateDecodingStrategy {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        let sqlite = DateFormatter()
        sqlite.calendar = Calendar(identifier: .gregorian)
        sqlite.locale = Locale(identifier: "en_US_POSIX")
        sqlite.timeZone = TimeZone(secondsFromGMT: 0)
        sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            let date: Date?
            if raw.contains("T") {
                date = fractional.date(from: raw) ?? plain.date(from: raw)
            } else {
                date = sqlite.date(from: raw)
            }
            guard let date else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognized API timestamp")
            }
            return date
        }
    }
}
