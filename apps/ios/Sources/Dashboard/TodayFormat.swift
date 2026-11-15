import Foundation
import SwiftUI

/// Pure text rules for the Today screen, kept apart from the views so they can
/// be tested.
enum TodayFormat {
    /// One freshness line: "Saturday, Nov 14 · Synced 8:21 AM". A fallback
    /// payload says so instead of presenting an old day as today.
    static func freshness(dataDate: String?, updatedAt: String?, isFallback: Bool,
                          now: Date = Date(), calendar: Calendar = .current) -> String? {
        guard let dataDate, let date = ChartDate.parse(dataDate) else { return nil }
        let synced = syncedText(updatedAt, now: now, calendar: calendar)
        if isFallback {
            let short = date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            return ["No reading for today · latest \(short)", synced].compactMap { $0 }.joined(separator: " · ")
        }
        let day = date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
        return [day, synced].compactMap { $0 }.joined(separator: " · ")
    }

    static func syncedText(_ updatedAt: String?, now: Date = Date(), calendar: Calendar = .current) -> String? {
        guard let date = InsightDate.parse(updatedAt) else { return nil }
        if calendar.isDate(date, inSameDayAs: now) {
            return "Synced " + date.formatted(date: .omitted, time: .shortened)
        }
        return "Synced " + date.formatted(.dateTime.month(.abbreviated).day())
    }

    /// Signed change encoded in a delta label such as "↓ 8211 vs yesterday".
    /// The arrow glyph is the truth here, not the improvement signal in `dir`.
    static func signedAmount(of label: String) -> Double? {
        let trimmed = label.trimmingCharacters(in: .whitespaces)
        guard let first = trimmed.first, first == "↑" || first == "↓" else { return nil }
        let body = trimmed.dropFirst().drop { $0 == " " }
        let digits = body.prefix { $0.isNumber || $0 == "." || $0 == "," }
        guard let magnitude = Double(digits.replacingOccurrences(of: ",", with: "")) else { return nil }
        return first == "↑" ? magnitude : -magnitude
    }

    /// Metrics that are still accumulating: the ones whose own latest reading
    /// is dated today. Each metric is judged by its own date; the dashboard's
    /// recovery date says nothing about steps or strain.
    static func partialKeys(metricDates: [KPITile.Key: String], isFallback: Bool, now: Date = Date()) -> Set<KPITile.Key> {
        guard !isFallback else { return [] }
        let today = ChartDate.key(now)
        return Set(metricDates.filter { $0.key.accumulatesDuringDay && $0.value == today }.map(\.key))
    }

    /// Text for a metric that is still accumulating.
    ///
    /// - "so far · 14.6 yesterday" when the delta is an actual comparison with
    ///   the previous calendar day; yesterday's value is derived from today's
    ///   value and the change.
    /// - "so far" when there is no comparison to show.
    /// - nil when the delta compares against some other day (e.g. "vs 6 days
    ///   ago"); the caller then keeps the real delta and its context rather
    ///   than mislabeling it as yesterday.
    static func soFar(value: Double?, deltaLabel: String?, precision: Int) -> String? {
        guard let value, let deltaLabel else { return "so far" }
        guard let change = signedAmount(of: deltaLabel) else { return "so far" }
        let context = KPIDeltaText(.init(label: deltaLabel, dir: .flat)).context
        guard context == "vs yesterday" else { return nil }
        let yesterday = max(0, value - change)
        let text = yesterday.formatted(.number.precision(.fractionLength(precision)).locale(Locale(identifier: "en_US")))
        return "so far · \(text) yesterday"
    }
}

extension KPITile.Key {
    /// Metrics that are still accumulating while the day is in progress.
    var accumulatesDuringDay: Bool { self == .strain || self == .steps }

    /// Palette color for the small marker; the label always carries the meaning.
    var accent: Color {
        switch self {
        case .recovery: return Theme.Palette.recovery
        case .hrv: return Theme.Palette.hrv
        case .rhr: return Theme.Palette.rhr
        case .sleep: return Theme.Palette.sleepDeep
        case .strain: return Theme.Palette.strain
        case .steps: return Theme.Palette.steps
        case .spo2: return Theme.Palette.spo2
        }
    }
}
