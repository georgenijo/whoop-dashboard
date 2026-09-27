import Charts
import CoreTransferable
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct CoachSummaryImage: Transferable {
    let data: Data

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { summary in
            summary.data
        }
        .suggestedFileName("coach-summary.png")
    }

    init(text: String) {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1200, height: 630))
        let image = renderer.image { context in
            UIColor(red: 0.96, green: 0.94, blue: 0.90, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1200, height: 630))
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byWordWrapping
            ("Coach summary" as NSString).draw(
                in: CGRect(x: 72, y: 62, width: 1056, height: 52),
                withAttributes: [.font: UIFont.systemFont(ofSize: 32, weight: .semibold), .foregroundColor: UIColor.black]
            )
            (text as NSString).draw(
                in: CGRect(x: 72, y: 140, width: 1056, height: 420),
                withAttributes: [.font: UIFont.systemFont(ofSize: 27), .foregroundColor: UIColor.black, .paragraphStyle: paragraph]
            )
        }
        data = image.pngData() ?? Data()
    }
}

enum CoachPresentationBlock: Decodable, Hashable {
    case metricStrip(MetricStrip)
    case comparison(Comparison)
    case chart(ChartBlock)
    case actionPlan(ActionPlan)
    case dataFreshness(DataFreshness)
    case workoutPlan(CoachWorkoutPlanBlock)
    case evidence(Evidence)

    private enum Keys: String, CodingKey { case version, type }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        guard try container.decode(Int.self, forKey: .version) == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .version, in: container, debugDescription: "Unsupported presentation version")
        }
        switch try container.decode(String.self, forKey: .type) {
        case "metric_strip": self = .metricStrip(try MetricStrip(from: decoder))
        case "comparison": self = .comparison(try Comparison(from: decoder))
        case "chart": self = .chart(try ChartBlock(from: decoder))
        case "action_plan": self = .actionPlan(try ActionPlan(from: decoder))
        case "data_freshness": self = .dataFreshness(try DataFreshness(from: decoder))
        case "workout_plan": self = .workoutPlan(try CoachWorkoutPlanBlock(from: decoder))
        case "evidence": self = .evidence(try Evidence(from: decoder))
        default: throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown presentation type")
        }
    }
}

struct MetricStrip: Decodable, Hashable {
    let fallback: String
    let metrics: [Metric]
    struct Metric: Decodable, Hashable {
        let label: String
        let value: Double?
        let displayValue: String
        let unit: String
        let direction: String
        let tone: String
        enum CodingKeys: String, CodingKey { case label, value, unit, direction, tone; case displayValue = "display_value" }
    }
}

struct Comparison: Decodable, Hashable {
    let fallback: String
    let title: String
    let items: [Item]
    struct Item: Decodable, Hashable {
        let label: String
        let current: Double?
        let baseline: Double?
        let delta: Double?
        let unit: String
        let direction: String
    }
}

struct ChartBlock: Decodable, Hashable {
    let fallback: String
    let title: String
    let labels: [String]
    let series: [Series]
    let references: [Reference]
    let anomalies: [Anomaly]
    struct Series: Decodable, Hashable, Identifiable {
        let id: String
        let label: String
        let unit: String
        let kind: String
        let values: [Double?]
    }
    struct Reference: Decodable, Hashable { let label: String; let value: Double; let unit: String }
    struct Anomaly: Decodable, Hashable { let index: Int; let label: String }
}

struct ActionPlan: Decodable, Hashable {
    let fallback: String
    let title: String
    let sections: [Section]
    struct Section: Decodable, Hashable { let timeframe: String; let items: [String] }
}

struct DataFreshness: Decodable, Hashable {
    let fallback: String
    let sources: [Source]
    let syncAvailable: Bool
    struct Source: Decodable, Hashable {
        let source: String
        let status: String
        let lastAvailableDate: String?
        enum CodingKeys: String, CodingKey { case source, status; case lastAvailableDate = "last_available_date" }
    }
    enum CodingKeys: String, CodingKey { case fallback, sources; case syncAvailable = "sync_available" }
}

