import Foundation

/// Backend days are calendar dates ("yyyy-MM-dd"), not instants. Parse them
/// as local midnight so Swift Charts' axis and readout formatters — which use
/// the device time zone — print the same day the backend meant. Parsing as UTC
/// labelled every point one day early anywhere west of Greenwich.
enum ChartDate {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    // Re-read the zone on every call: a formatter that captured `.current`
    // once would keep parsing in the old zone after the device changes zones,
    // while display formatters follow the new one.
    static func parse(_ string: String) -> Date? {
        formatter.timeZone = .current
        return formatter.date(from: string)
    }

    static func key(_ date: Date) -> String {
        formatter.timeZone = .current
        return formatter.string(from: date)
    }
}
