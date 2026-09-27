import Foundation
import SwiftUI
import XCTest
@testable import Coach

/// Pure-logic coverage for the Coach rendering review fixes: chart domains,
/// series encoding, axis precision, markdown table parsing, unit suppression,
/// and the chat day-divider lookup. Nothing here touches SwiftUI view bodies.
final class CoachRenderingTests: XCTestCase {

    // MARK: Chart domain (negative-value bars)

    func testBarDomainIncludesNegativeValues() {
        let range = CoachChartDomain.range(lo: -0.4, hi: 0.2, hasBars: true)
        XCTAssertLessThanOrEqual(range.lowerBound, -0.4)
        XCTAssertGreaterThanOrEqual(range.upperBound, 0.2)
    }

    func testBarDomainAllPositiveStillFloorsAtZero() {
        let range = CoachChartDomain.range(lo: 4, hi: 10, hasBars: true)
        XCTAssertEqual(range.lowerBound, 0)
        XCTAssertGreaterThanOrEqual(range.upperBound, 10)
    }

    func testBarDomainAllNegative() {
        let range = CoachChartDomain.range(lo: -10, hi: -2, hasBars: true)
        XCTAssertLessThanOrEqual(range.lowerBound, -10)
        XCTAssertGreaterThanOrEqual(range.upperBound, 0)
    }

    func testLineDomainUnaffectedByBarPath() {
        let range = CoachChartDomain.range(lo: 40, hi: 60, hasBars: false)
        XCTAssertLessThan(range.lowerBound, 40)
        XCTAssertGreaterThan(range.upperBound, 60)
    }

    // MARK: Series encoding (distinct color/dash per secondary series)

    func testSeriesEncodingIsDistinctAndStable() {
        let accent = Theme.Palette.rhr
        let colorA = CoachSeriesEncoding.color(at: 0, excluding: accent)
        let colorB = CoachSeriesEncoding.color(at: 1, excluding: accent)
        XCTAssertNotEqual(colorA, colorB)
        XCTAssertEqual(CoachSeriesEncoding.color(at: 0, excluding: accent), colorA)
    }

    func testSeriesEncodingWrapsForManySeries() {
        let index = CoachSeriesEncoding.colors.count
        XCTAssertEqual(
            CoachSeriesEncoding.color(at: index, excluding: .clear),
            CoachSeriesEncoding.color(at: 0, excluding: .clear)
        )
    }

    /// Regression for #3: the first secondary series used to reuse the
    /// primary accent color (Theme.Palette.info) and a solid dash, which made
    /// it indistinguishable from the primary line. Every series — primary
    /// (always solid) plus three secondaries — must now be pairwise distinct
    /// on both color and dash.
    func testPrimaryAndSecondarySeriesAreAllPairwiseDistinct() {
        let accent = Theme.Palette.info
        let secondaryColors = (0..<3).map { CoachSeriesEncoding.color(at: $0, excluding: accent) }
        let allColors = [accent] + secondaryColors
        XCTAssertEqual(Set(allColors).count, allColors.count)

        let primaryDash: [CGFloat] = []
        let secondaryDashes = (0..<3).map { CoachSeriesEncoding.dash(at: $0) }
        let allDashes = [primaryDash] + secondaryDashes
        XCTAssertEqual(Set(allDashes.map { $0.map(String.init).joined() }).count, allDashes.count)
        XCTAssertTrue(secondaryDashes.allSatisfy { !$0.isEmpty })
    }

    // MARK: Isolated-point detection (a lone value between two nulls)

    func testIsolatedPointHasNoNeighbours() {
        let values: [Double?] = [nil, 7.5, nil]
        XCTAssertTrue(CoachSeriesEncoding.isIsolated(values: values, at: 1))
    }

    func testNonIsolatedPointHasAtLeastOneNeighbour() {
        let values: [Double?] = [1, 2, nil]
        XCTAssertFalse(CoachSeriesEncoding.isIsolated(values: values, at: 0))
        XCTAssertFalse(CoachSeriesEncoding.isIsolated(values: values, at: 1))
    }

    func testIsolatedPointAtSeriesEdge() {
        let values: [Double?] = [5, nil, nil]
        XCTAssertTrue(CoachSeriesEncoding.isIsolated(values: values, at: 0))
    }

    // MARK: Axis precision (no duplicate ticks on a tight domain)

    func testAxisPrecisionOnTightHighMagnitudeDomainAvoidsDuplicates() {
        let domain = 100.0...101.0
        let low = CoachNumber.axis(100.0, domain: domain)
        let high = CoachNumber.axis(100.6, domain: domain)
        XCTAssertNotEqual(low, high)
    }

    func testAxisPrecisionOnWideDomainStaysWhole() {
        let domain = 0.0...500.0
        XCTAssertEqual(CoachNumber.axis(120.0, domain: domain), "120")
    }

    /// Regression for #8: the early thousands-abbreviation branch collapsed
    /// 10000/10050/10100 to "10k" three times over. With it removed, ticks in
    /// a tight high-magnitude domain must stay distinct.
    func testAxisOnTightHighMagnitudeDomainYieldsThreeDistinctLabels() {
        let domain = 10_000.0...10_100.0
        let labels = Set([
            CoachNumber.axis(10_000, domain: domain),
            CoachNumber.axis(10_050, domain: domain),
            CoachNumber.axis(10_100, domain: domain)
        ])
        XCTAssertEqual(labels.count, 3)
    }

