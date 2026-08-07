import SwiftUI

enum DebugSession {
    static var token: String? {
        #if DEBUG
        guard
            let token = ProcessInfo.processInfo.environment["COACH_DEBUG_TOKEN"],
            !token.isEmpty
        else {
            return nil
        }
        return token
        #else
        return nil
        #endif
    }

    static var isActive: Bool { token != nil }
}

@main
struct CoachApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    @Environment(\.scenePhase) private var scenePhase

    @State private var isSignedIn: Bool = {
        #if DEBUG
        // Local-test bypass: launch with SIMCTL_CHILD_COACH_DEBUG_TOKEN=<jwt> to
        // skip Sign in with Apple in the simulator. DEBUG-only; never shipped.
        if let dbg = DebugSession.token {
            _ = KeychainStore.saveSessionToken(dbg)
            _ = KeychainStore.saveSessionExpiresAt(Date().addingTimeInterval(60 * 60 * 24 * 30))
            return true
        }
        #endif
        guard
            KeychainStore.loadSessionToken() != nil,
            let expiresAt = KeychainStore.loadSessionExpiresAt(),
            expiresAt > .now
        else {
            KeychainStore.deleteSessionToken()
            return false
        }
        return true
    }()

    private let api = APIClient()
    private let isDebugSession = DebugSession.isActive
    @State private var chatInFlight = ChatInFlightStore()
    @State private var wasBackgrounded = false

    init() {
        NSSetUncaughtExceptionHandler { exception in
            ClientLogger.shared.error(
                "uncaught: \(exception.name.rawValue)",
                details: [
                    "name": exception.name.rawValue,
                    "reason": exception.reason ?? "",
                    "stack": exception.callStackSymbols.joined(separator: "\n"),
                ]
            )
        }
    }

    var body: some Scene {
        WindowGroup {
            content
                .environment(\.api, api)
                .environment(\.chatInFlight, chatInFlight)
                .preferredColorScheme(.dark)
                .onReceive(NotificationCenter.default.publisher(for: .apiUnauthorized)) { _ in
                    isSignedIn = false
                }
                .onAppear {
                    // Browser-mirrored simulators cannot render or control
                    // Apple's secure permission sheets reliably. A Debug
                    // session uses production-backed data and deliberately
                    // skips device-only bootstrap prompts.
                    if isSignedIn && !isDebugSession {
                        PushService.shared.requestAuthorizationIfNeeded()
                        Task { await HealthKitService.shared.bootstrap() }
                    }
                }
                .onChange(of: scenePhase) { _, newPhase in
                    switch newPhase {
                    case .active:
                        ClientLogger.shared.lifecycle("foreground")
                        if wasBackgrounded {
                            wasBackgrounded = false
                            let store = chatInFlight
                            let client = api
                            Task { await Self.reconcileInFlight(store: store, api: client) }
                            if isSignedIn && !isDebugSession {
                                Task { await HealthKitService.shared.sync() }
                            }
                        }
                    case .background:
                        wasBackgrounded = true
                        ClientLogger.shared.lifecycle("background")
                    default:
                        break
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isSignedIn {
            RootView(onSignOut: {
                isSignedIn = false
            })
        } else {
            AuthView(onSignedIn: {
                isSignedIn = true
                ClientLogger.shared.lifecycle("signin")
                if !isDebugSession {
                    PushService.shared.requestAuthorizationIfNeeded()
                    Task { await HealthKitService.shared.bootstrap() }
                }
            })
        }
    }

    /// On foreground, reconcile every thread left mid-turn by a backgrounded or
    /// dropped send. A turn is terminal once the server has persisted a user
    /// message and a following assistant reply beyond that turn's local
    /// baseline; only then do we clear the in-flight marker and tell any live
    /// ChatView to refresh. Threads still running server-side stay marked and
    /// are retried on the next foreground, so a reply that lands while we were
    /// backgrounded is never lost. Owned here at app scope so recovery works
    /// regardless of which screen is mounted.
    @MainActor
    private static func reconcileInFlight(store: ChatInFlightStore, api: APIClient) async {
        let turns = store.inFlight
        for (id, turn) in turns {
            do {
                let detail = try await ChatService(api: api).threadDetail(id: id)
                if ChatRecovery.hasNewAssistantReply(
                    detail.messages,
                    afterMessageId: turn.baselineMessageId
                ) {
                    store.inFlight.removeValue(forKey: id)
                    NotificationCenter.default.post(name: .chatThreadNeedsRefresh, object: id)
                }
                // Else: turn still running server-side. Keep the marker; the
                // next foreground retries.
            } catch {
                // Transient (offline / 5xx). Keep the marker; retry next foreground.
            }
        }
    }
}
