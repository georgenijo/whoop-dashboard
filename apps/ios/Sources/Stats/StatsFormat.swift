import SwiftUI

enum StatsFormat {
    private static let metersPerMile = 1609.344
    private static let kilojoulesPerKcal = 4.184

    static func grouped(_ n: Double) -> String {
        n.formatted(.number.precision(.fractionLength(0)).locale(Locale(identifier: "en_US")))
    }

    static func number(_ v: Double) -> String {
        if abs(v) >= 100 || v.rounded() == v { return grouped(v) }
        return v.formatted(.number.precision(.fractionLength(1)).locale(Locale(identifier: "en_US")))
    }

    /// Short form for big values in narrow columns: 55,327 -> "55.3k", 221,646 -> "222k".
    static func compact(_ v: Double) -> String {
        let a = abs(v)
        let posix = Locale(identifier: "en_US")
        if a >= 1_000_000 { return (v / 1_000_000).formatted(.number.precision(.fractionLength(1)).locale(posix)) + "M" }
        if a >= 100_000 { return (v / 1000).formatted(.number.precision(.fractionLength(0)).locale(posix)) + "k" }
        if a >= 10_000 { return (v / 1000).formatted(.number.precision(.fractionLength(1)).locale(posix)) + "k" }
        return number(v)
    }

    static func hours(seconds: Double?) -> String {
        guard let seconds else { return "—" }
        return number(seconds / 3600 >= 10 ? (seconds / 3600).rounded() : seconds / 3600)
    }

    static func miles(meters: Double?) -> String {
        guard let meters else { return "—" }
        let mi = meters / metersPerMile
        return number(mi >= 100 ? mi.rounded() : mi)
    }

    static func calories(kilojoules: Double?) -> String {
        guard let kilojoules else { return "—" }
        return compact(kilojoules / kilojoulesPerKcal)
    }

    enum Change: Equatable {
        /// Non-zero rounded percent; the sign is the direction.
        case percent(Int)
        case multiple(Int)
        case new
        /// Within ±0.5% — neither ahead nor behind.
        case flat

        enum Direction { case up, down, flat }

        var direction: Direction {
            switch self {
            case .percent(let p): return p > 0 ? .up : .down
            case .multiple, .new: return .up
            case .flat: return .flat
            }
        }

        var text: String {
            switch self {
            case .percent(let p): return p > 0 ? "+\(p)%" : "−\(abs(p))%"
            case .multiple(let m): return "\(m)×"
            case .new: return "New"
            case .flat: return "Even"
            }
        }

        var spoken: String {
            switch self {
            case .percent(let p): return p > 0 ? "up \(p) percent" : "down \(abs(p)) percent"
            case .multiple(let m): return "\(m) times"
            case .new: return "new this year"
            case .flat: return "about even"
            }
        }
    }

    /// Year-over-year change. The API's `delta` is `current - prior` in the
    /// metric's own unit, not a percentage, so the ratio is derived here.
    static func change(current: Double?, prior: Double?) -> Change? {
        guard let current, let prior else { return nil }
        // 0 → 0 is unchanged, not unknown: it counts as even in the summary.
        if prior <= 0 { return current > 0 ? .new : .flat }
        let pct = (current - prior) / prior * 100
        if pct >= 900 { return .multiple(Int((current / prior).rounded())) }
        // Round only the displayed magnitude: −0.1% must not read as "+0%" ahead.
        let rounded = Int(pct.rounded())
        return rounded == 0 ? .flat : .percent(rounded)
    }

    /// One-line verdict for the year-over-year card, e.g. "Ahead of 2025 on 3 of 4 measures so far."
    static func yoyVerdict(changes: [Change], priorYear: Int) -> String? {
        guard !changes.isEmpty else { return nil }
        let ahead = changes.filter { $0.direction == .up }.count
        let behind = changes.filter { $0.direction == .down }.count
        let n = changes.count
        let prior = String(priorYear)
        if ahead == 0 && behind == 0 { return "Level with \(prior) so far." }
        if n == 1 { return ahead == 1 ? "Ahead of \(prior) so far." : "Behind \(prior) so far." }
        if ahead == n { return "Ahead of \(prior) on all \(n) measures so far." }
        if behind == n { return "Behind \(prior) on all \(n) measures so far." }
        if ahead == 0 { return "Behind \(prior) on \(behind) of \(n) measures so far." }
        return "Ahead of \(prior) on \(ahead) of \(n) measures so far."
    }

    /// "Aug 17 – Nov 14" for an inclusive yyyy-MM-dd window.
    static func windowCaption(_ window: Window) -> String? {
        guard let start = isoDay.date(from: window.start), let end = isoDay.date(from: window.end) else { return nil }
        let style = Date.FormatStyle().month(.abbreviated).day()
        return "\(start.formatted(style)) – \(end.formatted(style))"
    }

    /// Caption under the monthly chart naming what the faded bars are.
    static func partialCaption(trend: [(month: String, partial: Bool)], window: Window) -> String? {
        let partials = trend.filter { $0.partial }
        guard !partials.isEmpty else { return nil }
        if partials.count == 1, isCurrentMonth(partials[0].month, window: window) {
            return "Faded bar: \(monthLong(partials[0].month)) so far."
        }
        return "Faded bars are partial months."
    }

