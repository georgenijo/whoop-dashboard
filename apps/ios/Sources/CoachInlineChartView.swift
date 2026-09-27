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

/// Mermaid `xychart-beta` fences render through the same card as rich chart blocks.
struct CoachInlineChartView: View {
    let chart: CoachChartSpec

    var body: some View {
        CoachChartCard(
            block: ChartBlock(
                fallback: chart.title,
                title: chart.title,
                labels: chart.labels,
                series: [
                    ChartBlock.Series(
                        id: "value",
                        label: chart.title,
                        unit: chart.unit,
                        kind: chart.kind == .bar ? "bar" : "line",
                        values: chart.values.map { Optional($0) }
                    )
                ],
                references: [],
                anomalies: []
            ),
            yDomain: chart.yMin.flatMap { lower in chart.yMax.map { lower...$0 } }
        )
    }
}

enum CoachAccent {
    /// Picks the metric accent the rest of the app uses for the same data.
    static func color(for text: String) -> Color {
        let t = text.lowercased()
        if t.contains("hrv") || t.contains("variability") { return Theme.Palette.hrv }
        if t.contains("resting") || t.contains("rhr") || t.contains("bpm") || t.contains("heart rate") {
            return Theme.Palette.rhr
        }
        if t.contains("recovery") { return Theme.Palette.recovery }
        if t.contains("sleep") || t.contains("hours") { return Theme.Palette.sleepRem }
        if t.contains("strain") || t.contains("kj") || t.contains("calor") { return Theme.Palette.strain }
        if t.contains("step") { return Theme.Palette.info }
        if t.contains("spo2") || t.contains("oxygen") { return Theme.Palette.spo2 }
        if t.contains("resp") { return Theme.Palette.respiration }
        if t.contains("temp") { return Theme.Palette.skinTemp }
        return Theme.Palette.ai
    }
}

enum CoachNumber {
    static func format(_ value: Double) -> String {
        let magnitude = abs(value)
        let digits = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2
        return value.formatted(.number.precision(.fractionLength(0...digits)))
    }

    /// Mirrors `MetricChart.axisLabel`: precision follows tick spacing (the
    /// domain span), not the raw magnitude, so a tight domain like 100...101
    /// still prints distinct ticks instead of duplicate rounded integers.
    static func axis(_ value: Double, domain: ClosedRange<Double>) -> String {
        let step = (domain.upperBound - domain.lowerBound) / 3
        let digits = value.rounded() == value || step >= 1 ? 0 : (step >= 0.1 ? 1 : 2)
        return value.formatted(.number.precision(.fractionLength(digits)))
    }
}

/// Pure helper for chart Y-domain math, factored out of `CoachChartCard` so
/// negative-value handling can be unit tested without SwiftUI/Charts.
enum CoachChartDomain {
    static func range(lo: Double, hi: Double, hasBars: Bool) -> ClosedRange<Double> {
        if hasBars {
            let barLo = min(0, lo)
            let barHi = max(0, hi)
            if barLo == 0 {
                return 0...max(barHi * 1.1, 1)
            }
            let span = max(barHi - barLo, 1)
            return (barLo - span * 0.05)...(barHi + span * 0.1)
        }
        if lo >= 0 && lo < (hi - lo) * 0.25 {
            return 0...max(hi * 1.1, 1)
        }
        let span = max(hi - lo, max(abs(hi) * 0.05, 1))
        return (lo - span * 0.15)...(hi + span * 0.15)
    }
}

/// Stable color/dash encodings for secondary chart series, shared by marks and legend.
enum CoachSeriesEncoding {
    static let colors: [Color] = [
        Theme.Palette.info,
        Theme.Palette.warning,
        Theme.Palette.hrv,
        Theme.Palette.rhr,
        Theme.Palette.respiration
    ]

    /// Dash patterns for secondary series only — solid is reserved for the
    /// primary series so a secondary line is never mistaken for it.
    static let dashes: [[CGFloat]] = [
        [5, 3],
        [1, 3],
        [8, 3, 2, 3]
    ]

