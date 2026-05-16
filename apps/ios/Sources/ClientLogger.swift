import Foundation

final class ClientLogger {
    static let shared = ClientLogger()

    private let endpoint = URL(string: "https://coach-api.georgenijo.com/api/log/client")!
    private let session: URLSession
    private let queue = DispatchQueue(label: "com.georgenijo.coach.clientlogger", qos: .utility)

    private static let maxMessageLength = 1024
    private static let maxDetailsBytes = 4096

    private init(session: URLSession = .shared) {
        self.session = session
    }

    func error(_ message: String, details: [String: Any] = [:]) {
        send(level: "error", kind: "error", message: message, details: details)
    }

    func warn(_ message: String, details: [String: Any] = [:]) {
        send(level: "warn", kind: "error", message: message, details: details)
    }

    func info(_ message: String, details: [String: Any] = [:]) {
        send(level: "info", kind: "event", message: message, details: details)
    }

    func lifecycle(_ event: String, details: [String: Any] = [:]) {
        send(level: "info", kind: "lifecycle", message: event, details: details)
    }

    private func send(level: String, kind: String, message: String, details: [String: Any]) {
        guard let token = KeychainStore.loadSessionToken(), !token.isEmpty else { return }
        let trimmedMessage = Self.truncate(message, max: Self.maxMessageLength)
        let detailsAny = Self.sanitizedDetails(details)

        var payload: [String: Any] = [
            "source": "ios",
            "level": level,
            "kind": kind,
            "message": trimmedMessage,
        ]
        if let detailsAny {
            payload["details"] = detailsAny
        }
        if let version = Self.appVersion() {
            payload["app_version"] = version
        }

        guard let body = Self.encode(payload) else { return }

        queue.async { [weak self] in
            guard let self else { return }
            var request = URLRequest(url: self.endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = body

            let task = self.session.dataTask(with: request)
            task.resume()
        }
    }

    private static func truncate(_ s: String, max: Int) -> String {
        if s.count <= max { return s }
        let idx = s.index(s.startIndex, offsetBy: max)
        return String(s[..<idx])
    }

    private static func sanitizedDetails(_ details: [String: Any]) -> Any? {
        if details.isEmpty { return nil }
        let sanitized = jsonSafe(details)
        guard JSONSerialization.isValidJSONObject(sanitized) else { return nil }

        guard
            let data = try? JSONSerialization.data(withJSONObject: sanitized, options: [])
        else { return nil }

        if data.count <= maxDetailsBytes { return sanitized }

        var summary: [String: Any] = ["truncated": true, "original_bytes": data.count]
        if let dict = sanitized as? [String: Any] {
            var preview: [String: Any] = [:]
            for (key, _) in dict.prefix(5) {
                preview[key] = "<omitted>"
            }
            summary["keys_sample"] = preview
        }
        return summary
    }

    private static func jsonSafe(_ value: Any) -> Any {
        switch value {
        case let s as String: return s
        case let n as NSNumber: return n
        case let b as Bool: return b
        case let arr as [Any]: return arr.map { jsonSafe($0) }
        case let dict as [String: Any]:
            var out: [String: Any] = [:]
            for (k, v) in dict { out[k] = jsonSafe(v) }
            return out
        case is NSNull: return NSNull()
        default:
            return String(describing: value)
        }
    }

    private static func encode(_ payload: [String: Any]) -> Data? {
        guard JSONSerialization.isValidJSONObject(payload) else { return nil }
        return try? JSONSerialization.data(withJSONObject: payload, options: [])
    }

    private static func appVersion() -> String? {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String
        let build = info?["CFBundleVersion"] as? String
        switch (short, build) {
        case let (s?, b?): return "\(s)(\(b))"
        case let (s?, nil): return s
        case (nil, _): return "unknown"
        }
    }
}
