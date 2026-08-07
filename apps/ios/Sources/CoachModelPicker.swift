import SwiftUI

struct CoachModelPicker: View {
    @Environment(\.api) private var api

    let disabled: Bool

    @State private var selection = CoachModelSelection.fallback
    @State private var presentation: Presentation?
    @State private var isLoading = true
    @State private var hasLoadedSettings = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    private enum Presentation: String, Identifiable {
        case picker

        var id: String { rawValue }
    }

    var body: some View {
        Button {
            presentation = .picker
        } label: {
            HStack(spacing: 5) {
                Text(selection.triggerLabel)
                    .lineLimit(1)
                if selection.selectedOption.provider == .anthropic {
                    Text(selection.effort.label)
                        .foregroundStyle(Theme.Palette.fg2)
                }
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            .font(Theme.FontStyle.sans(11.5, weight: .medium))
            .foregroundStyle(Theme.Palette.fg1)
            .padding(.horizontal, 11)
            .frame(minHeight: 36)
            .background(Theme.Palette.ai.opacity(0.11), in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(Theme.Palette.ai.opacity(0.28), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled || isSaving)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityIdentifier("coach-model-picker-trigger")
        .accessibilityLabel("Coach model")
        .accessibilityValue(accessibilityValue)
        .accessibilityHint("Opens model and reasoning choices")
        .sheet(item: $presentation) { _ in
            CoachModelPickerSheet(
                selection: $selection,
                isLoading: isLoading,
                hasLoadedSettings: hasLoadedSettings,
                isSaving: $isSaving,
                errorMessage: $errorMessage,
                onRetryLoad: {
                    Task { await load() }
                }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .task {
            guard isLoading else { return }
            await load()
        }
    }

    private var accessibilityValue: String {
        if isLoading {
            return "Loading"
        }
        let model = selection.selectedOption
        if model.provider == .anthropic {
            return "\(model.label), \(selection.effort.label) reasoning"
        }
        return model.label
    }

    @MainActor
    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            selection = try await CoachModelSelectionService(api: api).load()
            hasLoadedSettings = true
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            hasLoadedSettings = false
            errorMessage = "Couldn’t load your saved Coach settings."
        }
    }
}

private struct CoachModelPickerSheet: View {
    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @Binding var selection: CoachModelSelection
    let isLoading: Bool
    let hasLoadedSettings: Bool
    @Binding var isSaving: Bool
    @Binding var errorMessage: String?
    let onRetryLoad: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if let errorMessage {
                        errorBanner(errorMessage)
                    }

                    modelGroup(
                        provider: .anthropic,
                        options: selection.options.filter {
                            $0.provider == .anthropic
                        }
                    )

                    modelGroup(
                        provider: .cursor,
                        options: selection.options.filter {
                            $0.provider == .cursor
                        }
                    )

                    if selection.cursorStatus != .ready {
                        catalogState
                    }
                }
                .padding(Theme.Spacing.md)
            }
            .background(Theme.Palette.bg1)
            .navigationTitle("Choose a model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSaving)
                        .accessibilityIdentifier("coach-model-picker-close")
                }
            }
            .overlay {
                if isLoading {
                    ProgressView("Loading models…")
                        .font(Theme.FontStyle.sans(12))
                        .tint(Theme.Palette.ai)
                        .padding(16)
                        .background(
                            Theme.Palette.bg3,
                            in: RoundedRectangle(cornerRadius: 12)
                        )
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private func modelGroup(
        provider: CoachModelProvider,
        options: [CoachModelOption]
    ) -> some View {
        if !options.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(provider.rawValue.uppercased())
                    .font(Theme.FontStyle.sans(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.fg3)
                    .padding(.horizontal, 4)
                    .accessibilityAddTraits(.isHeader)

                VStack(spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                        if index > 0 {
                            Divider()
                                .overlay(Theme.Palette.borderSubtle)
                                .padding(.leading, 54)
                        }
                        modelRow(option)
                    }
                }
                .background(Theme.Palette.bg3, in: RoundedRectangle(cornerRadius: 16))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(Theme.Palette.borderDefault, lineWidth: 1)
                )
            }
        }
    }

    private func modelRow(_ option: CoachModelOption) -> some View {
        HStack(spacing: 0) {
            Button {
                Task { await selectModel(option) }
            } label: {
                HStack(spacing: 12) {
                    providerBadge(option.provider)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(option.label)
                            .font(Theme.FontStyle.sans(14, weight: .semibold))
                            .foregroundStyle(Theme.Palette.fg0)
                            .lineLimit(2)
                        if let detail = option.detail, !detail.isEmpty {
                            Text(detail)
                                .font(Theme.FontStyle.sans(11.5))
                                .foregroundStyle(Theme.Palette.fg2)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    }

                    Spacer(minLength: 8)

                    if selection.modelPref == option.id {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.Palette.ai)
                            .accessibilityHidden(true)
                    }
                }
                .contentShape(Rectangle())
                .padding(.leading, 12)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
            }
            .buttonStyle(.plain)
            .disabled(isLoading || isSaving || !hasLoadedSettings)
            .accessibilityIdentifier("coach-model-\(option.id)")
            .accessibilityLabel(option.label)
            .accessibilityValue(
                selection.modelPref == option.id ? "Selected" : "Not selected"
            )
            .accessibilityHint("Selects this model for your next Coach reply")

            if option.provider == .anthropic {
                NavigationLink {
                    CoachEffortPicker(
                        selection: $selection,
                        isSaving: $isSaving,
                        errorMessage: $errorMessage
                    )
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.Palette.ai)
                        .frame(width: 48, height: 62)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isLoading || isSaving || !hasLoadedSettings)
                .accessibilityIdentifier("coach-model-customize")
                .accessibilityLabel("Customize \(option.label)")
                .accessibilityValue("\(selection.effort.label) reasoning")
                .accessibilityHint("Shows reasoning choices")
            }
        }
    }

    private func providerBadge(_ provider: CoachModelProvider) -> some View {
        Text(provider == .anthropic ? "A" : "C")
            .font(Theme.FontStyle.sans(13, weight: .bold))
            .foregroundStyle(
                provider == .anthropic
                    ? Color(hex: "#b7a8ff")
                    : Color(hex: "#ff7abf")
            )
            .frame(width: 36, height: 36)
            .background(
                (provider == .anthropic
                    ? Theme.Palette.ai
                    : Color(hex: "#c2185b")
                ).opacity(0.18),
                in: RoundedRectangle(cornerRadius: 11)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .strokeBorder(
                        (provider == .anthropic
                            ? Theme.Palette.ai
                            : Color(hex: "#c2185b")
                        ).opacity(0.45),
                        lineWidth: 1
                    )
            )
            .accessibilityHidden(true)
    }

    private var catalogState: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(
                systemName: selection.cursorStatus == .unavailable
                    ? "wifi.exclamationmark"
                    : "key"
            )
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Theme.Palette.fg2)
            .frame(width: 22)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(selection.cursorStatus.title)
                    .font(Theme.FontStyle.sans(12.5, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg1)
                Text(selection.cursorStatus.detail)
                    .font(Theme.FontStyle.sans(11.5))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.bg2, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.Palette.danger)
                .accessibilityHidden(true)
            Text(message)
                .font(Theme.FontStyle.sans(11.5))
                .foregroundStyle(Theme.Palette.fg1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !hasLoadedSettings {
                Button("Retry", action: onRetryLoad)
                    .font(Theme.FontStyle.sans(11.5, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ai)
                    .disabled(isLoading)
            }
            Button {
                errorMessage = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
            }
            .accessibilityLabel("Dismiss error")
        }
        .padding(12)
        .background(
            Theme.Palette.danger.opacity(0.12),
            in: RoundedRectangle(cornerRadius: 12)
        )
    }

    @MainActor
    private func selectModel(_ option: CoachModelOption) async {
        guard !isSaving else { return }
        guard option.id != selection.modelPref else {
            dismiss()
            return
        }
        let previous = selection.modelPref
        selection.modelPref = option.id
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            let saved = try await CoachModelSelectionService(api: api)
                .selectModel(option.id)
            selection.modelPref = saved.modelPref
            selection.effort = saved.coachEffort
            dismiss()
        } catch is CancellationError {
            selection.modelPref = previous
        } catch {
            selection.modelPref = previous
            errorMessage = "Couldn’t switch models. Please try again."
        }
    }
}