    /// Picks a color for a secondary series, excluding the primary's accent
    /// color from the candidate pool first so the first secondary series
    /// never lands on the same color as the primary.
    static func color(at index: Int, excluding accent: Color) -> Color {
        let candidates = colors.filter { $0 != accent }
        let pool = candidates.isEmpty ? colors : candidates
        return pool[((index % pool.count) + pool.count) % pool.count]
    }

    static func dash(at index: Int) -> [CGFloat] {
        dashes[((index % dashes.count) + dashes.count) % dashes.count]
    }

    /// True when both neighbouring values are missing, so a line series would
    /// otherwise draw nothing for this point.
    static func isIsolated(values: [Double?], at index: Int) -> Bool {
        guard values.indices.contains(index) else { return false }
        let prevMissing = index == 0 || values[index - 1] == nil
        let nextMissing = index == values.count - 1 || values[index + 1] == nil
        return prevMissing && nextMissing
    }
}

/// Coach chart in the app's MetricChart language: a headline number that follows
/// the scrub, restrained axes, dashed reference rules, and highlighted anomalies.
struct CoachChartCard: View {
    let block: ChartBlock
    var yDomain: ClosedRange<Double>? = nil

    @State private var selectedKey: String?
    @State private var showsTable = false

    private struct Mark: Identifiable {
        let series: Int
        let seriesId: String
        let index: Int
        let value: Double
        let isBar: Bool
        /// True when both neighbouring points in the same series are missing,
        /// so a line series would otherwise draw nothing for this value.
        let isIsolated: Bool
        var id: String { "\(seriesId):\(index)" }
        var key: String { String(index) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            titleRow
            if showsTable {
                table
            } else {
                headline
                chart
                footnotes
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    // MARK: Derived

    private var primaryIndex: Int {
        block.series.firstIndex { $0.kind == "bar" } ?? 0
    }

    private var primary: ChartBlock.Series? {
        block.series.indices.contains(primaryIndex) ? block.series[primaryIndex] : nil
    }

    private var accent: Color {
        CoachAccent.color(for: "\(block.title) \(primary?.label ?? "") \(primary?.unit ?? "")")
    }

    private var hasBars: Bool { block.series.contains { $0.kind == "bar" } }

    private var keys: [String] { block.labels.indices.map(String.init) }

    private var anomalies: [Int: String] {
        Dictionary(
            block.anomalies
                .filter { block.labels.indices.contains($0.index) }
                .map { ($0.index, $0.label) },
            uniquingKeysWith: { first, _ in first }
        )
    }

    private var selectedIndex: Int? { selectedKey.flatMap { Int($0) } }

    private var focusIndex: Int? {
        if let selectedIndex { return selectedIndex }
        return primary.flatMap { series in series.values.lastIndex { $0 != nil } }
    }

    private func value(_ series: ChartBlock.Series, _ index: Int) -> Double? {
        series.values.indices.contains(index) ? series.values[index] : nil
    }

    private var marks: [Mark] {
        block.series.enumerated().flatMap { seriesIndex, series in
            block.labels.indices.compactMap { index -> Mark? in
                guard let v = value(series, index) else { return nil }
                return Mark(
                    series: seriesIndex,
                    seriesId: series.id,
                    index: index,
                    value: v,
                    isBar: series.kind == "bar",
                    isIsolated: CoachSeriesEncoding.isIsolated(values: series.values, at: index)
                )
            }
        }
    }

    private var domain: ClosedRange<Double> {
        if let yDomain { return yDomain }
        let all = marks.map(\.value) + block.references.map(\.value)
        let lo = all.min() ?? 0
        let hi = all.max() ?? 1
        return CoachChartDomain.range(lo: lo, hi: hi, hasBars: hasBars)
    }

    /// Stable position of a non-primary series among the other series, used to
    /// index into `CoachSeriesEncoding` so each secondary series (line or bar)
    /// keeps the same color/dash across marks and legend.
    private func secondaryEncodingIndex(for seriesIndex: Int) -> Int {
        block.series.indices.filter { $0 != primaryIndex }.firstIndex(of: seriesIndex) ?? 0
    }

    private func secondaryColor(for seriesIndex: Int) -> Color {
        CoachSeriesEncoding.color(at: secondaryEncodingIndex(for: seriesIndex), excluding: accent)
    }

    private func secondaryDash(for seriesIndex: Int) -> [CGFloat] {
        CoachSeriesEncoding.dash(at: secondaryEncodingIndex(for: seriesIndex))
    }

    // MARK: Header

    private var titleRow: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            Text(block.title.uppercased())
                .font(Theme.FontStyle.sans(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg2)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                withAnimation(.snappy) { showsTable.toggle() }
            } label: {
                Image(systemName: showsTable ? "chart.bar.xaxis" : "tablecells")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg2)
                    .frame(width: 34, height: 26)
                    .background(Color.white.opacity(0.06), in: Capsule())
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.vertical, -12)
            .padding(.trailing, -6)
            .accessibilityLabel(showsTable ? "Show chart" : "Show table")
            .sensoryFeedback(.selection, trigger: showsTable)
        }
    }