    private static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = .current
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func monthYear(fromDay raw: String?) -> String? {
        guard let raw, let d = isoDay.date(from: String(raw.prefix(10))) else { return nil }
        return d.formatted(.dateTime.month(.abbreviated).year())
    }

    private static let monthNames = ["January", "February", "March", "April", "May", "June",
                                      "July", "August", "September", "October", "November", "December"]

    static func monthIndex(_ raw: String) -> Int? {
        let parts = raw.split(separator: "-")
        guard parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) else { return nil }
        return m - 1
    }

    /// The inclusive `yyyy-MM-dd` window the monthly rollup covers. Prefer the
    /// server's (`window_start`/`window_end`): it resolves "today" in its own
    /// zone, and the device clock can be a day off or past midnight since load.
    struct Window: Equatable {
        let start: String
        let end: String

        /// Fallback for older servers: rebuild `today - (days - 1) ... today`
        /// in the Gregorian calendar (API keys are Gregorian regardless of the
        /// device calendar).
        static func fallback(days: Int, today: Date = Date()) -> Window {
            // Resolve the zone per call: cached formatters would keep the zone
            // the app launched in after the device moves.
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .current
            let formatter = DateFormatter()
            formatter.calendar = calendar
            formatter.timeZone = .current
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd"
            let startDate = calendar.date(byAdding: .day, value: -(days - 1), to: today) ?? today
            return Window(start: formatter.string(from: startDate), end: formatter.string(from: today))
        }
    }

    /// The window's last month is still accumulating ("so far").
    static func isCurrentMonth(_ raw: String, window: Window) -> Bool {
        raw.prefix(7) == window.end.prefix(7)
    }

    /// A month bar is partial when it is still accumulating or the window
    /// starts after its 1st. Pure string comparison on Gregorian ISO keys. The
    /// API's own `partial` flag guesses from the first workout's date, so a
    /// fully covered month with no workout on the 1st would read as partial.
    static func isPartial(month raw: String, window: Window) -> Bool {
        guard raw.count >= 7 else { return false }
        return isCurrentMonth(raw, window: window) || "\(raw.prefix(7))-01" < window.start
    }

    static func monthShort(_ raw: String) -> String {
        guard let i = monthIndex(raw) else { return raw }
        return String(monthNames[i].prefix(3))
    }

    static func monthLong(_ raw: String) -> String {
        guard let i = monthIndex(raw) else { return raw }
        return monthNames[i]
    }

    static func sportName(_ raw: String) -> String {
        raw.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static func sentenceCase(_ raw: String) -> String {
        guard let first = raw.first else { return raw }
        return first.uppercased() + raw.dropFirst()
    }

    struct RecordValue: Equatable {
        struct Part: Equatable {
            let number: String
            let unit: String?
        }
        let parts: [Part]
    }

    /// Splits a server `value_display` into numerals and units so units can be
    /// set small. "h:mm" durations become "40h 52m" — "40:52" reads as minutes.
    static func recordValue(_ display: String) -> RecordValue {
        let trimmed = display.trimmingCharacters(in: .whitespaces)
        let hm = trimmed.split(separator: ":")
        if hm.count == 2, let h = Int(hm[0]), hm[1].count == 2, let m = Int(hm[1]) {
            if h == 0 { return RecordValue(parts: [.init(number: "\(m)", unit: "m")]) }
            return RecordValue(parts: [.init(number: "\(h)", unit: "h"), .init(number: String(format: "%02d", m), unit: "m")])
        }
        if let space = trimmed.lastIndex(of: " ") {
            let unit = String(trimmed[trimmed.index(after: space)...])
            if !unit.contains(where: \.isNumber) {
                return RecordValue(parts: [.init(number: String(trimmed[..<space]), unit: unit)])
            }
        }
        return RecordValue(parts: [.init(number: trimmed, unit: nil)])
    }
}

/// Sport series use the theme palette rather than server-sent hex values, so
/// every chart shares one set of colors in both appearances.
enum SportPalette {
    static func color(for sport: String) -> Color {
        let key = sport.lowercased()
        if key.contains("weight") || key.contains("strength") || key.contains("lift") || key.contains("functional") { return Theme.Palette.hrv }
        if key.contains("run") { return Theme.Palette.strain }
        if key.contains("soccer") || key.contains("football") { return Theme.Palette.recovery }
        if key.contains("walk") || key.contains("hik") { return Theme.Palette.respiration }
        if key.contains("cycl") || key.contains("bike") || key.contains("spin") { return Theme.Palette.rhr }
        if key.contains("swim") || key.contains("row") { return Theme.Palette.sleepDeep }
        let fallback = [Theme.Palette.brandStrain, Theme.Palette.accent, Theme.Palette.hrZone5, Theme.Palette.fg2]
        return fallback[key.unicodeScalars.reduce(0) { ($0 + Int($1.value)) % 9973 } % fallback.count]
    }
}
