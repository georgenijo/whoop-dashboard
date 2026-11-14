import SwiftUI
import Charts

struct CardLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(Theme.FontStyle.sans(15, weight: .medium))
            .foregroundStyle(Theme.Palette.fg0)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - All time

struct AllTimeHero: View {
    let allTime: StatsPayload.AllTime
    let historyFloor: String?
    var embedded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    CardLabel("All time")
                    if let since = StatsFormat.monthYear(fromDay: historyFloor) {
                        Text("since \(since)")
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    Spacer(minLength: 0)
                }
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(StatsFormat.grouped(Double(allTime.workouts)))
                        .font(Theme.FontStyle.mono(56, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .contentTransition(.numericText())
                    Text(allTime.workouts == 1 ? "workout" : "workouts")
                        .font(Theme.FontStyle.sans(17, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg2)
                }
                .padding(.top, 6)
            }
            .padding(Theme.Spacing.lg)

            LedgerRule()
            HStack(alignment: .top, spacing: 0) {
                stat(StatsFormat.hours(seconds: allTime.activeSeconds), unit: "h", label: "Active")
                stat(StatsFormat.miles(meters: allTime.distanceM), unit: "mi", label: "Distance")
                stat(StatsFormat.calories(kilojoules: allTime.kilojoules), unit: "cal", label: "Energy")
            }
        }
        .cardChrome(embedded: embedded, padding: 0)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("All time")
        .accessibilityValue(
            "\(allTime.workouts) workouts, \(StatsFormat.hours(seconds: allTime.activeSeconds)) hours active, "
            + "\(StatsFormat.miles(meters: allTime.distanceM)) miles, \(StatsFormat.calories(kilojoules: allTime.kilojoules)) calories"
        )
    }

    private func stat(_ value: String, unit: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(Theme.FontStyle.mono(22, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                if value != "—" {
                    Text(unit)
                        .font(Theme.FontStyle.mono(12))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text(label)
                .font(Theme.FontStyle.sans(13))
                .foregroundStyle(Theme.Palette.fg2)
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .trailing) {
            if label != "Energy" { Rectangle().fill(Theme.Palette.borderSubtle).frame(width: 1) }
        }
    }
}

// MARK: - Year over year

struct YearOverYearCard: View {
    let yoy: StatsPayload.YoY
    let historyFloor: String?
    var embedded = false

    private var summary: String? {
        StatsFormat.yoyVerdict(
            changes: yoy.metrics.compactMap { StatsFormat.change(current: $0.current, prior: $0.prior) },
            priorYear: yoy.priorYear)
    }

    private var priorYearIsPartial: Bool {
        guard let historyFloor else { return false }
        return historyFloor > "\(yoy.priorYear)-01-01"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                CardLabel("\(String(yoy.year)) vs \(String(yoy.priorYear))")
                Text(yoy.periodLabel)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
                Spacer(minLength: 0)
            }

            if let summary {
                Text(summary)
                    .font(Theme.FontStyle.sans(17))
                    .foregroundStyle(Theme.Palette.fg1)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }

            VStack(spacing: 20) {
                ForEach(yoy.metrics) { metric in
                    YoYRow(metric: metric, year: yoy.year, priorYear: yoy.priorYear)
                }
            }
            .padding(.top, 20)

            if priorYearIsPartial, let floor = StatsFormat.monthYear(fromDay: historyFloor) {
                Label("History starts \(floor), so \(String(yoy.priorYear)) is incomplete.", systemImage: "info.circle")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
                    .padding(.top, 16)
            }
        }
        .cardChrome(embedded: embedded, padding: Theme.Spacing.lg)
    }
}

private struct YoYRow: View {
    let metric: StatsPayload.YoY.Metric
    let year: Int
    let priorYear: Int

    private var change: StatsFormat.Change? {
        StatsFormat.change(current: metric.current, prior: metric.prior)
    }

