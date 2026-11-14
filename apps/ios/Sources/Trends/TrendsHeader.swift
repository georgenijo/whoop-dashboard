import SwiftUI

/// One legend for the whole Trends page instead of one per card.
struct TrendsLegend: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) { items }
            VStack(alignment: .leading, spacing: 4) { items }
        }
        .font(Theme.FontStyle.sans(13))
        .foregroundStyle(Theme.Palette.fg2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Legend: thin line is daily, thick line is the 7-day average, dashed line is the period average.")
    }

    @ViewBuilder
    private var items: some View {
        Label { Text("Daily") } icon: {
            Rectangle().frame(width: 16, height: 1.5)
        }
        Label { Text("7-day average") } icon: {
            Rectangle().frame(width: 16, height: 3)
        }
        Label { Text("Period average") } icon: {
            HStack(spacing: 2) { ForEach(0..<3, id: \.self) { _ in Rectangle().frame(width: 4, height: 1) } }
                .frame(width: 16)
        }
    }
}

extension TrendsFormat {
    /// "Oct 16 – Nov 14 · today is partial" for a trailing window of `days`
    /// ending today (inclusive).
    static func rangeCaption(days: Int, now: Date = Date(), calendar: Calendar = .current) -> String {
        let start = calendar.date(byAdding: .day, value: -(days - 1), to: now) ?? now
        let style = Date.FormatStyle(calendar: calendar).month(.abbreviated).day()
        return "\(start.formatted(style)) – \(now.formatted(style)) · today is partial"
    }
}

/// Cards sharing one outline; callers place `LedgerRule()` between them.
struct LedgerGroup<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0, content: content)
            .glassCard(padding: 0)
    }
}

/// Segment row, range, legend and window caption as one 112 pt header.
struct ActivityHeader: View {
    enum Section: String, CaseIterable { case trends = "Trends", progress = "Progress", workouts = "Workouts" }

    @Binding var section: Section
    @Binding var range: DateRange
    var showsRange: Bool

    var body: some View {
        VStack(spacing: 0) {
            FoldColumns {
                Picker("Activity", selection: $section) {
                    ForEach(Section.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(minHeight: 44)
            } trailing: {
                if showsRange && section != .workouts {
                    RangePicker(selection: $range)
                }
            }
            if showsRange && section == .trends {
                FoldColumns {
                    TrendsLegend()
                } trailing: {
                    Text(TrendsFormat.rangeCaption(days: range.days))
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg3)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, Theme.Spacing.xxs)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.xs)
        .background(Theme.Palette.bg0)
        .measuresFold()
    }
}
