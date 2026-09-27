import SwiftUI
import Charts

/// The app's single trend chart. Built for reading, not decoration:
///
/// - A large headline value (latest day, or the scrubbed day while dragging)
///   so the number you care about never lives in an axis label.
/// - Raw days drawn faint, the 7-day average drawn bold — both at once, so
///   there is no Raw/7d/30d toggle to hunt for.
/// - A dashed period-average rule gives every chart the same reference line.
/// - Monotone interpolation: curves never overshoot past real values the way
///   catmull-rom does.
struct MetricChart: View {
    enum Style { case line, bars }

    struct Marker: Hashable {
        let date: String
        let label: String
    }

    let title: String
    let unit: String
    let accent: Color
    let points: [TrendPoint]
    var style: Style = .line
    var precision: Int = 0
    /// Fixed y-domain; nil picks a padded domain from the data.
    var yDomain: ClosedRange<Double>? = nil
    /// Days to call out (anomalies). Drawn as rings on the raw series.
    var markers: [Marker] = []
    var height: CGFloat = 180
    /// Formats values for the headline and scrub readout. Defaults to
    /// fixed `precision` digits with grouping.
    var format: ((Double) -> String)? = nil

    @State private var selectedDate: Date?

    private var series: [Day] {
        points.compactMap { p in
            guard let date = ChartDate.parse(p.date) else { return nil }
            return Day(date: date, raw: p.raw, trend: p.ma7)
        }
    }

