import SwiftUI
import Charts

struct CardLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(Theme.FontStyle.sans(11, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(Theme.Palette.fg2)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - All time

struct AllTimeHero: View {
    let allTime: StatsPayload.AllTime
    let historyFloor: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                CardLabel("All time")
                Spacer()
                if let since = StatsFormat.monthYear(fromDay: historyFloor) {
                    Text("since \(since)")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
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

            Rectangle()
                .fill(Theme.Palette.borderSubtle)
                .frame(height: 1)
                .padding(.top, 14)
                .padding(.bottom, 16)

            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                stat(StatsFormat.hours(seconds: allTime.activeSeconds), unit: "h", label: "Active")
                stat(StatsFormat.miles(meters: allTime.distanceM), unit: "mi", label: "Distance")
                stat(StatsFormat.calories(kilojoules: allTime.kilojoules), unit: "cal", label: "Energy")
            }
        }
        .glassCard(tint: .recovery, padding: Theme.Spacing.lg)
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
            Text(label.uppercased())
                .font(Theme.FontStyle.sans(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Year over year

struct YearOverYearCard: View {
    let yoy: StatsPayload.YoY
    let historyFloor: String?

    private var summary: String? {
        let changes = yoy.metrics.compactMap { StatsFormat.change(current: $0.current, prior: $0.prior) }
        guard !changes.isEmpty else { return nil }
        let ahead = changes.filter(\.isUp).count
        let prior = String(yoy.priorYear)
        if ahead == changes.count { return "Ahead of \(prior) on every measure so far." }
        if ahead == 0 { return "Behind \(prior)'s pace on every measure so far." }
        return "Ahead of \(prior) on \(ahead) of \(changes.count) measures so far."
    }

    private var priorYearIsPartial: Bool {
        guard let historyFloor else { return false }
        return historyFloor > "\(yoy.priorYear)-01-01"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                CardLabel("\(String(yoy.year)) vs \(String(yoy.priorYear))")
                Spacer()
                Text(yoy.periodLabel)
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }

            if let summary {
                Text(summary)
                    .font(Theme.FontStyle.sans(15))
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
        .glassCard(padding: Theme.Spacing.lg)
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
                Spacer()
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
                .frame(width: 38, alignment: .leading)
            GeometryReader { geo in
                let fraction = (value ?? 0) / scale
                Capsule()
                    .fill(isCurrent ? AnyShapeStyle(Theme.Palette.recovery) : AnyShapeStyle(Theme.Palette.fg4))
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

    private var color: Color { change.isUp ? Theme.Palette.success : Theme.Palette.rhr }

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: change.isUp ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 11, weight: .bold))
            Text(change.text)
                .font(Theme.FontStyle.mono(12, weight: .semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.14), in: Capsule())
    }
}

// MARK: - Records

struct RecordsCard: View {
    let records: [StatsPayload.Record]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardLabel("Personal records")
                .padding(.bottom, 6)
            ForEach(Array(records.enumerated()), id: \.element.id) { index, record in
                RecordRow(record: record)
                if index < records.count - 1 {
                    Rectangle()
                        .fill(Theme.Palette.borderSubtle)
                        .frame(height: 1)
                        .padding(.leading, 50)
                }
            }
        }
        .glassCard(padding: Theme.Spacing.lg)
    }
}

private struct RecordRow: View {
    let record: StatsPayload.Record

    private var style: (icon: String, tint: Color) {
        switch record.key {
        case "longest_session": return ("stopwatch.fill", Theme.Palette.info)
        case "most_calories": return ("flame.fill", Theme.Palette.strain)
        case "highest_strain": return ("bolt.fill", Theme.Palette.brandStrain)
        case "biggest_week": return ("calendar", Theme.Palette.recovery)
        case "top_hr": return ("heart.fill", Theme.Palette.rhr)
        case "most_sessions_month": return ("trophy.fill", Theme.Palette.hrv)
        default: return ("star.fill", Theme.Palette.fg2)
        }
    }

    var body: some View {
        let style = style
        HStack(spacing: 14) {
            Image(systemName: style.icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(style.tint)
                .frame(width: 36, height: 36)
                .background(style.tint.opacity(0.14), in: Circle())
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
            .layoutPriority(1)
            Spacer(minLength: 8)
            valueText(tint: style.tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.vertical, 11)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(record.label)
        .accessibilityValue([record.valueDisplay, record.meta].compactMap { $0 }.joined(separator: ", "))
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
            CardLabel("By sport")

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

            Text(context)
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg1)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

            VStack(spacing: 0) {
                ForEach(visible) { item in
                    row(item)
                }
            }
            .padding(.top, 12)

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
        .glassCard(padding: Theme.Spacing.lg)
    }

    private func row(_ item: StatsPayload.SportCount) -> some View {
        let color = Color(hex: item.colorHex)
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
                    .frame(width: 38, alignment: .trailing)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.05))
                    Capsule()
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
    let windowDays: Int

    @State private var selectedMonth: String?

    private var focus: StatsPayload.TrendMonth? {
        if let selectedMonth, let m = trend.first(where: { $0.month == selectedMonth }) { return m }
        return trend.last
    }

    private func isPartial(_ month: StatsPayload.TrendMonth) -> Bool {
        StatsFormat.isPartial(month: month.month, windowDays: windowDays)
    }

    private func partialSuffix(_ month: StatsPayload.TrendMonth) -> String {
        guard isPartial(month) else { return "" }
        return StatsFormat.isCurrentMonth(month.month) ? " · so far" : " · partial"
    }

    private var hasPartial: Bool { trend.contains(where: isPartial) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 6) {
                CardLabel("Monthly volume")
                if let focus {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(focus.count)")
                                .font(Theme.FontStyle.mono(30, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg0)
                                .contentTransition(.numericText())
                            Text("workouts")
                                .font(Theme.FontStyle.mono(13))
                                .foregroundStyle(Theme.Palette.info)
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

            if hasPartial {
                Text("Faded bars are partial months.")
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .glassCard(padding: Theme.Spacing.lg)
    }

    private var chart: some View {
        Chart(trend) { month in
            BarMark(
                x: .value("Month", month.month),
                y: .value("Workouts", month.count),
                width: .ratio(trend.count <= 2 ? 0.4 : 0.6)
            )
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(Theme.Palette.info.opacity(opacity(for: month)))
        }
        .chartXSelection(value: $selectedMonth)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let raw = value.as(String.self) {
                        Text(StatsFormat.monthShort(raw))
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(raw == selectedMonth ? Theme.Palette.fg0 : Theme.Palette.fg3)
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
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Monthly workouts")
        .accessibilityValue(trend.map { "\(StatsFormat.monthLong($0.month)) \($0.count)" }.joined(separator: ", "))
    }

    private func opacity(for month: StatsPayload.TrendMonth) -> Double {
        if let selectedMonth { return month.month == selectedMonth ? 1 : 0.3 }
        return isPartial(month) ? 0.4 : 0.9
    }
}
