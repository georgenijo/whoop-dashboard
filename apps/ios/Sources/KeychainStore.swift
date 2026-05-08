import Foundation
import Security

enum KeychainStore {
    private static let service = "com.georgenijo.coach"
    private static let sessionTokenAccount = "session_token"
    private static let sessionExpiresAtAccount = "session_expires_at"

    @discardableResult
    static func saveSessionToken(_ token: String) -> Bool {
        guard let data = token.data(using: .utf8) else { return false }
        return save(data: data, account: sessionTokenAccount)
    }

    static func loadSessionToken() -> String? {
        guard let data = load(account: sessionTokenAccount) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func saveSessionExpiresAt(_ date: Date) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let data = formatter.string(from: date).data(using: .utf8) else { return false }
        return save(data: data, account: sessionExpiresAtAccount)
    }

    static func loadSessionExpiresAt() -> Date? {
        guard
            let data = load(account: sessionExpiresAtAccount),
            let string = String(data: data, encoding: .utf8)
        else { return nil }

        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: string) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)
    }

    static func deleteSessionToken() {
        delete(account: sessionTokenAccount)
        delete(account: sessionExpiresAtAccount)
    }

    private static func save(data: Data, account: String) -> Bool {
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        SecItemDelete(baseQuery as CFDictionary)

        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    private static func load(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
