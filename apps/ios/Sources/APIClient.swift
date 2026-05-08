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
            let withFractional = ISO8601DateFormatter()
            withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = withFractional.date(from: raw) { return date }
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let date = plain.date(from: raw) { return date }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected ISO 8601 date, got \(raw)"
            )
        }
        self.decoder = decoder
        self.encoder = JSONEncoder()
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem]? = nil) async throws -> T {
        let request = makeRequest(path: path, query: query, method: "GET", bodyData: nil)
        return try await execute(request)
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
            throw APIError.decode(error)
        }
        let request = makeRequest(path: path, query: query, method: "POST", bodyData: bodyData)
        return try await execute(request)
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

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.badResponse
        }

        switch http.statusCode {
        case 200..<300:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decode(error)
            }
        case 401:
            if request.value(forHTTPHeaderField: "Authorization") != nil {
                await handleUnauthorized()
            }
            throw APIError.unauthorized
        default:
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