    private var scale: Double {
        max(metric.current ?? 0, metric.prior ?? 0, 0.0001)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center) {
                Text(metric.label)
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg1)
                Spacer(minLength: 8)
                if metric.spark.count >= 2 {
                    PaceSpark(values: metric.spark)
                        .frame(width: 96, height: 22)
                        .accessibilityHidden(true)
                }
                if let change { DeltaBadge(change: change) }
            }
            bar(year: year, value: metric.current, isCurrent: true)
            bar(year: priorYear, value: metric.prior, isCurrent: false)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.label)
        .accessibilityValue(spoken)
    }

    private var spoken: String {
        var s = "\(valueText(metric.current)) in \(year), \(valueText(metric.prior)) in \(priorYear)"
        if let change { s += ", \(change.spoken)" }
        return s
    }

    private func valueText(_ v: Double?) -> String {
        guard let v else { return "—" }
        let n = metric.unit == "cal" ? StatsFormat.compact(v) : StatsFormat.number(v)
        return metric.unit.isEmpty ? n : "\(n) \(metric.unit)"
    }

    private func bar(year: Int, value: Double?, isCurrent: Bool) -> some View {
        HStack(spacing: 10) {
            Text(String(year))
                .font(Theme.FontStyle.mono(11, weight: isCurrent ? .medium : .regular))
                .foregroundStyle(isCurrent ? Theme.Palette.fg2 : Theme.Palette.fg3)
                .fixedSize()
                .frame(minWidth: 38, alignment: .leading)
            GeometryReader { geo in
                let fraction = (value ?? 0) / scale
                Rectangle()
                    .fill(isCurrent ? AnyShapeStyle(Theme.Palette.recovery) : AnyShapeStyle(Theme.Palette.fg4.opacity(0.55)))
                    .frame(width: value == nil ? 0 : max(geo.size.width * fraction, 4))
                    .frame(maxHeight: .infinity)
            }
            .frame(height: 8)
            Text(valueText(value))
                .font(Theme.FontStyle.mono(isCurrent ? 15 : 13, weight: isCurrent ? .semibold : .regular))
                .foregroundStyle(isCurrent ? Theme.Palette.fg0 : Theme.Palette.fg2)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: 92, alignment: .trailing)
        }
        .frame(minHeight: 20)
    }
}

private struct DeltaBadge: View {
    let change: StatsFormat.Change

    private var color: Color {
        switch change.direction {
        case .up: return Theme.Palette.fg0
        case .down: return Theme.Palette.fg0
        case .flat: return Theme.Palette.fg2
        }
    }

    private var icon: String {
        switch change.direction {
        case .up: return "arrow.up.right"
        case .down: return "arrow.down.right"
        case .flat: return "arrow.right"
        }
    }

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
            Text(change.text)
                .font(Theme.FontStyle.mono(12, weight: .semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .overlay(Rectangle().strokeBorder(Theme.Palette.borderDefault, lineWidth: 1))
    }
}

/// Monthly pace of the current year, from the payload's per-month `spark`.
private struct PaceSpark: View {
    let values: [Double]

    var body: some View {
        GeometryReader { geo in
            let lo = values.min() ?? 0
            let hi = max(values.max() ?? 1, lo + 0.0001)
            Path { path in
                for (i, v) in values.enumerated() {
                    let x = geo.size.width * CGFloat(i) / CGFloat(max(values.count - 1, 1))
                    let y = geo.size.height * (1 - CGFloat((v - lo) / (hi - lo)))
                    if i == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(Theme.Palette.recovery, style: StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
        }
    }
}

// MARK: - Records

struct RecordsCard: View {
    let records: [StatsPayload.Record]
    var embedded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardLabel("Personal records")
                .padding(.bottom, 6)
            ForEach(Array(records.enumerated()), id: \.element.id) { index, record in
                RecordRow(record: record)
                if index < records.count - 1 { LedgerRule() }
            }
        }
        .cardChrome(embedded: embedded, padding: Theme.Spacing.lg)
    }
}

private struct RecordRow: View {
    let record: StatsPayload.Record

    private var style: (icon: String, tint: Color) {
        switch record.key {
        case "longest_session": return ("stopwatch", Theme.Palette.info)
        case "most_calories": return ("flame", Theme.Palette.strain)
        case "highest_strain": return ("bolt", Theme.Palette.brandStrain)
        case "biggest_week": return ("calendar", Theme.Palette.recovery)
        case "top_hr": return ("heart", Theme.Palette.rhr)
        case "most_sessions_month": return ("trophy", Theme.Palette.hrv)
        default: return ("star", Theme.Palette.fg2)
        }
    }