struct CoachWorkoutPlanBlock: Decodable, Hashable {
    let fallback: String
    let title: String
    let date: String?
    let exercises: [Exercise]
    struct Exercise: Decodable, Hashable { let name: String; let prescription: String; let notes: String }
}

struct Evidence: Decodable, Hashable {
    let fallback: String
    let title: String
    let dateRange: String
    let recordCount: Int
    let missingDays: Int
    let sources: [String]
    let points: [String]
    enum CodingKeys: String, CodingKey {
        case fallback, title, sources, points
        case dateRange = "date_range"
        case recordCount = "record_count"
        case missingDays = "missing_days"
    }
}


struct CoachPresentationBlocksView: View {
    let blocks: [CoachPresentationBlock]
    @Environment(\.api) private var api

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
                    .contextMenu {
                        ShareLink(item: CoachSummaryImage(text: fallback(block)), preview: SharePreview("Coach summary")) {
                            Label("Share summary image", systemImage: "square.and.arrow.up")
                        }
                        Button { UIPasteboard.general.string = fallback(block) } label: {
                            Label("Copy summary", systemImage: "doc.on.doc")
                        }
                    }
            }
        }
    }

    @ViewBuilder private func blockView(_ block: CoachPresentationBlock) -> some View {
        switch block {
        case .metricStrip(let strip):
            MetricStripView(strip: strip).coachCard()
        case .comparison(let comparison):
            ComparisonView(comparison: comparison).coachCard()
        case .chart(let chart):
            CoachChartCard(block: chart)
        case .actionPlan(let plan):
            ActionPlanView(plan: plan).coachCard()
        case .dataFreshness(let freshness):
            DataFreshnessView(block: freshness, api: api).coachCard()
        case .workoutPlan(let plan):
            WorkoutPlanView(plan: plan).coachCard()
        case .evidence(let evidence):
            EvidenceView(evidence: evidence).coachCard(padding: 0)
        }
    }

    private func fallback(_ block: CoachPresentationBlock) -> String {
        switch block {
        case .metricStrip(let x): x.fallback
        case .comparison(let x): x.fallback
        case .chart(let x): x.fallback
        case .actionPlan(let x): x.fallback
        case .dataFreshness(let x): x.fallback
        case .workoutPlan(let x): x.fallback
        case .evidence(let x): x.fallback
        }
    }
}

private extension View {
    func coachCard(padding: CGFloat = Theme.Spacing.md) -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(padding: padding)
    }
}

