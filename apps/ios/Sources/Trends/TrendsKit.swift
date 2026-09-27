import SwiftUI

enum TrendsLoadable<Value> {
    case loading
    case loaded(Value)
    case failed(String)

    var value: Value? {
        if case .loaded(let v) = self { return v }
        return nil
    }
}

enum TrendsLoadError {
    static func describe(_ error: Error) -> String {
        switch error {
        case APIError.unauthorized: return "Your session expired. Sign in again."
        case APIError.network: return "Couldn't reach the server."
        case APIError.serverError(let code): return "The server had a problem (\(code))."
        default: return "Something went wrong loading this."
        }
    }
}

enum TrendsFormat {
    static func hoursMinutes(ms: Double) -> String {
        hoursMinutes(minutes: Int((ms / 60_000).rounded()))
    }

    static func hoursMinutes(hours: Double) -> String {
        hoursMinutes(minutes: Int((hours * 60).rounded()))
    }

    static func hoursMinutes(seconds: Double) -> String {
        hoursMinutes(minutes: Int((seconds / 60).rounded()))
    }

    static func hoursMinutes(minutes total: Int) -> String {
        let h = total / 60
        let m = total % 60
        if h == 0 { return "\(m)m" }
        if m == 0 { return "\(h)h" }
        return String(format: "%dh %02dm", h, m)
    }

    static func day(_ key: String) -> String {
        guard let date = ChartDate.parse(key) else { return key }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    static func sport(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return "Workout" }
        return raw.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain = ISO8601DateFormatter()

    static func instant(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        return isoFractional.date(from: iso) ?? isoPlain.date(from: iso)
    }

    static func timeOfDay(_ iso: String?) -> String? {
        instant(iso)?.formatted(date: .omitted, time: .shortened)
    }

    static func sportSymbol(_ sport: String?) -> String {
        guard let s = sport?.lowercased() else { return "figure.mixed.cardio" }
        if s.contains("run") { return "figure.run" }
        if s.contains("cycl") || s.contains("bike") || s.contains("spin") { return "figure.outdoor.cycle" }
        if s.contains("walk") { return "figure.walk" }
        if s.contains("hik") { return "figure.hiking" }
        if s.contains("stair") { return "figure.stair.stepper" }
        if s.contains("weight") || s.contains("strength") || s.contains("lift") || s.contains("functional") { return "dumbbell.fill" }
        if s.contains("swim") { return "figure.pool.swim" }
        if s.contains("yoga") { return "figure.yoga" }
        if s.contains("row") { return "figure.rower" }
        if s.contains("tennis") || s.contains("pickle") { return "figure.tennis" }
        if s.contains("basket") { return "figure.basketball" }
        if s.contains("soccer") { return "figure.soccer" }
        return "figure.mixed.cardio"
    }
}

struct TrendsCardLabel: View {
    let text: String
    var trailing: String? = nil

    init(_ text: String, trailing: String? = nil) {
        self.text = text
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text.uppercased())
                .font(Theme.FontStyle.sans(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg2)
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing)
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
    }
}

struct TrendsStat: Identifiable {
    let id: String
    let label: String
    let value: String
    var unit: String = ""
    var caption: String? = nil
    var captionColor: Color = Theme.Palette.fg3
    var accent: Color = Theme.Palette.fg2
}

/// Non-scrolling grid of stat tiles. Replaces the sideways-swiping KPI strip:
/// every number on the page is visible without discovering it.
struct TrendsStatGrid: View {
    let tiles: [TrendsStat]
    var columns: Int = 3

    var body: some View {
        let grid = Array(repeating: GridItem(.flexible(), spacing: 0, alignment: .topLeading), count: columns)
        LazyVGrid(columns: grid, alignment: .leading, spacing: Theme.Spacing.md) {
            ForEach(tiles) { tile in
                VStack(alignment: .leading, spacing: 4) {
                    Text(tile.label.uppercased())
                        .font(Theme.FontStyle.sans(11, weight: .semibold))
                        .tracking(1.0)
                        .foregroundStyle(Theme.Palette.fg3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(tile.value)
                            .font(Theme.FontStyle.mono(20, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .contentTransition(.numericText())
                        if !tile.unit.isEmpty {
                            Text(tile.unit)
                                .font(Theme.FontStyle.mono(11))
                                .foregroundStyle(tile.accent)
                        }
                    }
                    if let caption = tile.caption {
                        Text(caption)
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(tile.captionColor)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

struct TrendsDeltaLabel: View {
    let delta: KPITile.Delta?
    var invert = false

    var body: some View {
        if let delta {
            Text(delta.label)
                .font(Theme.FontStyle.mono(11, weight: .medium))
                .foregroundStyle(color(delta.dir))
        }
    }

    private func color(_ dir: KPITile.Delta.Direction) -> Color {
        switch dir {
        case .flat: return Theme.Palette.fg3
        case .up: return invert ? Theme.Palette.danger : Theme.Palette.success
        case .down: return invert ? Theme.Palette.success : Theme.Palette.danger
        }
    }
}

/// Press state for whole-card links, so a card reads as tappable.
struct TrendsCardPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

struct TrendsErrorCard: View {
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title.uppercased())
                    .font(Theme.FontStyle.sans(11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.Palette.fg2)
                Text(message)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg1)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button(action: retry) {
                Text("Retry")
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(Capsule().fill(Theme.Palette.bg4))
                    .overlay(Capsule().strokeBorder(Theme.Palette.borderStrong, lineWidth: 0.5))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(padding: Theme.Spacing.md)
    }
}

/// Shaped stand-in for a chart card while its data loads.
struct TrendsChartPlaceholder: View {
    let title: String
    var chartHeight: CGFloat = 180

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(title.uppercased())
                .font(Theme.FontStyle.sans(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg2)
            HStack(alignment: .firstTextBaseline) {
                Text("00.0")
                    .font(Theme.FontStyle.mono(30, weight: .medium))
                Spacer()
                Text("Latest · Sat, Sep 00")
                    .font(Theme.FontStyle.mono(11))
            }
            .redacted(reason: .placeholder)
            RoundedRectangle(cornerRadius: 8)
                .fill(Theme.Palette.bg3.opacity(0.6))
                .frame(height: chartHeight)
                .trendsShimmer()
        }
        .glassCard(padding: Theme.Spacing.md)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading \(title)")
    }
}

struct TrendsDetailLoading: View {
    var titles: [String]

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.sm) {
                ForEach(Array(titles.enumerated()), id: \.offset) { index, title in
                    TrendsChartPlaceholder(title: title, chartHeight: index == 0 ? 200 : 150)
                }
            }
            .padding(Theme.Spacing.md)
        }
        .scrollDisabled(true)
    }
}

struct TrendsDetailError: View {
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack {
            TrendsErrorCard(title: title, message: message, retry: retry)
            Spacer()
        }
        .padding(Theme.Spacing.md)
    }
}

/// Pinned range control shared by the hub and every detail page.
struct TrendsRangeBar: View {
    @Binding var range: DateRange

    var body: some View {
        RangePicker(selection: $range)
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.vertical, Theme.Spacing.xs)
            .background(Theme.Palette.bg0.opacity(0.92))
    }
}

private struct TrendsShimmer: ViewModifier {
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { geo in
                    LinearGradient(colors: [.clear, Color.white.opacity(0.06), .clear],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.6)
                        .offset(x: phase * geo.size.width * 1.6)
                }
                .clipped()
            }
            .onAppear {
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

extension View {
    func trendsShimmer() -> some View { modifier(TrendsShimmer()) }
}
