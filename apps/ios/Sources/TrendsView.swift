import SwiftUI

struct TrendsView: View {
    @State private var destination: Metric?

    private enum Metric: String, Identifiable, CaseIterable {
        case recovery, sleep, strain, workouts
        var id: String { rawValue }

        var name: String {
            switch self {
            case .recovery: return "Recovery"
            case .sleep: return "Sleep"
            case .strain: return "Strain"
            case .workouts: return "Workouts"
            }
        }

        var icon: String {
            switch self {
            case .recovery: return "waveform.path.ecg"
            case .sleep: return "moon.fill"
            case .strain: return "flame.fill"
            case .workouts: return "figure.run"
            }
        }

        var accent: Color {
            switch self {
            case .recovery: return Theme.Palette.recovery
            case .sleep: return Theme.Palette.sleepDeep
            case .strain: return Theme.Palette.strain
            case .workouts: return Theme.Palette.info
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Trends")
                ScrollView {
                    VStack(spacing: Theme.Spacing.sm) {
                        ForEach(Metric.allCases) { metric in
                            Button { destination = metric } label: {
                                row(for: metric)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(Theme.Spacing.md)
                }
                .scrollContentBackground(.hidden)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $destination) { metric in
                switch metric {
                case .recovery: RecoveryView()
                case .sleep: SleepView()
                case .strain: StrainView()
                case .workouts: WorkoutsView()
                }
            }
        }
    }

    private func row(for metric: Metric) -> some View {
        HStack(spacing: Theme.Spacing.md) {
            Image(systemName: metric.icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(metric.accent)
                .frame(width: 28)
            Text(metric.name)
                .font(Theme.FontStyle.sans(15, weight: .medium))
                .foregroundStyle(Theme.Palette.fg1)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg3)
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

#Preview {
    TrendsView()
        .preferredColorScheme(.dark)
}
