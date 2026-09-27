import Foundation

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
        case percent(Int)
        case multiple(Int)
        case new

        var isUp: Bool {
            switch self {
            case .percent(let p): return p >= 0
            case .multiple, .new: return true
            }
        }

        var text: String {
            switch self {
            case .percent(let p): return p >= 0 ? "+\(p)%" : "−\(abs(p))%"
            case .multiple(let m): return "\(m)×"
            case .new: return "New"
            }
        }

        var spoken: String {
            switch self {
            case .percent(let p): return p >= 0 ? "up \(p) percent" : "down \(abs(p)) percent"
            case .multiple(let m): return "\(m) times"
            case .new: return "new this year"
            }
        }
    }

    /// Year-over-year change. The API's `delta` is `current - prior` in the
    /// metric's own unit, not a percentage, so the ratio is derived here.
    static func change(current: Double?, prior: Double?) -> Change? {
        guard let current, let prior else { return nil }
        if prior <= 0 { return current > 0 ? .new : nil }
        let pct = (current - prior) / prior * 100
        if pct >= 900 { return .multiple(Int((current / prior).rounded())) }
        return .percent(Int(pct.rounded()))
    }

    private static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
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

    /// A month bar is partial when it is the current month or the window
    /// (`today - (days - 1)` ... today, matching the API) starts after its 1st.
    /// The API's own `partial` flag guesses from the first workout's date, so a
    /// fully covered month with no workout on the 1st reads as partial.
    static func isCurrentMonth(_ raw: String, today: Date = Date(), calendar: Calendar = .current) -> Bool {
        let c = calendar.dateComponents([.year, .month], from: today)
        guard let y = c.year, let m = c.month else { return false }
        return raw.hasPrefix(String(format: "%04d-%02d", y, m))
    }

    static func isPartial(month raw: String, windowDays: Int, today: Date = Date(),
                          calendar: Calendar = .current) -> Bool {
        let parts = raw.split(separator: "-")
        guard parts.count >= 2, let y = Int(parts[0]), let m = Int(parts[1]),
              let monthStart = calendar.date(from: DateComponents(year: y, month: m, day: 1)) else { return false }
        let todayStart = calendar.startOfDay(for: today)
        if calendar.isDate(monthStart, equalTo: todayStart, toGranularity: .month) { return true }
        guard let windowStart = calendar.date(byAdding: .day, value: -(windowDays - 1), to: todayStart) else { return false }
        return monthStart < windowStart
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
