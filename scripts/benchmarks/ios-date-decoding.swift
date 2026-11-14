// Run with the production helper, using an optimized host build:
// swiftc -O apps/ios/Sources/APIDateDecoding.swift scripts/benchmarks/ios-date-decoding.swift -o /tmp/ios-date-bench
// /tmp/ios-date-bench
import Foundation

@main
struct DateDecodingBenchmark {
    // Exact pre-change APIClient algorithm (87a5516), retained for comparison.
    static func baseline() -> JSONDecoder.DateDecodingStrategy {
        .custom { dec in
            let container = try dec.singleValueContainer()
            let raw = try container.decode(String.self)
            let withFractional = ISO8601DateFormatter()
            withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = withFractional.date(from: raw) { return date }
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let date = plain.date(from: raw) { return date }
            let sqlite = DateFormatter()
            sqlite.locale = Locale(identifier: "en_US_POSIX")
            sqlite.timeZone = TimeZone(identifier: "UTC")
            sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
            if let date = sqlite.date(from: raw) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognized date")
        }
    }

    static func main() throws {
        let dates = (0..<1000).map { index in
            ["2026-11-10T12:30:00.123Z", "2026-11-10T12:30:00Z", "2026-11-10 12:30:00"][index % 3]
        }
        let fixture = try JSONEncoder().encode(dates)
        var times: [String: [Double]] = ["before": [], "after": []]
        // Interleave to reduce order/thermal bias. Warm both implementations.
        for round in 0..<8 {
            for label in (round % 2 == 0 ? ["before", "after"] : ["after", "before"]) {
                let elapsed = try autoreleasepool { () -> Double in
                    let decoder = JSONDecoder()
                    decoder.dateDecodingStrategy = label == "before" ? baseline() : APIDateDecoding.strategy()
                    let start = ContinuousClock.now
                    let decoded = try decoder.decode([Date].self, from: fixture)
                    let duration = start.duration(to: .now)
                    precondition(decoded.count == 1000)
                    return Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
                }
                if round > 0 { times[label]!.append(elapsed) }
            }
        }
        var output: [String: Any] = ["fixture_dates": 1000, "measured_rounds": 7, "environment": "macOS host, swiftc -O; isolated date decoding, not end-to-end app latency"]
        for label in ["before", "after"] {
            let values = times[label]!
            output[label] = ["samples_ms": values, "median_ms": values.sorted()[values.count / 2]]
        }
        let json = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: json, as: UTF8.self))
    }
}
