import SwiftUI

struct WorkoutsView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading

    enum Phase {
        case loading
        case loaded(WorkoutsPayload)
        case error(String)
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                RangePicker(selection: $range)
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, Theme.Spacing.xs)
                    .background(Theme.Palette.bg0.opacity(0.92))
            }
            .navigationTitle("Workouts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(.hidden, for: .navigationBar)
            .task(id: range) { await load(showSpinner: true) }
            .refreshable { await load(showSpinner: false) }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let payload):
            ScrollView {
                VStack(spacing: Theme.Spacing.sm) {
                    if payload.truncated {
                        HStack(spacing: 8) {
                            Image(systemName: "info.circle")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.Palette.warning)
                            Text("Showing 500 most recent — narrow the range to see fewer.")
                                .font(Theme.FontStyle.sans(11))
                                .foregroundStyle(Theme.Palette.fg2)
                            Spacer()
                        }
                        .padding(10)
                        .background(Theme.Palette.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.Palette.warning.opacity(0.22), lineWidth: 1))
                    }
                    SportFrequencyChartView(items: payload.sportFrequency)
                    WorkoutZoneChartView(rows: payload.zoneBreakdownRecent)
                    WorkoutDistanceChartView(rows: payload.distanceRecent)
                    WorkoutsTableView(workouts: payload.workouts)
                }
                .padding(Theme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
        case .error(let message):
            VStack(spacing: 12) {
                Text(message)
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
                Button("Retry") { Task { await load(showSpinner: true) } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Palette.brandStrain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }


    @MainActor
    private func load(showSpinner: Bool) async {
        let hadLoaded: Bool
        if case .loaded = phase { hadLoaded = true } else { hadLoaded = false }
        if showSpinner, !hadLoaded { phase = .loading }

        do {
            let payload = try await WorkoutsService(api: api).load(range: range)
            guard !Task.isCancelled else { return }
            phase = .loaded(payload)
        } catch APIError.unauthorized {
            if !hadLoaded, !Task.isCancelled { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadLoaded, !Task.isCancelled { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadLoaded, !Task.isCancelled { phase = .error("Server error (\(code))") }
        } catch {
            if !hadLoaded, !Task.isCancelled { phase = .error("Could not load") }
        }
    }
}
