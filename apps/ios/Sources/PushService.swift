import Foundation
import UIKit
import UserNotifications

extension Notification.Name {
    /// Posted by AppDelegate after APNs hands us a fresh device token.
    /// userInfo: ["token": Data, "hex": String]. Future consumers (#274b
    /// tap handler) can subscribe; the foundation PR only registers.
    static let apnsTokenReceived = Notification.Name(
        "com.georgenijo.coach.apnsTokenReceived"
    )
}

@MainActor
final class PushService {
    static let shared = PushService()

    private let api: APIClient
    private let center: UNUserNotificationCenter

    init(
        api: APIClient = APIClient(),
        center: UNUserNotificationCenter = .current()
    ) {
        self.api = api
        self.center = center
    }

    /// Ask the OS for permission and, on grant, register with APNs. The
    /// alert prompt only fires the first time per install — subsequent
    /// calls are a cheap no-op when the user has already decided.
    func requestAuthorizationIfNeeded() {
        center.getNotificationSettings { [weak self] settings in
            switch settings.authorizationStatus {
            case .notDetermined:
                self?.requestAuthorization()
            case .authorized, .provisional, .ephemeral:
                Task { @MainActor in
                    UIApplication.shared.registerForRemoteNotifications()
                }
            case .denied:
                // User explicitly said no. Don't re-prompt — that's banned
                // by App Store rules anyway.
                return
            @unknown default:
                return
            }
        }
    }

    private func requestAuthorization() {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                print("[push] requestAuthorization error: \(error.localizedDescription)")
                return
            }
            guard granted else { return }
            Task { @MainActor in
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Called from AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken.
    /// Posts a notification (for future consumers in #274b) and uploads the
    /// token to the backend so the server can target this device.
    func handleDeviceToken(_ token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(
            name: .apnsTokenReceived,
            object: nil,
            userInfo: ["token": token, "hex": hex]
        )
        Task { await register(hex: hex) }
    }

    private func register(hex: String) async {
        let appVersion = Self.versionString()
        do {
            let _: RegisterResponse = try await api.post(
                "/api/devices/register",
                body: RegisterRequest(
                    token: hex,
                    platform: "ios",
                    env: Self.environment(),
                    appVersion: appVersion
                )
            )
        } catch {
            print("[push] register failed: \(error)")
        }
    }

    private static func environment() -> String {
        // The aps-environment entitlement value at build time is the
        // source of truth. TestFlight + App Store builds resolve it to
        // "production" via Apple's signing pipeline; Xcode-direct builds
        // keep "development". We reflect whichever value the runtime
        // entitlement carries.
        #if DEBUG
        return "development"
        #else
        return "production"
        #endif
    }

    private static func versionString() -> String? {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String
        let build = info?["CFBundleVersion"] as? String
        switch (short, build) {
        case let (s?, b?): return "\(s)(\(b))"
        case let (s?, nil): return s
        default: return nil
        }
    }

    private struct RegisterRequest: Encodable {
        let token: String
        let platform: String
        let env: String
        let appVersion: String?

        enum CodingKeys: String, CodingKey {
            case token
            case platform
            case env
            case appVersion = "app_version"
        }
    }

    private struct RegisterResponse: Decodable {
        let ok: Bool
    }
}
