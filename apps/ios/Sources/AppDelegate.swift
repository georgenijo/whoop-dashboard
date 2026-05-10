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
        completionHandler([.banner, .list, .sound, .badge])
    }

    // didReceive (tap handler) lives in #274b — the foundation PR doesn't
    // deep-link anywhere yet.
}
