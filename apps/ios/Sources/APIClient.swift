import Foundation
import SwiftUI

enum APIError: Error {
    case network(Error)
    case unauthorized
    case serverError(Int)
    case decode(Error)
    case badResponse
}

extension Notification.Name {
    static let apiUnauthorized = Notification.Name("com.georgenijo.coach.apiUnauthorized")
}

struct SyncResponse: Decodable {
    let ok: Bool
    let skipped: Bool?
    let lastSyncAt: Date?
    let durationMs: Int?
    let recovery: Int?
    let sleep: Int?
    let workouts: Int?
    let error: String?
}

final class APIClient {
    let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        baseURL: URL = URL(string: "https://coach-api.georgenijo.com")!,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.session = session

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { dec in
            let container = try dec.singleValueContainer()
            let raw = try container.decode(String.self)
            // Backend emits two formats:
            //   chat_messages.created_at → Date.toISOString() ("…T…Z" w/ ms)
            //   chat_threads.updated_at  → SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS" UTC)
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
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unrecognized date: \(raw)"
            )
        }
        self.decoder = decoder
        self.encoder = JSONEncoder()
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem]? = nil) async throws -> T {
        let request = makeRequest(path: path, query: query, method: "GET", bodyData: nil)
        return try await execute(request, path: path)
    }

    func post<T: Decodable, U: Encodable>(
        _ path: String,
        query: [URLQueryItem]? = nil,
        body: U
    ) async throws -> T {
        let bodyData: Data
        do {
            bodyData = try encoder.encode(body)
        } catch {
            ClientLogger.shared.error(
                "api_failure",
                details: ["endpoint": path, "stage": "encode", "error": String(describing: error)]
            )
            throw APIError.decode(error)
        }
        let request = makeRequest(path: path, query: query, method: "POST", bodyData: bodyData)
        return try await execute(request, path: path)
    }

    func postSync() async throws -> SyncResponse {
        var request = makeRequest(path: "/api/sync", query: nil, method: "POST", bodyData: nil)
        request.timeoutInterval = 130
        return try await execute(request, path: "/api/sync")
    }

    func openSSE<U: Encodable>(
        _ path: String,
        query: [URLQueryItem]? = nil,
        body: U
    ) async throws -> (headers: HTTPURLResponse, lines: AsyncLineSequence<URLSession.AsyncBytes>) {
        let bodyData: Data
        do {
            bodyData = try encoder.encode(body)
        } catch {
            ClientLogger.shared.error(
                "api_failure",
                details: ["endpoint": path, "stage": "encode", "error": String(describing: error)]
            )
            throw APIError.decode(error)
        }
        var request = makeRequest(path: path, query: query, method: "POST", bodyData: bodyData)
        request.timeoutInterval = 130
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch {
            ClientLogger.shared.error(
                "api_failure",
                details: ["endpoint": path, "error": String(describing: error)]
            )
            throw APIError.network(error)
        }

        guard let http = response as? HTTPURLResponse else {
            ClientLogger.shared.error(
                "api_failure",
                details: ["endpoint": path, "error": "non-http response"]
            )
            throw APIError.badResponse
        }

        switch http.statusCode {
        case 200..<300:
            return (http, bytes.lines)
        case 401:
            if request.value(forHTTPHeaderField: "Authorization") != nil {
                await handleUnauthorized()
            }
            throw APIError.unauthorized
        default:
            var preview = ""
            var count = 0
            for try await line in bytes.lines {
                preview += line + "\n"
                count += 1
                if preview.count > 500 || count > 20 { break }
            }
            ClientLogger.shared.warn(
                "api_non2xx",
                details: [
                    "endpoint": path,
                    "status": http.statusCode,
                    "body_preview": String(preview.prefix(500)),
                ]
            )
            throw APIError.serverError(http.statusCode)
        }
    }

    private func makeRequest(
        path: String,
        query: [URLQueryItem]?,
        method: String,
        bodyData: Data?
    ) -> URLRequest {
        let pathURL = baseURL.appendingPathComponent(path)
        var components = URLComponents(url: pathURL, resolvingAgainstBaseURL: false)
            ?? URLComponents()
        if let query, !query.isEmpty {
            components.queryItems = (components.queryItems ?? []) + query
        }
        let url = components.url ?? pathURL
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = KeychainStore.loadSessionToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = bodyData
        return request
    }

    private func execute<T: Decodable>(_ request: URLRequest, path: String) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            if path != "/api/log/client" {
                ClientLogger.shared.error(
                    "api_failure",
                    details: ["endpoint": path, "error": String(describing: error)]
                )
            }
            throw APIError.network(error)
        }

        guard let http = response as? HTTPURLResponse else {
            if path != "/api/log/client" {
                ClientLogger.shared.error(
                    "api_failure",
                    details: ["endpoint": path, "error": "non-http response"]
                )
            }
            throw APIError.badResponse
        }

        switch http.statusCode {
        case 200..<300:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                if path != "/api/log/client" {
                    ClientLogger.shared.error(
                        "api_failure",
                        details: [
                            "endpoint": path,
                            "stage": "decode",
                            "error": String(describing: error),
                        ]
                    )
                }
                throw APIError.decode(error)
            }
        case 401:
            if request.value(forHTTPHeaderField: "Authorization") != nil {
                await handleUnauthorized()
            }
            throw APIError.unauthorized
        default:
            if path != "/api/log/client" {
                let bodyPreview = String(data: data.prefix(500), encoding: .utf8) ?? ""
                ClientLogger.shared.warn(
                    "api_non2xx",
                    details: [
                        "endpoint": path,
                        "status": http.statusCode,
                        "body_preview": bodyPreview,
                    ]
                )
            }
            throw APIError.serverError(http.statusCode)
        }
    }

    @MainActor
    private func handleUnauthorized() {
        KeychainStore.deleteSessionToken()
        NotificationCenter.default.post(name: .apiUnauthorized, object: nil)
    }
}

private struct APIClientKey: EnvironmentKey {
    static let defaultValue = APIClient()
}

extension EnvironmentValues {
    var api: APIClient {
        get { self[APIClientKey.self] }
        set { self[APIClientKey.self] = newValue }
    }
}
