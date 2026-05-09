import SwiftUI

struct DashboardView: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var phase: Phase = .loading
    @State private var lastFetched: Date?
    @State private var isLoading = false

    private static let staleInterval: TimeInterval = 300

    enum Phase {
        case loading
        case loaded(DashboardSummary)
        case error(String)
    }

    private var navigationTitle: String {
        if case .loaded(let summary) = phase, summary.isFallback {
            return "Dashboard"
        }
        return "Today"
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(navigationTitle)
                .refreshable { await load(showSpinner: false) }
        }
        .task { await load(showSpinner: true) }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            guard !isLoading else { return }
            if let last = lastFetched, Date().timeIntervalSince(last) < Self.staleInterval {
                return
            }
            Task { await load(showSpinner: false) }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let summary):
            if summary.hasAnyData {
                ScrollView {
                    VStack(spacing: 16) {
                        DashboardHeader(summary: summary)
                        RecoveryRingCard(recovery: summary.recovery)
                        HStack(spacing: 16) {
                            SleepCard(sleep: summary.sleep)
                            StrainCard(strain: summary.strain)
                        }
                        SignalsSection(signals: summary.signals)
                    }
                    .padding()
                }
            } else {
                ContentUnavailableView(
                    "No data yet",
                    systemImage: "moon.zzz",
                    description: Text("Sync your Whoop or wait for today's data.")
                )
            }
        case .error(let message):
            VStack(spacing: 12) {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("Retry") {
                    Task { await load(showSpinner: true) }
                }
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

        let hadLoadedData: Bool
        if case .loaded = phase { hadLoadedData = true } else { hadLoadedData = false }

        if showSpinner, !hadLoadedData {
            phase = .loading
        }
        do {
            let summary = try await DashboardService(api: api).today()
            phase = .loaded(summary)
            lastFetched = Date()
        } catch APIError.unauthorized {
            if !hadLoadedData { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadLoadedData { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadLoadedData { phase = .error("Server error (\(code))") }
        } catch APIError.decode {
            if !hadLoadedData { phase = .error("Bad response from server") }
        } catch APIError.badResponse {
            if !hadLoadedData { phase = .error("Bad response from server") }
        } catch {
            if !hadLoadedData { phase = .error("Could not load") }
        }
    }
}

private struct DashboardHeader: View {
    let summary: DashboardSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(headerTitle)
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
            if summary.isFallback {
                Text("Today's data hasn't arrived yet")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headerTitle: String {
        let displayDate = summary.dataDate ?? summary.requestedDate
        guard let parsed = Self.parser.date(from: displayDate) else {
            return displayDate
        }
        if !summary.isFallback, Calendar.current.isDateInToday(parsed) {
            return "Today"
        }
        return Self.formatter.string(from: parsed)
    }

    private static let parser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.timeZone = .current
        formatter.setLocalizedDateFormatFromTemplate("EEEEMMMd")
        return formatter
    }()
}

private struct RecoveryRingCard: View {
    let recovery: DashboardSummary.Recovery?

    var body: some View {
        VStack(spacing: 12) {
            Text("Recovery")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 24) {
                RecoveryRing(score: recovery?.score)
                    .frame(width: 120, height: 120)

                VStack(alignment: .leading, spacing: 6) {
                    Stat(label: "HRV", value: recovery?.hrvMs.map { "\(Int($0.rounded())) ms" })
                    Stat(label: "RHR", value: recovery?.rhrBpm.map { "\(Int($0.rounded())) bpm" })
                    Stat(label: "SpO₂", value: recovery?.spo2Pct.map { String(format: "%.1f%%", $0) })
                    Stat(label: "Skin", value: recovery?.skinTempC.map { String(format: "%.1f°C", $0) })
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct RecoveryRing: View {
    let score: Double?

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.gray.opacity(0.2), lineWidth: 12)

            if let score {
                Circle()
                    .trim(from: 0, to: max(0, min(1, score / 100)))
                    .stroke(
                        ringColor(score: score),
                        style: StrokeStyle(lineWidth: 12, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))

                VStack(spacing: 0) {
                    Text("\(Int(score.rounded()))")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                    Text("%")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("—")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func ringColor(score: Double) -> Color {
        switch score {
        case ..<34: return .red
        case ..<67: return .yellow
        default: return .green
        }
    }
}

private struct SleepCard: View {
    let sleep: DashboardSummary.Sleep?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Sleep", systemImage: "moon.fill")
                .font(.subheadline.weight(.semibold))

            if let perf = sleep?.perfPct {
                Text("\(Int(perf.rounded()))%")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
            } else {
                Text("—")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if let mins = sleep?.durationMin {
                Text(formatDuration(minutes: mins))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func formatDuration(minutes: Double) -> String {
        let total = Int(minutes.rounded())
        return "\(total / 60)h \(total % 60)m"
    }
}

private struct StrainCard: View {
    let strain: DashboardSummary.Strain?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Strain", systemImage: "bolt.fill")
                .font(.subheadline.weight(.semibold))

            if let score = strain?.score {
                Text(String(format: "%.1f", score))
                    .font(.system(size: 28, weight: .bold, design: .rounded))
            } else {
                Text("—")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if let kj = strain?.kj {
                Text("\(Int(kj.rounded())) kJ")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct SignalsSection: View {
    let signals: DashboardSummary.Signals

    var body: some View {
        if signals.ots == nil && signals.illness == nil && signals.apnea == nil {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Signals")
                    .font(.headline)

                if let ots = signals.ots {
                    SignalRow(
                        icon: "figure.run",
                        title: "Overtraining",
                        detail: "\(ots.severity.capitalized) (score \(ots.score))",
                        tint: severityTint(ots.severity)
                    )
                }
                if let illness = signals.illness {
                    SignalRow(
                        icon: "thermometer",
                        title: "Illness risk",
                        detail: illness.risk.capitalized,
                        tint: riskTint(illness.risk)
                    )
                }
                if let apnea = signals.apnea {
                    SignalRow(
                        icon: "lungs.fill",
                        title: "Apnea (7d)",
                        detail: "\(apnea.highRiskNights7d) high-risk nights",
                        tint: apnea.highRiskNights7d > 0 ? .orange : .secondary
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func severityTint(_ severity: String) -> Color {
        switch severity.lowercased() {
        case "high": return .red
        case "moderate": return .orange
        default: return .secondary
        }
    }

    private func riskTint(_ risk: String) -> Color {
        switch risk.lowercased() {
        case "high": return .red
        case "elevated": return .orange
        case "watch": return .yellow
        default: return .secondary
        }
    }
}

private struct SignalRow: View {
    let icon: String
    let title: String
    let detail: String
    let tint: Color

    var body: some View {
        HStack {
            Image(systemName: icon)
                .foregroundStyle(tint)
                .frame(width: 24)
            Text(title)
                .font(.subheadline)
            Spacer()
            Text(detail)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(tint)
        }
    }
}

private struct Stat: View {
    let label: String
    let value: String?

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value ?? "—")
                .font(.subheadline.weight(.medium))
        }
    }
}

#Preview {
    DashboardView()
}