private struct CoachCardLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(Theme.FontStyle.sans(11, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(Theme.Palette.fg2)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Pure helper for the metric-strip unit-suppression rule, factored out so it
/// can be unit tested without instantiating a SwiftUI view.
enum CoachUnitDisplay {
    static func shows(unit: String, displayValue: String) -> Bool {
        guard !unit.isEmpty else { return false }
        return !displayValue.localizedCaseInsensitiveContains(unit)
    }
}

private enum Tone {
    static func color(_ tone: String) -> Color {
        switch tone {
        case "positive": return Theme.Palette.success
        case "negative": return Theme.Palette.danger
        case "warning": return Theme.Palette.warning
        default: return Theme.Palette.fg3
        }
    }

    static func arrow(_ direction: String) -> String? {
        switch direction {
        case "up": return "arrow.up.right"
        case "down": return "arrow.down.right"
        default: return nil
        }
    }
}

// MARK: Metric strip

private struct MetricStripView: View {
    let strip: MetricStrip

    var body: some View {
        Group {
            if strip.metrics.count <= 3 {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(strip.metrics.enumerated()), id: \.offset) { index, metric in
                        if index > 0 {
                            Rectangle()
                                .fill(Theme.Palette.borderSubtle)
                                .frame(width: 1)
                                .padding(.horizontal, 12)
                        }
                        tile(metric)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)],
                    alignment: .leading,
                    spacing: 16
                ) {
                    ForEach(Array(strip.metrics.enumerated()), id: \.offset) { _, metric in
                        tile(metric)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(strip.fallback)
    }

    private func tile(_ metric: MetricStrip.Metric) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(metric.label.uppercased())
                .font(Theme.FontStyle.sans(11, weight: .semibold))
                .tracking(0.9)
                .foregroundStyle(Theme.Palette.fg2)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(metric.displayValue)
                    .font(Theme.FontStyle.mono(22, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if showsUnit(metric) {
                    Text(metric.unit)
                        .font(Theme.FontStyle.mono(12))
                        .foregroundStyle(Theme.Palette.fg3)
                        .lineLimit(1)
                }
                if let arrow = Tone.arrow(metric.direction) {
                    Image(systemName: arrow)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Tone.color(metric.tone))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "11.9" + "strain" reads well; "54%" + "%" would double up. Suppress the
    /// unit only when display_value already spells it out (case-insensitively,
    /// anywhere in the string) — a whitelist of "allowed" characters wrongly
    /// hid the unit for perfectly normal display values like "≈47 ms" or a
    /// "39–45%" range that never actually mentions the unit text itself.
    private func showsUnit(_ metric: MetricStrip.Metric) -> Bool {
        CoachUnitDisplay.shows(unit: metric.unit, displayValue: metric.displayValue)
    }
}

// MARK: Comparison

private struct ComparisonView: View {
    let comparison: Comparison

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CoachCardLabel(comparison.title)
                .padding(.bottom, 6)
            ForEach(Array(comparison.items.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Divider().overlay(Theme.Palette.borderSubtle)
                }
                row(item)
                    .padding(.vertical, 10)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(comparison.fallback)
    }

    private func row(_ item: Comparison.Item) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.label)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg1)
                Spacer(minLength: 8)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(item.current.map(CoachNumber.format) ?? "—")
                        .font(Theme.FontStyle.mono(18, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                    if !item.unit.isEmpty {
                        Text(item.unit)
                            .font(Theme.FontStyle.mono(12))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
            HStack(spacing: 8) {
                if let baseline = item.baseline {
                    Text("vs \(CoachNumber.format(baseline))")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                Spacer(minLength: 0)
                if let delta = deltaText(item) {
                    HStack(spacing: 3) {
                        if let arrow = Tone.arrow(item.direction) {
                            Image(systemName: arrow)
                                .font(.system(size: 9, weight: .bold))
                        }
                        Text(delta)
                            .font(Theme.FontStyle.mono(11, weight: .medium))
                    }
                    .foregroundStyle(Theme.Palette.fg1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.white.opacity(0.07), in: Capsule())
                }
            }
        }
    }

    private func deltaText(_ item: Comparison.Item) -> String? {
        guard let delta = item.delta else { return nil }
        let sign = delta > 0 ? "+" : ""
        var text = "\(sign)\(CoachNumber.format(delta))"
        if let baseline = item.baseline, baseline != 0 {
            let pct = delta / abs(baseline) * 100
            text += " · \(pct > 0 ? "+" : "")\(pct.formatted(.number.precision(.fractionLength(0))))%"
        }
        return text
    }
}

// MARK: Action plan

private struct ActionPlanView: View {
    let plan: ActionPlan

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(plan.title)
                .font(Theme.FontStyle.sans(16, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(Array(plan.sections.enumerated()), id: \.offset) { _, section in
                VStack(alignment: .leading, spacing: 8) {
                    CoachCardLabel(section.timeframe)
                    ForEach(Array(section.items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: "circle")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg3)
                            Text(MarkdownView.inline(item, emphasis: Theme.Palette.fg0))
                                .font(Theme.FontStyle.sans(14.5))
                                .foregroundStyle(Theme.Palette.fg1)
                                .lineSpacing(3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: Data freshness

private struct DataFreshnessView: View {
    let block: DataFreshness
    let api: APIClient
    @State private var state = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CoachCardLabel("Data freshness")
            ForEach(block.sources, id: \.source) { source in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Circle()
                        .fill(color(source.status))
                        .frame(width: 7, height: 7)
                        .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 2 }
                    Text(source.source)
                        .font(Theme.FontStyle.sans(14))
                        .foregroundStyle(Theme.Palette.fg1)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(dateText(source.lastAvailableDate))
                        .font(Theme.FontStyle.mono(12))
                        .foregroundStyle(Theme.Palette.fg2)
                    Text(source.status.capitalized)
                        .font(Theme.FontStyle.mono(11, weight: .medium))
                        .foregroundStyle(color(source.status))
                        .frame(minWidth: 52, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
            }
            if block.syncAvailable {
                Button {
                    Task {
                        state = "Syncing…"
                        do { _ = try await api.postSync(); state = "Sync requested" } catch { state = "Sync failed" }
                    }
                } label: {
                    Label(state.isEmpty ? "Sync now" : state, systemImage: "arrow.triangle.2.circlepath")
                        .font(Theme.FontStyle.sans(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 36)
                        .background(Color.white.opacity(0.07), in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.Palette.borderDefault))
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(state == "Syncing…")
            }
        }
    }

    private func color(_ status: String) -> Color {
        switch status {
        case "fresh": return Theme.Palette.success
        case "stale": return Theme.Palette.warning
        case "missing": return Theme.Palette.danger
        default: return Theme.Palette.info
        }
    }

    private func dateText(_ raw: String?) -> String {
        guard let raw else { return "No data" }
        guard let date = ChartDate.parse(raw) else { return raw }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

// MARK: Workout plan

private struct WorkoutPlanView: View {
    let plan: CoachWorkoutPlanBlock

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(plan.title)
                    .font(Theme.FontStyle.sans(16, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
                Spacer(minLength: 8)
                if let date = plan.date {
                    Text(ChartDate.parse(date)?.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) ?? date)
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            .padding(.bottom, 8)
            ForEach(Array(plan.exercises.enumerated()), id: \.offset) { index, exercise in
                if index > 0 {
                    Divider().overlay(Theme.Palette.borderSubtle)
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(exercise.name)
                            .font(Theme.FontStyle.sans(14.5, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg1)
                        Spacer(minLength: 8)
                        Text(exercise.prescription)
                            .font(Theme.FontStyle.mono(12.5))
                            .foregroundStyle(Theme.Palette.fg0)
                            .multilineTextAlignment(.trailing)
                    }
                    if !exercise.notes.isEmpty {
                        Text(exercise.notes)
                            .font(Theme.FontStyle.sans(12.5))
                            .foregroundStyle(Theme.Palette.fg3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, 9)
            }
            NavigationLink(destination: PlansView()) {
                HStack(spacing: 4) {
                    Text("Open in Plans")
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                }
                .font(Theme.FontStyle.sans(13, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(plan.fallback)
    }
}

// MARK: Evidence

private struct EvidenceView: View {
    let evidence: Evidence
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg2)
                    Text(evidence.title)
                        .font(Theme.FontStyle.sans(14, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg1)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg3)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .padding(.horizontal, Theme.Spacing.md)
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(evidence.title)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")

            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(evidence.dateRange) · \(evidence.recordCount) records · \(evidence.missingDays) missing")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                    if !evidence.sources.isEmpty {
                        Text(evidence.sources.joined(separator: ", "))
                            .font(Theme.FontStyle.sans(12.5))
                            .foregroundStyle(Theme.Palette.fg2)
                    }
                    ForEach(evidence.points, id: \.self) { point in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Circle().fill(Theme.Palette.fg3).frame(width: 4, height: 4)
                                .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 2 }
                            Text(point)
                                .font(Theme.FontStyle.sans(13))
                                .foregroundStyle(Theme.Palette.fg2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.bottom, Theme.Spacing.md)
                .transition(.opacity)
            }
        }
    }
}
