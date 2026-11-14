import SwiftUI

extension Notification.Name {
    static let coachDataDidSync = Notification.Name("com.georgenijo.coach.dataDidSync")
    static let coachSettingsDidChange = Notification.Name("com.georgenijo.coach.settingsDidChange")
}

struct CoachAccountSettings: View {
    @Environment(\.api) private var api
    @State private var instructions = ""
    @State private var originalInstructions = ""
    @State private var loaded = false
    @State private var loading = false
    @State private var saving = false
    @State private var message: String?

    var body: some View {
        Form {
            Section {
                TextEditor(text: $instructions)
                    .disabled(!loaded || saving)
                    .frame(minHeight: 180)
                    .accessibilityLabel("Coach instructions")
                Button(saving ? "Saving…" : "Save instructions") {
                    Task { await save() }
                }
                .disabled(!loaded || saving || instructions == originalInstructions || instructions.utf16.count > 10_000)
            } header: {
                Text("Personal instructions")
            } footer: {
                Text("Tell Coach about your goals, preferences, or constraints. These instructions apply to future conversations alongside its coaching guidance. Up to 10,000 characters.")
            }
            if let message {
                Section { Text(message).foregroundStyle(Theme.Palette.fg2) }
            }
            if !loaded {
                Section {
                    Button(loading ? "Loading instructions…" : "Retry loading instructions") { Task { await load() } }
                        .disabled(loading)
                }
            }
            Section("Provider keys") {
                NavigationLink("Anthropic") { ProviderKeySettings(provider: .anthropic) }
                NavigationLink("Cursor") { ProviderKeySettings(provider: .cursor) }
            }
        }
        .navigationTitle("Coach preferences")
        .navigationBarTitleDisplayMode(.inline)
        .task { if !loaded { await load() } }
    }

    @MainActor
    private func load() async {
        guard !loading, !loaded else { return }
        loading = true
        defer { loading = false }
        do {
            let settings: InstructionSettings = try await api.get("/api/settings")
            instructions = settings.systemPrompt
            originalInstructions = settings.systemPrompt
            loaded = true
            message = nil
        } catch {
            message = "Couldn’t load your instructions. Your saved settings have not changed."
        }
    }

    @MainActor
    private func save() async {
        guard loaded, !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let saved: InstructionSettings = try await api.post(
                "/api/settings", body: InstructionSettings(systemPrompt: instructions)
            )
            instructions = saved.systemPrompt
            originalInstructions = saved.systemPrompt
            message = "Instructions saved."
        } catch {
            message = "Couldn’t save. Your draft is still here; please try again."
        }
    }
}

struct InstructionSettings: Codable {
    let systemPrompt: String
    enum CodingKeys: String, CodingKey { case systemPrompt = "system_prompt" }
}

struct ProviderKeyState: Decodable {
    let present: Bool
    let masked: String?
    let fallbackAvailable: Bool
    enum CodingKeys: String, CodingKey {
        case present, masked
        case fallbackAvailable = "fallback_available"
    }
}

private struct ProviderKeySave: Encodable { let key: String }
private struct ProviderKeyResult: Decodable { let ok: Bool; let code: String? }

private struct ProviderKeySettings: View {
    let provider: CoachModelProvider
    @Environment(\.api) private var api
    @State private var state: ProviderKeyState?
    @State private var key = ""
    @State private var busy = false
    @State private var message: String?
    @State private var confirmingRemoval = false

    private var path: String {
        provider == .anthropic ? "/api/me/anthropic-key" : "/api/me/cursor-key"
    }

    var body: some View {
        Form {
            Section("Connection") {
                if let state {
                    Text(state.present ? "Personal key connected" : state.fallbackAvailable ? "Using the shared provider key" : "No key configured")
                    if let masked = state.masked { Text(masked).font(.caption.monospaced()) }
                } else {
                    Text("Status unavailable")
                    Button("Retry") { Task { await load() } }.disabled(busy)
                }
            }
            Section {
                SecureField("New API key", text: $key)
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(busy)
                Button(busy ? "Working…" : "Validate and save key") { Task { await save() } }
                    .disabled(busy || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if state?.present == true {
                    Button("Remove personal key", role: .destructive) { confirmingRemoval = true }
                        .disabled(busy)
                }
            } footer: {
                Text("Your key is validated before it is saved to your account. Only a masked value is returned. Removing a personal key uses the shared key if one is configured; it does not switch providers.")
            }
            if let message { Section { Text(message) } }
        }
        .navigationTitle(provider.rawValue)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onDisappear { key = "" }
        .confirmationDialog("Remove your \(provider.rawValue) key?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Remove key", role: .destructive) { Task { await remove() } }
        }
    }

    @MainActor
    private func load() async {
        do { state = try await api.get(path) }
        catch { message = "Couldn’t load provider status. Please try again." }
    }

    @MainActor
    private func save() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let result: ProviderKeyResult = try await api.post(path, body: ProviderKeySave(key: key.trimmingCharacters(in: .whitespacesAndNewlines)))
            guard result.ok else {
                message = result.code == "invalid_key" ? "The provider rejected this key. Check it and try again." : "The provider could not validate the key. Nothing was saved."
                return
            }
            key = ""
            message = "Key saved."
            NotificationCenter.default.post(name: .coachSettingsDidChange, object: nil)
            await load()
        } catch {
            message = "Couldn’t save the key. Check its format and your connection, then try again."
        }
    }

    @MainActor
    private func remove() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let _: ProviderKeyState = try await api.delete(path)
            message = "Personal key removed."
            NotificationCenter.default.post(name: .coachSettingsDidChange, object: nil)
            await load()
        } catch {
            message = "Couldn’t remove the key. Please try again."
        }
    }
}
