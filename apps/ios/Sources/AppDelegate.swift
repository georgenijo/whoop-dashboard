import UIKit
import UserNotifications

/// Bridges UIKit's UIApplicationDelegate hooks (which SwiftUI doesn't
/// surface natively) into the SwiftUI-first Coach app via
/// @UIApplicationDelegateAdaptor in CoachApp.swift.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        AppAppearance.configure()
        return true
    }

    // MARK: - APNs registration

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushService.shared.handleDeviceToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[push] APNs registration failed: \(error.localizedDescription)")
        ClientLogger.shared.warn(
            "apns_register_failed",
            details: ["error": error.localizedDescription]
        )
    }

    // MARK: - Silent / background push

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        ClientLogger.shared.lifecycle(
            "push_received",
            details: Self.payloadSummary(userInfo)
        )
        completionHandler(.noData)
    }

    // MARK: - Foreground presentation

    /// Show the alert banner even when the app is in the foreground —
    /// otherwise the user would only see the notification if they happen
    /// to be on the lock screen when it arrives. #274b's payload is
    /// intentionally surfaceable in-app, so this is the right default.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        ClientLogger.shared.lifecycle(
            "push_received",
            details: Self.payloadSummary(notification.request.content.userInfo)
        )
        completionHandler([.banner, .list, .sound, .badge])
    }

    private static func payloadSummary(_ userInfo: [AnyHashable: Any]) -> [String: Any] {
        var summary: [String: Any] = [:]
        if let aps = userInfo["aps"] as? [String: Any] {
            if let alert = aps["alert"] as? [String: Any] {
                if let title = alert["title"] as? String { summary["title"] = title }
                if let body = alert["body"] as? String { summary["body"] = body }
            } else if let alert = aps["alert"] as? String {
                summary["body"] = alert
            }
            if let badge = aps["badge"] { summary["badge"] = badge }
            if let category = aps["category"] as? String { summary["category"] = category }
        }
        for (key, value) in userInfo where key as? String != "aps" {
            if let k = key as? String { summary[k] = String(describing: value) }
        }
        return summary
    }

    // didReceive (tap handler) lives in #274b — the foundation PR doesn't
    // deep-link anywhere yet.
}
