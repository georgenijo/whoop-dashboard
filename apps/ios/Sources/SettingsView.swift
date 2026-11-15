import SwiftUI
import UserNotifications

/// Pure text for the Settings rows, kept out of the view for tests.
enum SettingsFormat {
    /// One quoted line of the saved instructions, or nil when there are none.
    static func instructionsPreview(_ text: String, limit: Int = 90) -> String? {
        let collapsed = text
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard !collapsed.isEmpty else { return nil }
        if collapsed.count <= limit { return "“\(collapsed)”" }
        let cut = collapsed.prefix(limit).trimmingCharacters(in: .whitespaces)
        return "“\(cut)…”"
    }

    /// "Today 8:21 AM", "Yesterday 6:40 PM" or "Nov 9, 8:21 AM".
    static func syncTime(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let time = date.formatted(.dateTime.hour().minute())
        if calendar.isDate(date, inSameDayAs: now) { return "Today \(time)" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now)),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday \(time)"
        }
        return "\(date.formatted(.dateTime.month(.abbreviated).day())), \(time)"
    }

    static func modelLabel(model: String, effort: String?) -> String {
        guard let effort, !effort.isEmpty else { return model }
        return "\(model) · \(effort)"
    }

    enum NotificationState: Equatable {
        case unknown, enabled, disabled, notAsked

        init(_ status: UNAuthorizationStatus) {
            switch status {
            case .authorized, .provisional, .ephemeral: self = .enabled
            case .denied: self = .disabled
            case .notDetermined: self = .notAsked
            @unknown default: self = .unknown
            }
        }

        var label: String {
            switch self {
            case .enabled: return "On"
            case .disabled: return "Off"
            case .notAsked: return "Not asked yet"
            case .unknown: return "Unknown"
            }
        }

        var detail: String {
            switch self {
            case .enabled: return "Coach can notify you when an answer finishes in the background."
            case .disabled: return "Turned off in iOS Settings. Coach cannot notify you."
            case .notAsked: return "Coach will ask the next time it needs to notify you."
            case .unknown: return "Checking notification permission."
            }
        }
    }
}

struct SettingsView: View {
    var onSignOut: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    @State private var confirmingSignOut = false
    @State private var isSyncing = false
    @State private var syncStatus: SyncStatus?
    @State private var lastSyncAt: Date?
    @State private var instructions: String?
    @State private var modelText: String?
    @State private var notifications = SettingsFormat.NotificationState.unknown

