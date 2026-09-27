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
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func parse(_ string: String) -> Date? {
        formatter.date(from: string)
    }

    static func key(_ date: Date) -> String {
        formatter.string(from: date)
    }
}