    var body: some View {
        let days = series
        let rawValues = days.compactMap(\.raw)
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            header(days: days, rawValues: rawValues)
            if rawValues.isEmpty {
                empty
            } else {
                chart(days: days, rawValues: rawValues)
            }
        }
    }

    // MARK: Header

    @ViewBuilder
    private func header(days: [Day], rawValues: [Double]) -> some View {
        let average = rawValues.isEmpty ? nil : rawValues.reduce(0, +) / Double(rawValues.count)
        let focus = focusDay(in: days)
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(Theme.FontStyle.sans(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg2)
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(focus?.raw.map(display) ?? "—")
                        .font(Theme.FontStyle.mono(30, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .contentTransition(.numericText())
                    if !unit.isEmpty {
                        Text(unit)
                            .font(Theme.FontStyle.mono(13))
                            .foregroundStyle(accent)
                    }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(focusCaption(focus))
                        .font(Theme.FontStyle.mono(11, weight: .medium))
                        .foregroundStyle(selectedDate == nil ? Theme.Palette.fg2 : Theme.Palette.fg0)
                    Text(secondaryCaption(focus: focus, average: average))
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            .animation(.snappy(duration: 0.15), value: selectedDate)
        }
    }

    private func focusDay(in days: [Day]) -> Day? {
        if let selectedDate {
            // A bar spans its whole calendar day, so the finger anywhere over
            // it selects that day; lines snap to the nearest point.
            if style == .bars {
                let day = Calendar.current.startOfDay(for: selectedDate)
                return days.first { $0.date == day }
            }
            return days.min { abs($0.date.timeIntervalSince(selectedDate)) < abs($1.date.timeIntervalSince(selectedDate)) }
        }
        return days.last(where: { $0.raw != nil })
    }

    private func focusCaption(_ day: Day?) -> String {
        guard let day else { return "" }
        let label = day.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        return selectedDate == nil ? "Latest · \(label)" : label
    }

    private func secondaryCaption(focus: Day?, average: Double?) -> String {
        if selectedDate != nil, let trend = focus?.trend {
            return "7d avg \(display(trend))"
        }
        guard let average else { return "" }
        return "period avg \(display(average))"
    }

    private func display(_ value: Double) -> String {
        if let format { return format(value) }
        return value.formatted(.number.precision(.fractionLength(precision)))
    }

    // MARK: Chart

    private func chart(days: [Day], rawValues: [Double]) -> some View {
        let average = rawValues.reduce(0, +) / Double(rawValues.count)
        let hasTrend = days.contains { $0.trend != nil }
        let domain = yDomain ?? paddedDomain(days: days, rawValues: rawValues)
        let focus = selectedDate.flatMap { _ in focusDay(in: days) }
        let markerDates = Set(markers.map(\.date))

        return Chart {
            RuleMark(y: .value("Average", average))
                .foregroundStyle(Theme.Palette.fg3.opacity(0.7))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))

            ForEach(days) { day in
                rawMarks(day, focus: focus, hasTrend: hasTrend, floor: domain.lowerBound)
                if markerDates.contains(ChartDate.key(day.date)), let raw = day.raw {
                    PointMark(x: .value("Date", day.date), y: .value(title, raw))
                        .symbol(Circle().strokeBorder(lineWidth: 2))
                        .symbolSize(64)
                        .foregroundStyle(Theme.Palette.danger)
                }
            }

            if hasTrend {
                ForEach(days) { day in
                    trendMarks(day, floor: domain.lowerBound)
                }
            }

            if let focus {
                selectionMarks(focus)
            }
        }
        .chartYScale(domain: domain)
        .chartXSelection(value: $selectedDate)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisValueLabel(format: .dateTime.month(.abbreviated).day(), collisionResolution: .greedy)
                    .foregroundStyle(Theme.Palette.fg3)
                    .font(Theme.FontStyle.mono(10))
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                    .foregroundStyle(Theme.Palette.borderDefault)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(axisLabel(v, domain: domain))
                            .font(Theme.FontStyle.mono(10))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
        }
        .frame(height: height)
        .sensoryFeedback(.selection, trigger: focus?.date)
    }

    @ChartContentBuilder
    private func rawMarks(_ day: Day, focus: Day?, hasTrend: Bool, floor: Double) -> some ChartContent {
        if let raw = day.raw {
            switch style {
            case .bars:
                BarMark(x: .value("Date", day.date, unit: .day),
                        y: .value(title, raw))
                    .foregroundStyle(accent.opacity(barOpacity(day: day, focus: focus, hasTrend: hasTrend)))
                    .clipShape(RoundedRectangle(cornerRadius: 2))
            case .line:
                LineMark(x: .value("Date", day.date),
                         y: .value(title, raw),
                         series: .value("Series", "raw"))
                    .interpolationMethod(hasTrend ? .linear : .monotone)
                    .foregroundStyle(accent.opacity(hasTrend ? 0.35 : 1))
                    .lineStyle(StrokeStyle(lineWidth: hasTrend ? 1 : 2, lineCap: .round, lineJoin: .round))
                if !hasTrend {
                    AreaMark(x: .value("Date", day.date),
                             yStart: .value("Floor", floor),
                             yEnd: .value(title, raw))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(areaGradient)
                }
            }
        }
    }

    @ChartContentBuilder
    private func trendMarks(_ day: Day, floor: Double) -> some ChartContent {
        if let trend = day.trend {
            if style == .line {
                AreaMark(x: .value("Date", day.date),
                         yStart: .value("Floor", floor),
                         yEnd: .value("7-day average", trend))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(areaGradient)
            }
            if style == .bars {
                LineMark(x: .value("Date", day.date, unit: .day),
                         y: .value("7-day average", trend),
                         series: .value("Series", "trend"))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Theme.Palette.fg1)
                    .lineStyle(StrokeStyle(lineWidth: 2.25, lineCap: .round, lineJoin: .round))
            } else {
                LineMark(x: .value("Date", day.date),
                         y: .value("7-day average", trend),
                         series: .value("Series", "trend"))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(accent)
                    .lineStyle(StrokeStyle(lineWidth: 2.25, lineCap: .round, lineJoin: .round))
            }
        }
    }

    @ChartContentBuilder
    private func selectionMarks(_ focus: Day) -> some ChartContent {
        if style == .bars {
            RuleMark(x: .value("Selected", focus.date, unit: .day))
                .foregroundStyle(Theme.Palette.fg2.opacity(0.6))
                .lineStyle(StrokeStyle(lineWidth: 1))
        } else {
            RuleMark(x: .value("Selected", focus.date))
                .foregroundStyle(Theme.Palette.fg2.opacity(0.6))
                .lineStyle(StrokeStyle(lineWidth: 1))
        }
        if let raw = focus.raw, style == .line {
            PointMark(x: .value("Date", focus.date), y: .value(title, raw))
                .symbolSize(90)
                .foregroundStyle(Theme.Palette.fg0)
        }
    }

    private var areaGradient: LinearGradient {
        LinearGradient(colors: [accent.opacity(0.28), accent.opacity(0)],
                       startPoint: .top, endPoint: .bottom)
    }

    private func barOpacity(day: Day, focus: Day?, hasTrend: Bool) -> Double {
        if let focus { return focus.date == day.date ? 1 : 0.3 }
        return hasTrend ? 0.55 : 0.85
    }

    private func paddedDomain(days: [Day], rawValues: [Double]) -> ClosedRange<Double> {
        let all = rawValues + days.compactMap(\.trend)
        let lo = all.min() ?? 0
        let hi = all.max() ?? 1
        if style == .bars { return 0 ... max(hi * 1.08, 1) }
        // Widen flat series symmetrically to a minimum span so the axis has
        // distinct ticks instead of a sliver around one value.
        let span = max(hi - lo, max(abs(hi) * 0.05, 1))
        let mid = (lo + hi) / 2
        let lower = mid - span * 0.62
        let upper = mid + span * 0.62
        return (lo >= 0 ? max(0, lower) : lower) ... upper
    }

    /// Axis precision follows tick spacing (~3 ticks), not the headline's
    /// precision, so neighbouring ticks never print the same number.
    private func axisLabel(_ value: Double, domain: ClosedRange<Double>) -> String {
        if abs(value) >= 10_000 {
            return (value / 1000).formatted(.number.precision(.fractionLength(0))) + "k"
        }
        let step = (domain.upperBound - domain.lowerBound) / 3
        let digits = value.rounded() == value || step >= 1 ? 0 : (step >= 0.1 ? 1 : 2)
        return value.formatted(.number.precision(.fractionLength(digits)))
    }

    private var empty: some View {
        VStack(spacing: 8) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.title3)
                .foregroundStyle(Theme.Palette.fg3)
            Text("Not enough data yet")
                .font(Theme.FontStyle.sans(13))
                .foregroundStyle(Theme.Palette.fg2)
        }
        .frame(maxWidth: .infinity, minHeight: height)
    }

    private struct Day: Identifiable {
        let date: Date
        let raw: Double?
        let trend: Double?
        var id: Date { date }
    }
}

#Preview {
    let mock: [TrendPoint] = (0..<30).map { i in
        let day = String(format: "2026-04-%02d", i + 1)
        let v = 60.0 + Double(i) * 0.5 + sin(Double(i) * 0.9) * 14
        return TrendPoint(date: day, raw: v, ma7: 60 + Double(i) * 0.5, ma30: nil)
    }
    return ScrollView {
        VStack(spacing: 12) {
            MetricChart(title: "Recovery", unit: "%", accent: Theme.Palette.recovery, points: mock)
                .glassCard()
            MetricChart(title: "Strain", unit: "", accent: Theme.Palette.strain, points: mock,
                        style: .bars, precision: 1)
                .glassCard()
        }
        .padding()
    }
    .background(Color.black)
    .preferredColorScheme(.dark)
}