    enum SyncStatus {
        case ok(r: Int, s: Int, w: Int, ms: Int, at: Date)
        case skipped(at: Date)
        case error
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                FoldColumns(spacing: Theme.Spacing.md) {
                    section("Connections") { connections }
                    section("Data") { data }
                } trailing: {
                    section("Coach") { coach }
                    section("Notifications") { notificationsGroup }
                    aboutGroup
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.bottom, Theme.Spacing.xxl)
            }
            .measuresFold()
            .scrollIndicators(.hidden)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .task { await loadSummaries() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refreshNotifications() } }
            }
            .onReceive(NotificationCenter.default.publisher(for: .coachSettingsDidChange)) { _ in
                Task { await loadSummaries() }
            }
            .confirmationDialog(
                "Sign out of Coach?",
                isPresented: $confirmingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    ClientLogger.shared.lifecycle("signout")
                    KeychainStore.deleteSessionToken()
                    onSignOut()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You'll need to sign in with Apple again to use Coach.")
            }
        }
        .presentationDragIndicator(.visible)
    }

    // MARK: Groups

    private var connections: some View {
        VStack(spacing: 0) {
            WhoopConnectorCard()
                .padding(Theme.Spacing.md)
            CoachLedgerRule()
            Button {
                if let url = URL(string: "x-apple-health://") { openURL(url) }
            } label: {
                SettingsRow(icon: "heart", title: "Apple Health",
                            detail: "Steps and workouts, read only. Manage access in the Health app.") {
                    Text("Manage")
                        .font(Theme.FontStyle.sans(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.accent)
                }
            }
            .buttonStyle(ChatPressStyle())
            .accessibilityHint("Opens the Health app")
        }
        .coachLedgerOutline()
    }

    private var data: some View {
        VStack(spacing: 0) {
            SettingsRow(icon: "clock", title: "Last sync", detail: lastSyncDetail) {
                if let state = syncState {
                    HStack(spacing: 4) {
                        Image(systemName: state.symbol)
                            .font(.system(size: 12, weight: .semibold))
                        Text(state.label)
                            .font(Theme.FontStyle.sans(13, weight: .medium))
                    }
                    .foregroundStyle(state.color)
                    .accessibilityElement(children: .combine)
                }
            }
            CoachLedgerRule()
            Button {
                triggerSync()
            } label: {
                SettingsRow(icon: "arrow.triangle.2.circlepath", title: "Sync now",
                            titleColor: Theme.Palette.accent) {
                    if isSyncing {
                        ProgressView().controlSize(.small).tint(Theme.Palette.fg2)
                    } else {
                        Text("last 7 days")
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg2)
                    }
                }
            }
            .buttonStyle(ChatPressStyle())
            .disabled(isSyncing)
        }
        .coachLedgerOutline()
    }

    private var coach: some View {
        VStack(spacing: 0) {
            NavigationLink {
                CoachAccountSettings()
            } label: {
                SettingsRow(icon: "doc.text", title: "Instructions",
                            detail: instructions ?? "Tell Coach about your goals and constraints.") {
                    chevron
                }
            }
            .buttonStyle(ChatPressStyle())
            CoachLedgerRule()
            SettingsRow(icon: "sparkle", title: "Default model",
                        detail: "Change it from the message box in any chat.") {
                if let modelText {
                    Text(modelText)
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg2)
                        .multilineTextAlignment(.trailing)
                }
            }
            .accessibilityElement(children: .combine)
            CoachLedgerRule()
            NavigationLink {
                ProviderKeysView()
            } label: {
                SettingsRow(icon: "key", title: "Provider keys") { chevron }
            }
            .buttonStyle(ChatPressStyle())
        }
        .coachLedgerOutline()
    }

    private var notificationsGroup: some View {
        Button {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        } label: {
            SettingsRow(icon: "bell", title: "Notifications", detail: notifications.detail) {
                HStack(spacing: 8) {
                    Text(notifications.label)
                        .font(Theme.FontStyle.sans(13, weight: .medium))
                        .foregroundStyle(notifications == .enabled ? Theme.Palette.recovery : Theme.Palette.fg2)
                    chevron
                }
            }
        }
        .buttonStyle(ChatPressStyle())
        .coachLedgerOutline()
        .accessibilityHint("Opens iOS Settings")
    }

    private var aboutGroup: some View {
        VStack(spacing: 0) {
            SettingsRow(icon: "info.circle", title: "About Coach") {
                Text(versionString)
                    .font(Theme.FontStyle.mono(13))
                    .foregroundStyle(Theme.Palette.fg2)
            }
            .accessibilityElement(children: .combine)
            CoachLedgerRule()
            Button(role: .destructive) {
                confirmingSignOut = true
            } label: {
                SettingsRow(icon: "rectangle.portrait.and.arrow.right", title: "Sign out",
                            titleColor: Theme.Palette.danger, iconTint: Theme.Palette.danger) {
                    EmptyView()
                }
            }
            .buttonStyle(ChatPressStyle())
        }
        .coachLedgerOutline()
        .padding(.top, Theme.Spacing.md)
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.Palette.fg3)
            .accessibilityHidden(true)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            LedgerLabel(title).padding(.leading, 4)
            content()
        }
        .padding(.top, Theme.Spacing.xs)
    }

    // MARK: Sync

    private var lastSyncDetail: String {
        var parts: [String] = []
        switch syncStatus {
        case let .ok(r, s, w, _, at):
            parts.append(SettingsFormat.syncTime(at))
            parts.append("\(r + s + w) records updated")
        case let .skipped(at):
            parts.append(SettingsFormat.syncTime(at))
            parts.append("already up to date")
        case .error:
            parts.append("Couldn’t sync. Check your connection and Whoop status, then try again.")
        case nil:
            parts.append(lastSyncAt.map { SettingsFormat.syncTime($0) } ?? "No sync yet")
        }
        return parts.joined(separator: " · ")
    }

    private var syncState: (label: String, symbol: String, color: Color)? {
        switch syncStatus {
        case .ok, .skipped: return ("OK", "checkmark", Theme.Palette.recovery)
        case .error: return ("Failed", "exclamationmark.triangle", Theme.Palette.danger)
        case nil: return nil
        }
    }

    private func triggerSync() {
        syncStatus = nil
        isSyncing = true

        Task {
            do {
                let resp = try await api.postSync()
                let status: SyncStatus
                let logStatus: String
                if resp.skipped == true {
                    status = .skipped(at: resp.lastSyncAt ?? Date())
                    logStatus = "skipped"
                } else if resp.ok {
                    status = .ok(
                        r: resp.recovery ?? 0,
                        s: resp.sleep ?? 0,
                        w: resp.workouts ?? 0,
                        ms: resp.durationMs ?? 0,
                        at: Date()
                    )
                    logStatus = "ok"
                } else {
                    status = .error
                    logStatus = "error"
                }
                await MainActor.run {
                    syncStatus = status
                    isSyncing = false
                    if resp.ok && resp.skipped != true {
                        lastSyncAt = Date()
                        NotificationCenter.default.post(name: .coachDataDidSync, object: nil)
                    }
                }
                ClientLogger.shared.lifecycle("sync_manual_ios", details: ["status": logStatus])
            } catch {
                await MainActor.run {
                    syncStatus = .error
                    isSyncing = false
                }
                ClientLogger.shared.lifecycle("sync_manual_ios", details: ["status": "error"])
            }
        }
    }

    // MARK: Summaries

    @MainActor
    private func loadSummaries() async {
        async let notificationsTask: Void = refreshNotifications()
        async let connector: WhoopConnector? = try? WhoopConnectorService(api: api).fetch()
        async let settings: InstructionSettings? = try? api.get("/api/settings")
        async let selection: CoachModelSelection? = try? CoachModelSelectionService(api: api).load()

        if let last = await connector?.lastSyncAt {
            lastSyncAt = PlansPresentation.instant(last)
        }
        if let settings = await settings {
            instructions = SettingsFormat.instructionsPreview(settings.systemPrompt)
        }
        if let selection = await selection {
            let effort = selection.supportedEfforts.isEmpty ? nil : selection.effectiveEffort.label
            modelText = SettingsFormat.modelLabel(model: selection.triggerLabel, effort: effort)
        }
        await notificationsTask
    }

    @MainActor
    private func refreshNotifications() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notifications = SettingsFormat.NotificationState(settings.authorizationStatus)
    }

    private var versionString: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String
        let build = info?["CFBundleVersion"] as? String
        switch (short, build) {
        case let (s?, b?): return "\(s) (\(b))"
        case let (s?, nil): return s
        default: return "—"
        }
    }
}

private struct SettingsRow<Trailing: View>: View {
    let icon: String
    let title: String
    var detail: String?
    var titleColor: Color = Theme.Palette.fg0
    var iconTint: Color = Theme.Palette.fg1
    @ViewBuilder let trailing: () -> Trailing

    init(icon: String, title: String, detail: String? = nil,
         titleColor: Color = Theme.Palette.fg0, iconTint: Color = Theme.Palette.fg1,
         @ViewBuilder trailing: @escaping () -> Trailing) {
        self.icon = icon
        self.title = title
        self.detail = detail
        self.titleColor = titleColor
        self.iconTint = iconTint
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.sm) {
            LedgerIcon(systemName: icon, tint: iconTint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(titleColor)
                if let detail {
                    Text(detail)
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, 10)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
    }
}

#Preview {
    SettingsView(onSignOut: {})
        .preferredColorScheme(.dark)
}