    var body: some View {
        let style = style
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: style.icon)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(style.tint)
                .frame(width: 28, height: 36)
                .accessibilityHidden(true)
            // The value is the point of the row: it keeps its full width and the
            // label/metadata truncate first. If even that can't fit (narrow
            // phone, accessibility text), the value drops under the label.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 8) {
                    labels
                    Spacer(minLength: 8)
                    valueText(tint: style.tint)
                        .lineLimit(1)
                        .fixedSize()
                }
                VStack(alignment: .leading, spacing: 4) {
                    labels
                    valueText(tint: style.tint)
                }
            }
            .frame(minHeight: 36)
        }
        .padding(.vertical, 11)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(record.label)
        .accessibilityValue([record.valueDisplay, record.meta].compactMap { $0 }.joined(separator: ", "))
    }

    private var labels: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(record.label)
                .font(Theme.FontStyle.sans(15, weight: .medium))
                .foregroundStyle(Theme.Palette.fg1)
                .lineLimit(1)
            if let meta = record.meta {
                Text(StatsFormat.sentenceCase(meta))
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .lineLimit(1)
            }
        }
    }

    private func valueText(tint: Color) -> Text {
        let value = StatsFormat.recordValue(record.valueDisplay)
        var text = Text("")
        for (i, part) in value.parts.enumerated() {
            if i > 0 { text = text + Text(" ") }
            text = text + Text(part.number)
                .font(Theme.FontStyle.mono(20, weight: .medium))
                .foregroundColor(Theme.Palette.fg0)
            if let unit = part.unit {
                text = text + Text(unit.count > 1 ? " \(unit)" : unit)
                    .font(Theme.FontStyle.mono(12))
                    .foregroundColor(tint)
            }
        }
        return text
    }
}

// MARK: - Sport breakdown

struct SportBreakdownCard: View {
    let items: [StatsPayload.SportCount]
    let days: Int
    var window: StatsFormat.Window? = nil
    var embedded = false

    @State private var expanded = false

    private static let collapsedCount = 5

    private var total: Int { items.reduce(0) { $0 + $1.count } }
    private var maxCount: Int { max(items.map(\.count).max() ?? 1, 1) }
    private var visible: [StatsPayload.SportCount] {
        expanded ? items : Array(items.prefix(Self.collapsedCount))
    }

    private var context: String {
        guard let top = items.first, total > 0 else { return "" }
        let name = StatsFormat.sportName(top.sport)
        if items.count == 1 { return "All \(name.lowercased()), over the last \(days) days." }
        let share = Int((Double(top.count) / Double(total) * 100).rounded())
        return "\(name) leads with \(share)% of sessions across \(items.count) sports."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                CardLabel("Last \(days) days")
                if let window, let caption = StatsFormat.windowCaption(window) {
                    Text(caption)
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                Spacer(minLength: 0)
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(total)")
                    .font(Theme.FontStyle.mono(36, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .contentTransition(.numericText())
                Text(total == 1 ? "workout" : "workouts")
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg2)
            }
            .padding(.top, 6)

            VStack(spacing: 0) {
                ForEach(visible) { item in
                    row(item)
                }
            }
            .padding(.top, 12)
            .overlay(alignment: .top) { LedgerRule().padding(.top, 12) }

            if items.count > Self.collapsedCount {
                Button {
                    withAnimation(.snappy) { expanded.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Text(expanded ? "Show fewer" : "Show all \(items.count) sports")
                            .font(Theme.FontStyle.sans(15, weight: .medium))
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .rotationEffect(.degrees(expanded ? 180 : 0))
                    }
                    .foregroundStyle(Theme.Palette.fg2)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .sensoryFeedback(.selection, trigger: expanded)
                .padding(.top, 4)
                .padding(.bottom, -8)
            }
        }
        .cardChrome(embedded: embedded, padding: Theme.Spacing.lg)
    }

    private func row(_ item: StatsPayload.SportCount) -> some View {
        let color = SportPalette.color(for: item.sport)
        let fraction = Double(item.count) / Double(maxCount)
        let share = total > 0 ? Int((Double(item.count) / Double(total) * 100).rounded()) : 0
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(StatsFormat.sportName(item.sport))
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg1)
                    .lineLimit(1)
                Spacer()
                Text("\(item.count)")
                    .font(Theme.FontStyle.mono(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                Text("\(share)%")
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .fixedSize()
                    .frame(minWidth: 38, alignment: .trailing)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Theme.Palette.bg3)
                    Rectangle()
                        .fill(color)
                        .frame(width: max(geo.size.width * fraction, 6))
                }
            }
            .frame(height: 6)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(StatsFormat.sportName(item.sport))
        .accessibilityValue("\(item.count) workouts, \(share) percent")
    }
}