    private var headline: some View {
        let focus = focusIndex
        let focusValue = focus.flatMap { index in primary.flatMap { value($0, index) } }
        return HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(focusValue.map(CoachNumber.format) ?? "—")
                    .font(Theme.FontStyle.mono(30, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .contentTransition(.numericText())
                if let unit = primary?.unit, !unit.isEmpty {
                    Text(unit)
                        .font(Theme.FontStyle.mono(13))
                        .foregroundStyle(accent)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 2) {
                if let focus, block.labels.indices.contains(focus) {
                    Text(selectedIndex == nil ? "Latest · \(block.labels[focus])" : block.labels[focus])
                        .font(Theme.FontStyle.mono(11, weight: .medium))
                        .foregroundStyle(selectedIndex == nil ? Theme.Palette.fg2 : Theme.Palette.fg0)
                        .lineLimit(1)
                }
                Text(secondaryCaption(focus))
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .lineLimit(1)
            }
        }
        .animation(.snappy(duration: 0.15), value: selectedKey)
    }

    private func secondaryCaption(_ focus: Int?) -> String {
        if selectedIndex != nil, let focus,
           let other = block.series.enumerated().first(where: { $0.offset != primaryIndex })?.element,
           let v = value(other, focus) {
            return "\(other.label.lowercased()) \(CoachNumber.format(v))"
        }
        guard let primary else { return "" }
        let values = primary.values.compactMap { $0 }
        guard !values.isEmpty else { return "" }
        return "avg \(CoachNumber.format(values.reduce(0, +) / Double(values.count)))"
    }

    // MARK: Chart

    private var chart: some View {
        let marks = marks
        let domain = domain
        let anomalies = anomalies
        let selected = selectedIndex
        let barsDimmed = !anomalies.isEmpty
        let area = LinearGradient(colors: [accent.opacity(0.26), accent.opacity(0)], startPoint: .top, endPoint: .bottom)
        return Chart {
            ForEach(Array(block.references.enumerated()), id: \.offset) { _, reference in
                RuleMark(y: .value("Reference", reference.value))
                    .foregroundStyle(Theme.Palette.fg3.opacity(0.8))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .annotation(position: .top, alignment: .leading, spacing: 3) {
                        Text("\(reference.label) · \(CoachNumber.format(reference.value))")
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg2)
                            .lineLimit(1)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Theme.Palette.bg1.opacity(0.85), in: RoundedRectangle(cornerRadius: 4))
                    }
            }

            ForEach(marks) { mark in
                if mark.isBar {
                    BarMark(
                        x: .value("Period", mark.key),
                        y: .value("Value", mark.value),
                        width: .ratio(0.72)
                    )
                    .position(by: .value("Series", mark.seriesId))
                    .foregroundStyle(barColor(mark).opacity(
                        barOpacity(mark, selected: selected, highlighted: anomalies[mark.index] != nil, dimmed: barsDimmed)
                    ))
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                } else if mark.series == primaryIndex {
                    AreaMark(
                        x: .value("Period", mark.key),
                        yStart: .value("Floor", domain.lowerBound),
                        yEnd: .value("Value", mark.value),
                        series: .value("Series", mark.seriesId)
                    )
                    .interpolationMethod(.monotone)
                    .foregroundStyle(area)
                    LineMark(
                        x: .value("Period", mark.key),
                        y: .value("Value", mark.value),
                        series: .value("Series", mark.seriesId)
                    )
                    .interpolationMethod(.monotone)
                    .foregroundStyle(accent)
                    .lineStyle(StrokeStyle(lineWidth: 2.25, lineCap: .round, lineJoin: .round))
                    if mark.isIsolated {
                        PointMark(x: .value("Period", mark.key), y: .value("Value", mark.value))
                            .symbolSize(36)
                            .foregroundStyle(accent)
                    }
                    if anomalies[mark.index] != nil {
                        PointMark(x: .value("Period", mark.key), y: .value("Value", mark.value))
                            .symbol(Circle().strokeBorder(lineWidth: 2))
                            .symbolSize(64)
                            .foregroundStyle(Theme.Palette.warning)
                    }
                } else {
                    LineMark(
                        x: .value("Period", mark.key),
                        y: .value("Value", mark.value),
                        series: .value("Series", mark.seriesId)
                    )
                    .interpolationMethod(.monotone)
                    .foregroundStyle(secondaryColor(for: mark.series))
                    .lineStyle(StrokeStyle(
                        lineWidth: 1.5,
                        lineCap: .round,
                        lineJoin: .round,
                        dash: secondaryDash(for: mark.series)
                    ))
                    if mark.isIsolated {
                        PointMark(x: .value("Period", mark.key), y: .value("Value", mark.value))
                            .symbolSize(30)
                            .foregroundStyle(secondaryColor(for: mark.series))
                    }
                }
            }

            if let selected {
                RuleMark(x: .value("Selected", String(selected)))
                    .foregroundStyle(Theme.Palette.fg2.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                if !hasBars, let primary, let v = value(primary, selected) {
                    PointMark(x: .value("Period", String(selected)), y: .value("Value", v))
                        .symbolSize(80)
                        .foregroundStyle(Theme.Palette.fg0)
                }
            }
        }
        .chartLegend(.hidden)
        .chartXScale(domain: keys)
        .chartYScale(domain: domain)
        .chartXSelection(value: $selectedKey)
        .chartXAxis {
            AxisMarks(values: tickKeys) { value in
                AxisValueLabel(anchor: anchor(for: value.as(String.self))) {
                    if let key = value.as(String.self), let index = Int(key), block.labels.indices.contains(index) {
                        Text(block.labels[index])
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                    .foregroundStyle(Theme.Palette.borderDefault)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(CoachNumber.axis(v, domain: domain))
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
        }
        .frame(height: 180)
        .sensoryFeedback(.selection, trigger: selectedKey)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(block.title)
        .accessibilityValue(block.fallback)
    }

    private var tickKeys: [String] {
        let n = block.labels.count
        guard n > 0 else { return [] }
        if n <= 6 { return keys }
        var seen = Set<Int>()
        return [0, n / 3, (2 * n) / 3, n - 1].filter { seen.insert($0).inserted }.map(String.init)
    }

    private func anchor(for key: String?) -> UnitPoint {
        guard block.labels.count > 6, let key, let index = Int(key) else { return .top }
        if index == 0 { return .topLeading }
        if index == block.labels.count - 1 { return .topTrailing }
        return .top
    }

    private func barColor(_ mark: Mark) -> Color {
        mark.series == primaryIndex ? accent : secondaryColor(for: mark.series)
    }

    private func barOpacity(_ mark: Mark, selected: Int?, highlighted: Bool, dimmed: Bool) -> Double {
        if let selected { return selected == mark.index ? 1 : 0.3 }
        if dimmed { return highlighted ? 1 : 0.45 }
        return 0.85
    }

    // MARK: Footnotes

    @ViewBuilder
    private var footnotes: some View {
        let others = block.series.enumerated().filter { $0.offset != primaryIndex }
        let notes = anomalies.sorted { $0.key < $1.key }
        if !others.isEmpty || !notes.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                if !others.isEmpty, let primary {
                    HStack(spacing: 14) {
                        legendItem(primary.label, color: accent, isLine: primary.kind != "bar")
                        ForEach(others, id: \.element.id) { offset, series in
                            legendItem(
                                series.label,
                                color: secondaryColor(for: offset),
                                isLine: series.kind != "bar",
                                dash: secondaryDash(for: offset)
                            )
                        }
                    }
                }
                ForEach(notes, id: \.key) { note in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle()
                            .fill(hasBars ? accent : Theme.Palette.warning)
                            .frame(width: 6, height: 6)
                            .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 2 }
                        Text(anomalyText(index: note.key, label: note.value))
                            .font(Theme.FontStyle.sans(12.5))
                            .foregroundStyle(Theme.Palette.fg2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(.top, 2)
        }
    }

    private func anomalyText(index: Int, label: String) -> String {
        let period = block.labels[index]
        return label.localizedCaseInsensitiveContains(period) ? label : "\(period) · \(label)"
    }

    private func legendItem(_ label: String, color: Color, isLine: Bool, dash: [CGFloat] = []) -> some View {
        HStack(spacing: 6) {
            if isLine {
                Path { path in
                    path.move(to: CGPoint(x: 0, y: 1))
                    path.addLine(to: CGPoint(x: 12, y: 1))
                }
                .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: dash))
                .frame(width: 12, height: 2)
            } else {
                RoundedRectangle(cornerRadius: 1)
                    .fill(color)
                    .frame(width: 8, height: 8)
            }
            Text(label)
                .font(Theme.FontStyle.mono(11))
                .foregroundStyle(Theme.Palette.fg2)
                .lineLimit(1)
        }
    }

    // MARK: Table

    private var table: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 0) {
            GridRow {
                Text("PERIOD")
                ForEach(block.series) { series in
                    Text(series.unit.isEmpty ? series.label.uppercased() : "\(series.label.uppercased()) (\(series.unit))")
                        .lineLimit(2)
                        .gridColumnAlignment(.trailing)
                }
            }
            .font(Theme.FontStyle.sans(11, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.Palette.fg3)
            .padding(.bottom, 8)
            ForEach(Array(block.labels.enumerated()), id: \.offset) { index, label in
                Divider().overlay(Theme.Palette.borderSubtle)
                GridRow {
                    HStack(spacing: 6) {
                        Text(label)
                            .foregroundStyle(Theme.Palette.fg2)
                        if anomalies[index] != nil {
                            Circle().fill(accent).frame(width: 5, height: 5)
                        }
                    }
                    ForEach(block.series) { series in
                        Text(value(series, index).map(CoachNumber.format) ?? "—")
                            .foregroundStyle(Theme.Palette.fg0)
                    }
                }
                .font(Theme.FontStyle.mono(12.5))
                .monospacedDigit()
                .padding(.vertical, 7)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(block.title) table")
    }
}

#Preview("Coach charts") {
    ScrollView {
        VStack(spacing: 16) {
            CoachChartCard(block: ChartBlock(
                fallback: "Sleep",
                title: "Sleep — Sep 9–15",
                labels: ["Sep 9", "Sep 10", "Sep 11", "Sep 12", "Sep 13", "Sep 14", "Sep 15"],
                series: [
                    .init(id: "sleep", label: "Sleep duration", unit: "hours", kind: "bar", values: [5.6, 6.95, 4.98, 6.52, 6.75, 5.89, 4.64]),
                    .init(id: "need", label: "Baseline need", unit: "hours", kind: "line", values: [7.8, 7.8, 7.79, 7.79, 7.79, 7.79, 7.79])
                ],
                references: [],
                anomalies: [.init(index: 6, label: "Weekly low")]
            ))
            if let spec = CoachChartSpec.parseMermaid("""
            xychart-beta
                title "Morning HRV"
                x-axis ["7/19","7/22","7/25","7/28","7/31"]
                y-axis "ms" 25 --> 55
                line [43,45,30,41,47]
            """) {
                CoachInlineChartView(chart: spec)
            }
        }
        .padding()
    }
    .background(Color.black)
    .preferredColorScheme(.dark)
}