    // MARK: Markdown table parsing (escaped pipes, overflow rows)

    func testTableSplitsOnUnescapedPipesOnly() throws {
        let source = """
        | A | B |
        |---|---|
        | 1\\|2 | 3 |
        """
        let blocks = MarkdownBlock.parse(source)
        guard case .table(let header, let rows) = blocks.first else {
            return XCTFail("expected a table block")
        }
        XCTAssertEqual(header, ["A", "B"])
        XCTAssertEqual(rows, [["1|2", "3"]])
    }

    /// Regression for #2: a literal escaped backslash followed by a real pipe
    /// (`Walk\\| 30 min`, two backslashes then `|`) must not be read as an
    /// escaped pipe — the first backslash escapes the second, and the pipe
    /// that follows still splits the row.
    func testTableRowWithDoubleBackslashBeforePipeStillSplits() throws {
        let source = """
        | Activity | Duration |
        |---|---|
        | Walk\\\\| 30 min |
        """
        let blocks = MarkdownBlock.parse(source)
        guard case .table(_, let rows) = blocks.first else {
            return XCTFail("expected a table block")
        }
        XCTAssertEqual(rows, [["Walk\\\\", "30 min"]])
    }

    func testTableRowWithMoreCellsThanHeaderMergesOverflow() throws {
        let source = """
        | Metric | Value |
        |---|---|
        | Recovery | 45% | extra | more |
        """
        let blocks = MarkdownBlock.parse(source)
        guard case .table(_, let rows) = blocks.first else {
            return XCTFail("expected a table block")
        }
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].count, 2)
        XCTAssertEqual(rows[0][0], "Recovery")
        XCTAssertEqual(rows[0][1], "45% extra more")
    }

    // MARK: Wide-table first-column labeling

    /// Regression for #7: a prior heuristic hid the header whenever the first
    /// column's value had no digits (e.g. "Low"), so the labeled branch must
    /// always be used now.
    func testFirstColumnAlwaysPairsHeaderWithValue() {
        let pair = MarkdownFirstColumn.display(header: "Recovery", value: "Low")
        XCTAssertEqual(pair.label, "Recovery")
        XCTAssertEqual(pair.value, "Low")
    }

    // MARK: Metric-strip unit suppression

    func testUnitSuppressedWhenDisplayValueAlreadyContainsIt() {
        XCTAssertFalse(CoachUnitDisplay.shows(unit: "bpm", displayValue: "57 bpm"))
        XCTAssertFalse(CoachUnitDisplay.shows(unit: "BPM", displayValue: "57 bpm"))
    }

    func testUnitShownForApproxAndRangeValuesThatDoNotSpellItOut() {
        XCTAssertTrue(CoachUnitDisplay.shows(unit: "ms", displayValue: "≈47"))
        XCTAssertTrue(CoachUnitDisplay.shows(unit: "%", displayValue: "39-45"))
        XCTAssertTrue(CoachUnitDisplay.shows(unit: "hours", displayValue: "4h 38m"))
    }

    func testUnitHiddenWhenUnitIsEmpty() {
        XCTAssertFalse(CoachUnitDisplay.shows(unit: "", displayValue: "45%"))
    }

    /// Regression for #5: plain substring matching hid the unit "s" inside
    /// unrelated letters (e.g. the "s" in "est."). The match must be bounded
    /// to a whole, non-letter-adjacent occurrence of the unit.
    func testUnitSuppressionIsBoundedNotSubstring() {
        XCTAssertTrue(CoachUnitDisplay.shows(unit: "s", displayValue: "est. 420"))
        XCTAssertFalse(CoachUnitDisplay.shows(unit: "s", displayValue: "420s"))
        XCTAssertFalse(CoachUnitDisplay.shows(unit: "s", displayValue: "420 s"))
        XCTAssertFalse(CoachUnitDisplay.shows(unit: "%", displayValue: "85%"))
        XCTAssertTrue(CoachUnitDisplay.shows(unit: "m", displayValue: "420 min"))
    }

    // MARK: Chat day-divider precompute

    private func message(id: Int, day: Int, hour: Int = 9) -> ChatMessage {
        var components = DateComponents()
        components.year = 2026
        components.month = 9
        components.day = day
        components.hour = hour
        let date = Calendar.current.date(from: components)!
        return ChatMessage(id: id, role: .user, content: "hi", createdAt: date)
    }

    func testDayLabelsMarksOnlyTheFirstMessageOfEachDay() {
        let rows: [ChatView.ChatRow] = [
            .persisted(message(id: 1, day: 10)),
            .persisted(message(id: 2, day: 10, hour: 14)),
            .persisted(message(id: 3, day: 11)),
            .typing,
            .persisted(message(id: 4, day: 11, hour: 20))
        ]
        let labels = ChatView.dayLabels(for: rows)
        XCTAssertEqual(Set(labels.keys), [0, 2])
    }

    func testDayLabelsIgnoreNonPersistedRows() {
        let rows: [ChatView.ChatRow] = [
            .optimistic(id: UUID(), content: "hi", attachments: []),
            .typing
        ]
        XCTAssertTrue(ChatView.dayLabels(for: rows).isEmpty)
    }
}