private struct CoachEffortPicker: View {
    @Environment(\.api) private var api

    @Binding var selection: CoachModelSelection
    @Binding var isSaving: Bool
    @Binding var errorMessage: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let errorMessage {
                    effortErrorBanner(errorMessage)
                        .padding(.bottom, 12)
                }

                ForEach(CoachEffort.allCases) { effort in
                    Button {
                        Task { await selectEffort(effort) }
                    } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(effort.label)
                                    .font(Theme.FontStyle.sans(14, weight: .semibold))
                                    .foregroundStyle(Theme.Palette.fg0)
                                Text(effort.detail)
                                    .font(Theme.FontStyle.sans(11.5))
                                    .foregroundStyle(Theme.Palette.fg2)
                            }
                            Spacer()
                            if selection.effort == effort {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.Palette.ai)
                                    .accessibilityHidden(true)
                            }
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 62)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isSaving)
                    .accessibilityIdentifier("coach-effort-\(effort.rawValue)")
                    .accessibilityLabel(effort.label)
                    .accessibilityValue(
                        selection.effort == effort ? "Selected" : effort.detail
                    )

                    if effort != CoachEffort.allCases.last {
                        Divider()
                            .overlay(Theme.Palette.borderSubtle)
                            .padding(.leading, 16)
                    }
                }
            }
            .background(Theme.Palette.bg3, in: RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Theme.Palette.borderDefault, lineWidth: 1)
            )
            .padding(Theme.Spacing.md)
        }
        .background(Theme.Palette.bg1)
        .navigationTitle("Reasoning")
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .bottom) {
            if isSaving {
                ProgressView("Saving…")
                    .font(Theme.FontStyle.sans(11.5))
                    .tint(Theme.Palette.ai)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.Palette.bg3, in: Capsule())
                    .padding(.bottom, 16)
            }
        }
    }

    private func effortErrorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.Palette.danger)
                .accessibilityHidden(true)
            Text(message)
                .font(Theme.FontStyle.sans(11.5))
                .foregroundStyle(Theme.Palette.fg1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                errorMessage = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
            }
            .accessibilityLabel("Dismiss error")
        }
        .padding(12)
        .background(
            Theme.Palette.danger.opacity(0.12),
            in: RoundedRectangle(cornerRadius: 12)
        )
    }

    @MainActor
    private func selectEffort(_ effort: CoachEffort) async {
        guard effort != selection.effort, !isSaving else { return }
        let previous = selection.effort
        selection.effort = effort
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            let saved = try await CoachModelSelectionService(api: api)
                .selectEffort(effort)
            selection.modelPref = saved.modelPref
            selection.effort = saved.coachEffort
        } catch is CancellationError {
            selection.effort = previous
        } catch {
            selection.effort = previous
            errorMessage = "Couldn’t change reasoning. Please try again."
        }
    }
}

#Preview {
    ZStack {
        Theme.Palette.bg0.ignoresSafeArea()
        CoachModelPicker(disabled: false)
    }
    .preferredColorScheme(.dark)
}