// MARK: - Monthly volume

struct MonthlyVolumeCard: View {
    let trend: [StatsPayload.TrendMonth]
    let window: StatsFormat.Window
    var embedded = false

    @State private var selectedMonth: String?

    private var focus: StatsPayload.TrendMonth? {
        if let selectedMonth, let m = trend.first(where: { $0.month == selectedMonth }) { return m }
        return trend.last
    }

    private func isPartial(_ month: StatsPayload.TrendMonth) -> Bool {
        StatsFormat.isPartial(month: month.month, window: window)
    }

    private func partialSuffix(_ month: StatsPayload.TrendMonth) -> String {
        guard isPartial(month) else { return "" }
        return StatsFormat.isCurrentMonth(month.month, window: window) ? " · so far" : " · partial"
    }


    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    CardLabel("Monthly volume")
                    Text("workouts per month")
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                if let focus {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(focus.count)")
                                .font(Theme.FontStyle.mono(30, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg0)
                                .contentTransition(.numericText())
                            Text("workouts")
                                .font(Theme.FontStyle.mono(13))
                                .foregroundStyle(Theme.Palette.fg2)
                        }
                        Spacer(minLength: 0)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(StatsFormat.monthLong(focus.month) + partialSuffix(focus))
                                .font(Theme.FontStyle.mono(11, weight: .medium))
                                .foregroundStyle(selectedMonth == nil ? Theme.Palette.fg2 : Theme.Palette.fg0)
                            if let strain = focus.avgStrain {
                                Text("avg strain \(strain.formatted(.number.precision(.fractionLength(1))))")
                                    .font(Theme.FontStyle.mono(11))
                                    .foregroundStyle(Theme.Palette.strain)
                            }
                        }
                    }
                    .animation(.snappy(duration: 0.15), value: selectedMonth)
                }
            }

            chart

            if let caption = StatsFormat.partialCaption(trend: trend.map { ($0.month, isPartial($0)) }, window: window) {
                Text(caption)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .cardChrome(embedded: embedded, padding: Theme.Spacing.lg)
    }

    private var chart: some View {
        Chart(trend) { month in
            BarMark(
                x: .value("Month", month.month),
                y: .value("Workouts", month.count),
                width: .ratio(trend.count <= 2 ? 0.4 : 0.6)
            )
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(Theme.Palette.strain.opacity(opacity(for: month)))
            .annotation(position: .top, spacing: 4) {
                Text("\(month.count)")
                    .font(Theme.FontStyle.mono(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg1)
            }
            // Per-bar values so VoiceOver can reach every month's strain, not
            // just the one selected by touch.
            .accessibilityLabel(StatsFormat.monthLong(month.month) + partialSuffix(month))
            .accessibilityValue(accessibilityValue(for: month))
        }
        .chartXSelection(value: $selectedMonth)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let raw = value.as(String.self) {
                        VStack(spacing: 2) {
                            Text(StatsFormat.monthShort(raw))
                                .font(Theme.FontStyle.mono(11))
                                .foregroundStyle(raw == selectedMonth ? Theme.Palette.fg0 : Theme.Palette.fg2)
                            if let strain = trend.first(where: { $0.month == raw })?.avgStrain {
                                Text("strain \(strain.formatted(.number.precision(.fractionLength(1))))")
                                    .font(Theme.FontStyle.mono(11))
                                    .foregroundStyle(Theme.Palette.fg3)
                            }
                        }
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                    .foregroundStyle(Theme.Palette.borderDefault)
                AxisValueLabel {
                    if let v = value.as(Int.self) {
                        Text("\(v)")
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                }
            }
        }
        .frame(height: 170)
        .sensoryFeedback(.selection, trigger: selectedMonth)
    }

    private func accessibilityValue(for month: StatsPayload.TrendMonth) -> String {
        var parts = ["\(month.count) workouts"]
        if let strain = month.avgStrain {
            parts.append("average strain \(strain.formatted(.number.precision(.fractionLength(1))))")
        }
        return parts.joined(separator: ", ")
    }

    private func opacity(for month: StatsPayload.TrendMonth) -> Double {
        if let selectedMonth { return month.month == selectedMonth ? 1 : 0.3 }
        return isPartial(month) ? 0.28 : 0.9
    }
}
