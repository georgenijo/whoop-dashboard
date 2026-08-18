import Charts
import SwiftUI
import UIKit

enum CoachPresentationBlock: Decodable, Hashable {
    case metricStrip(MetricStrip)
    case comparison(Comparison)
    case chart(ChartBlock)
    case actionPlan(ActionPlan)
    case dataFreshness(DataFreshness)
    case workoutPlan(WorkoutPlan)
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
        case "workout_plan": self = .workoutPlan(try WorkoutPlan(from: decoder))
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

struct WorkoutPlan: Decodable, Hashable {
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
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
    }

    @ViewBuilder private func blockView(_ block: CoachPresentationBlock) -> some View {
        Group {
            switch block {
            case .metricStrip(let strip):
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(strip.metrics, id: \.label) { metric in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(metric.label).font(Theme.FontStyle.sans(10)).foregroundStyle(Theme.Palette.fg3)
                                Text(metric.displayValue).font(Theme.FontStyle.mono(16, weight: .semibold)).foregroundStyle(Theme.Palette.fg0)
                                Text(metric.unit + direction(metric.direction)).font(Theme.FontStyle.mono(9)).foregroundStyle(Theme.Palette.fg3)
                            }
                            .frame(minWidth: 96, alignment: .leading)
                        }
                    }
                }
                .accessibilityLabel(strip.fallback)
            case .comparison(let comparison):
                VStack(alignment: .leading, spacing: 8) {
                    Text(comparison.title).font(Theme.FontStyle.sans(13, weight: .semibold))
                    ForEach(comparison.items, id: \.label) { item in
                        HStack { Text(item.label); Spacer(); Text(format(item.current, item.unit)).monospacedDigit() }
                        Text("Baseline \(format(item.baseline, item.unit)) · Δ \(format(item.delta, item.unit))").font(Theme.FontStyle.sans(10)).foregroundStyle(Theme.Palette.fg3)
                    }
                }.accessibilityLabel(comparison.fallback)
            case .chart(let chart): RichCoachChartView(block: chart)
            case .actionPlan(let plan):
                VStack(alignment: .leading, spacing: 8) {
                    Text(plan.title).font(Theme.FontStyle.sans(13, weight: .semibold))
                    ForEach(plan.sections, id: \.timeframe) { section in
                        Text(section.timeframe.capitalized).font(Theme.FontStyle.mono(10, weight: .semibold)).foregroundStyle(Theme.Palette.fg3)
                        ForEach(section.items, id: \.self) { Text("• \($0)").font(Theme.FontStyle.sans(12)) }
                    }
                }.accessibilityLabel(plan.fallback)
            case .dataFreshness(let freshness):
                DataFreshnessView(block: freshness, api: api)
            case .workoutPlan(let plan):
                VStack(alignment: .leading, spacing: 8) {
                    Text(plan.title).font(Theme.FontStyle.sans(13, weight: .semibold))
                    ForEach(plan.exercises, id: \.name) { exercise in
                        Text("\(exercise.name) — \(exercise.prescription)").font(Theme.FontStyle.sans(12))
                        if !exercise.notes.isEmpty { Text(exercise.notes).font(Theme.FontStyle.sans(10)).foregroundStyle(Theme.Palette.fg3) }
                    }
                    NavigationLink("Open Plans", destination: PlansView()).font(Theme.FontStyle.sans(11, weight: .semibold))
                }.accessibilityLabel(plan.fallback)
            case .evidence(let evidence):
                DisclosureGroup(evidence.title) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(evidence.dateRange) · \(evidence.recordCount) records · \(evidence.missingDays) missing days")
                        Text("Sources: \(evidence.sources.joined(separator: ", "))")
                        ForEach(evidence.points, id: \.self) { Text("• \($0)") }
                    }.font(Theme.FontStyle.sans(11)).foregroundStyle(Theme.Palette.fg2)
                }.accessibilityLabel(evidence.fallback)
            }
        }
        .padding(12)
        .background(Theme.Palette.bg2, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.Palette.borderSubtle))
        .contextMenu { ShareLink(item: fallback(block)) { Label("Share summary", systemImage: "square.and.arrow.up") }; Button { UIPasteboard.general.string = fallback(block) } label: { Label("Copy summary", systemImage: "doc.on.doc") } }
    }

    private func direction(_ value: String) -> String { value == "up" ? " · ↑" : value == "down" ? " · ↓" : "" }
    private func format(_ value: Double?, _ unit: String) -> String { guard let value else { return "Not available" }; return "\(value.formatted())\(unit.isEmpty ? "" : " \(unit)")" }
    private func fallback(_ block: CoachPresentationBlock) -> String {
        switch block { case .metricStrip(let x): x.fallback; case .comparison(let x): x.fallback; case .chart(let x): x.fallback; case .actionPlan(let x): x.fallback; case .dataFreshness(let x): x.fallback; case .workoutPlan(let x): x.fallback; case .evidence(let x): x.fallback }
    }
}

private struct DataFreshnessView: View {
    let block: DataFreshness
    let api: APIClient
    @State private var state = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Data freshness").font(Theme.FontStyle.sans(13, weight: .semibold))
            ForEach(block.sources, id: \.source) { source in
                HStack { Text(source.source); Spacer(); Text(source.status.capitalized); Text(source.lastAvailableDate ?? "No data").foregroundStyle(Theme.Palette.fg3) }.font(Theme.FontStyle.sans(11))
            }
            if block.syncAvailable { Button(state.isEmpty ? "Sync now" : state) { Task { state = "Syncing…"; do { _ = try await api.postSync(); state = "Sync requested" } catch { state = "Sync failed" } } }.disabled(state == "Syncing…") }
        }.accessibilityLabel(block.fallback)
    }
}

private struct RichCoachChartView: View {
    let block: ChartBlock
    @State private var table = false
    private struct Point: Identifiable { let id: String; let series: String; let label: String; let value: Double; let kind: String }
    private var points: [Point] { block.series.flatMap { series in block.labels.enumerated().compactMap { index, label in series.values[index].map { Point(id: "\(series.id):\(index)", series: series.label, label: label, value: $0, kind: series.kind) } } } }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text(block.title).font(Theme.FontStyle.sans(13, weight: .semibold)); Spacer(); Toggle("Table", isOn: $table).labelsHidden() }
            if table {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 5) {
                    GridRow { Text("Period"); ForEach(block.series) { Text($0.label) } }
                    ForEach(Array(block.labels.enumerated()), id: \.offset) { index, label in GridRow { Text(label); ForEach(block.series) { Text($0.values[index]?.formatted() ?? "—") } } }
                }.font(Theme.FontStyle.mono(9))
            } else {
                Chart(points) { point in
                    if point.kind == "bar" { BarMark(x: .value("Period", point.label), y: .value("Value", point.value)).foregroundStyle(by: .value("Series", point.series)) }
                    else { LineMark(x: .value("Period", point.label), y: .value("Value", point.value)).foregroundStyle(by: .value("Series", point.series)); PointMark(x: .value("Period", point.label), y: .value("Value", point.value)).foregroundStyle(by: .value("Series", point.series)) }
                }.frame(height: 220).accessibilityLabel("\(block.title). \(block.fallback)")
            }
        }
    }
}
