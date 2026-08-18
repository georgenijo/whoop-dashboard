import Charts
import SwiftUI

struct CoachChartSpec: Hashable {
    enum Kind: String, Hashable {
        case line
        case bar
    }

    let kind: Kind
    let title: String
    let unit: String
    let labels: [String]
    let values: [Double]
    let yMin: Double?
    let yMax: Double?

    struct Point: Identifiable {
        let index: Int
        let label: String
        let value: Double

        var id: Int { index }
    }

    var points: [Point] {
        labels.enumerated().map { index, label in
            Point(index: index, label: label, value: values[index])
        }
    }

    static func parseMermaid(_ source: String) -> CoachChartSpec? {
        let lines = source
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard lines.first?.lowercased() == "xychart-beta" else { return nil }

        var title = "Chart"
        var unit = ""
        var labels: [String]?
        var values: [Double]?
        var kind: Kind?
        var yMin: Double?
        var yMax: Double?

        for line in lines.dropFirst() {
            if line.hasPrefix("title "),
               let parsed: String = decodeJSON(String(line.dropFirst(6))) {
                title = String(parsed.prefix(160))
                continue
            }
            if line.hasPrefix("x-axis "),
               let parsed: [String] = decodeJSON(String(line.dropFirst(7))) {
                labels = parsed.map { String($0.prefix(60)) }
                continue
            }
            if line.hasPrefix("y-axis "),
               let bounds = parseYAxis(String(line.dropFirst(7))) {
                unit = bounds.unit
                yMin = bounds.minimum
                yMax = bounds.maximum
                continue
            }
            for candidate in [Kind.line, Kind.bar] where line.hasPrefix("\(candidate.rawValue) ") {
                guard values == nil else { return nil }
                values = decodeJSON(String(line.dropFirst(candidate.rawValue.count + 1)))
                kind = candidate
            }
        }

        guard
            let labels,
            let values,
            let kind,
            (2...100).contains(labels.count),
            labels.count == values.count,
            values.allSatisfy(\.isFinite)
        else { return nil }

        return CoachChartSpec(
            kind: kind,
            title: title,
            unit: unit,
            labels: labels,
            values: values,
            yMin: yMin,
            yMax: yMax
        )
    }

    private static func decodeJSON<T: Decodable>(_ source: String) -> T? {
        try? JSONDecoder().decode(T.self, from: Data(source.utf8))
    }

    private static func parseYAxis(
        _ source: String
    ) -> (unit: String, minimum: Double, maximum: Double)? {
        let parts = source.components(separatedBy: "-->")
        guard parts.count == 2 else { return nil }
        let left = parts[0].trimmingCharacters(in: .whitespaces)
        guard let maximum = Double(parts[1].trimmingCharacters(in: .whitespaces)) else {
            return nil
        }

        let unit: String
        let minimumText: String
        if left.hasPrefix("\"") {
            guard let closingQuote = left.dropFirst().firstIndex(of: "\"") else { return nil }
            unit = String(left[left.index(after: left.startIndex)..<closingQuote])
            minimumText = String(left[left.index(after: closingQuote)...])
                .trimmingCharacters(in: .whitespaces)
        } else {
            unit = ""
            minimumText = left
        }
        guard let minimum = Double(minimumText), minimum < maximum else { return nil }
        return (unit, minimum, maximum)
    }
}

struct CoachInlineChartView: View {
    let chart: CoachChartSpec

    @State private var view: ViewMode = .chart
    @State private var selectedLabel: String?

    private enum ViewMode: String, CaseIterable, Identifiable {
        case chart = "Chart"
        case table = "Table"

        var id: String { rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(chart.title)
                        .font(Theme.FontStyle.sans(13, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg0)
                    Text(chart.unit.isEmpty ? subtitle : "\(subtitle) · \(chart.unit)")
                        .font(Theme.FontStyle.mono(9.5))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                Spacer(minLength: 8)
                Picker("Visualization view", selection: $view) {
                    ForEach(ViewMode.allCases) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 132)
            }

            if view == .chart {
                chartView
                    .frame(height: 220)
                    .accessibilityLabel("\(chart.title) chart")
            } else {
                tableView
            }
        }
        .padding(12)
        .background(Theme.Palette.bg2, in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1)
        )
    }

    private var subtitle: String {
        chart.kind == .line ? "Trend" : "Comparison"
    }

    private var yDomain: ClosedRange<Double> {
        let minimum = chart.values.min() ?? 0
        let maximum = chart.values.max() ?? 1
        let padding = max((maximum - minimum) * 0.12, 1)
        return (chart.yMin ?? minimum - padding)...(chart.yMax ?? maximum + padding)
    }

    @ViewBuilder
    private var chartView: some View {
        Chart(chart.points) { point in
            if chart.kind == .line {
                LineMark(
                    x: .value("Period", point.label),
                    y: .value("Value", point.value)
                )
                .foregroundStyle(Theme.Palette.hrv)
                .lineStyle(.init(lineWidth: 2))
                PointMark(
                    x: .value("Period", point.label),
                    y: .value("Value", point.value)
                )
                .foregroundStyle(Theme.Palette.hrv)
            } else {
                BarMark(
                    x: .value("Period", point.label),
                    y: .value("Value", point.value)
                )
                .foregroundStyle(Theme.Palette.hrv)
                .cornerRadius(3)
            }
            if let selectedPoint, selectedPoint.id == point.id {
                RuleMark(x: .value("Selected period", point.label))
                    .foregroundStyle(Theme.Palette.fg3.opacity(0.45))
                    .annotation(position: .top, spacing: 6) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(point.label)
                                .foregroundStyle(Theme.Palette.fg3)
                            Text(formatted(point.value))
                                .foregroundStyle(Theme.Palette.fg0)
                                .fontWeight(.semibold)
                        }
                        .font(Theme.FontStyle.mono(10))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(Theme.Palette.bg3, in: RoundedRectangle(cornerRadius: 7))
                    }
            }
        }
        .chartYScale(domain: yDomain)
        .chartXSelection(value: $selectedLabel)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: min(chart.labels.count, 6))) {
                AxisValueLabel()
                    .font(Theme.FontStyle.mono(9))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) {
                AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [2, 4]))
                    .foregroundStyle(Theme.Palette.borderSubtle)
                AxisValueLabel()
                    .font(Theme.FontStyle.mono(9))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
    }

    private var selectedPoint: CoachChartSpec.Point? {
        guard let selectedLabel else { return nil }
        return chart.points.first { $0.label == selectedLabel }
    }

    private func formatted(_ value: Double) -> String {
        chart.unit.isEmpty ? value.formatted() : "\(value.formatted()) \(chart.unit)"
    }

    private var tableView: some View {
        VStack(spacing: 0) {
            tableRow(period: "Period", value: "Value", header: true)
            ForEach(chart.points) { point in
                Divider().overlay(Theme.Palette.borderSubtle)
                tableRow(
                    period: point.label,
                    value: formatted(point.value),
                    header: false
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(chart.title) table")
    }

    private func tableRow(period: String, value: String, header: Bool) -> some View {
        HStack {
            Text(period)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(Theme.FontStyle.sans(11, weight: header ? .semibold : .regular))
        .foregroundStyle(header ? Theme.Palette.fg1 : Theme.Palette.fg2)
        .padding(.vertical, 7)
    }
}
