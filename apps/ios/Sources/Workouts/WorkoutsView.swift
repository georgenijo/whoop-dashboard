import SwiftUI

struct WorkoutsView: View {
    @Environment(\.api) private var api
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading
    @State private var isLoading = false

    enum Phase {
        case loading
        case loaded(WorkoutsPayload)
        case error(String)
    }

    var body: some View {
        VStack(spacing: 0) {
            RangeSelectorView(selection: $range)
                .onChange(of: range) { _, _ in
                    Task { await load(showSpinner: true) }
                }
            content
        }
        .navigationTitle("Workouts")
        .navigationBarTitleDisplayMode(.large)
        .task { await load(showSpinner: true) }
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
                VStack(spacing: 16) {
                    if payload.truncated {
                        Text("Showing 500 most recent — narrow the range to see fewer.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal)
                    }
                    SportFrequencyChartView(items: payload.sportFrequency)
                    WorkoutZoneChartView(rows: payload.zoneBreakdownRecent)
                    WorkoutDistanceChartView(rows: payload.distanceRecent)
                    WorkoutsTableView(workouts: payload.workouts)
                }
                .padding()
            }
        case .error(let message):
            VStack(spacing: 12) {
                Text(message).font(.footnote).foregroundStyle(.secondary)
                Button("Retry") { Task { await load(showSpinner: true) } }
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @MainActor
    private func load(showSpinner: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        let hadLoaded: Bool
        if case .loaded = phase { hadLoaded = true } else { hadLoaded = false }
        if showSpinner, !hadLoaded { phase = .loading }

        do {
            let payload = try await WorkoutsService(api: api).load(range: range)
            phase = .loaded(payload)
        } catch APIError.unauthorized {
            if !hadLoaded { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadLoaded { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadLoaded { phase = .error("Server error (\(code))") }
        } catch {
            if !hadLoaded { phase = .error("Could not load") }
        }
    }
}
