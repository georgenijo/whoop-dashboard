import SwiftUI

struct MarkdownView: View {
    enum Style {
        /// Inherits font and color from the environment (Dashboard insight card).
        case inherit
        /// Coach reply typography: explicit reading scale, emphasis colors, tables.
        case chat
    }

    let content: String
    var style: Style = .inherit

    var body: some View {
        let blocks = MarkdownBlock.parse(content)
        VStack(alignment: .leading, spacing: style == .chat ? 12 : 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                blockView(block)
                    .padding(.top, style == .chat && index > 0 && block.isHeading ? 10 : 0)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch style {
        case .inherit: inheritBlock(block)
        case .chat: chatBlock(block)
        }
    }

    // MARK: Chat

    @ViewBuilder
    private func chatBlock(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(Self.inline(text, emphasis: Theme.Palette.fg0))
                .font(Theme.FontStyle.sans(level == 1 ? 20 : level == 2 ? 17 : 15.5, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

        case .paragraph(let text):
            Text(Self.inline(text, emphasis: Theme.Palette.fg0))
                .chatBody()

        case .bulletList(let items):
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle()
                            .fill(Theme.Palette.fg3)
                            .frame(width: 4.5, height: 4.5)
                            .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 2 }
                            .frame(width: 10)
                        Text(Self.inline(item, emphasis: Theme.Palette.fg0))
                            .chatBody()
                    }
                }
            }

        case .orderedList(let items):
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(idx + 1)")
                            .font(Theme.FontStyle.mono(13, weight: .medium))
                            .monospacedDigit()
                            .foregroundStyle(Theme.Palette.fg3)
                            .frame(minWidth: 14, alignment: .trailing)
                        Text(Self.inline(item, emphasis: Theme.Palette.fg0))
                            .chatBody()
                    }
                }
            }

        case .table(let header, let rows):
            MarkdownTableView(header: header, rows: rows)

        case .codeBlock(_, let code):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(Theme.FontStyle.mono(12.5))
                    .foregroundStyle(Theme.Palette.fg1)
                    .lineSpacing(3)
                    .fixedSize()
                    .padding(12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Palette.bg2, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.Palette.borderSubtle))

        case .chart(let chart):
            CoachInlineChartView(chart: chart)
                .padding(.vertical, 4)
        }
    }

    // MARK: Inherit (legacy)

    @ViewBuilder
    private func inheritBlock(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(Self.inline(text))
                .font(Self.headingFont(level: level))
                .fontWeight(.semibold)
                .fixedSize(horizontal: false, vertical: true)

        case .paragraph(let text):
            Text(Self.inline(text))
                .fixedSize(horizontal: false, vertical: true)

        case .bulletList(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("•")
                        Text(Self.inline(item))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

        case .orderedList(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(idx + 1).")
                            .monospacedDigit()
                        Text(Self.inline(item))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

        case .table(let header, let rows):
            Text(([header] + rows).map { $0.joined(separator: " · ") }.joined(separator: "\n"))
                .fixedSize(horizontal: false, vertical: true)

        case .codeBlock(_, let code):
            Text(code)
                .font(.system(.footnote, design: .monospaced))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.black.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8))

        case .chart(let chart):
            CoachInlineChartView(chart: chart)
        }
    }

    private static func headingFont(level: Int) -> Font {
        switch level {
        case 1: return .title2
        case 2: return .title3
        default: return .headline
        }
    }

    static func inline(_ text: String, emphasis: Color? = nil) -> AttributedString {
        guard var attr = try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) else {
            return AttributedString(text)
        }
        guard let emphasis else { return attr }
        for run in attr.runs {
            guard let intent = run.inlinePresentationIntent else { continue }
            if intent.contains(.stronglyEmphasized) {
                attr[run.range].foregroundColor = emphasis
            }
            if intent.contains(.code) {
                attr[run.range].font = Theme.FontStyle.mono(13.5)
                attr[run.range].foregroundColor = Theme.Palette.fg0
                attr[run.range].backgroundColor = Color.white.opacity(0.07)
            }
        }
        for run in attr.runs where run.link != nil {
            attr[run.range].foregroundColor = Theme.Palette.ai
        }
        return attr
    }

    /// Plain text for previews: strips inline markdown markers.
    static func plain(_ text: String) -> String {
        let flattened = text
            .components(separatedBy: .newlines)
            .map { line -> String in
                var trimmed = line.trimmingCharacters(in: .whitespaces)
                while trimmed.hasPrefix("#") { trimmed.removeFirst() }
                for marker in ["- ", "* ", "+ ", "> "] where trimmed.hasPrefix(marker) {
                    trimmed.removeFirst(marker.count)
                }
                return trimmed.trimmingCharacters(in: .whitespaces)
            }
            .filter { !$0.isEmpty && !$0.hasPrefix("|") && !$0.hasPrefix("```") }
            .joined(separator: " ")
        let attr = (try? AttributedString(
            markdown: flattened,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(flattened)
        return String(attr.characters)
    }
}

private extension View {
    func chatBody() -> some View {
        self
            .font(Theme.FontStyle.sans(15))
            .foregroundStyle(Theme.Palette.fg1)
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Narrow tables render as a grid; wide ones (4+ columns) as one record per row,
/// so nothing needs a sideways scroll on a phone.
private struct MarkdownTableView: View {
    let header: [String]
    let rows: [[String]]

    var body: some View {
        Group {
            if header.count <= 3 {
                grid
            } else {
                records
            }
        }
        .background(Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.Palette.borderSubtle))
    }

    private var grid: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(header.enumerated()), id: \.offset) { index, cell in
                    Text(MarkdownView.plain(cell).uppercased())
                        .font(Theme.FontStyle.sans(11, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(Theme.Palette.fg3)
                        .gridColumnAlignment(index == 0 ? .leading : .trailing)
                }
            }
            .padding(.vertical, 10)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Divider().overlay(Theme.Palette.borderSubtle)
                GridRow {
                    ForEach(Array(header.indices), id: \.self) { index in
                        Text(MarkdownView.inline(cell(row, index), emphasis: Theme.Palette.fg0))
                            .font(Theme.FontStyle.sans(14))
                            .monospacedDigit()
                            .foregroundStyle(index == 0 ? Theme.Palette.fg1 : Theme.Palette.fg0)
                            .multilineTextAlignment(index == 0 ? .leading : .trailing)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, 10)
            }
        }
        .padding(.horizontal, 14)
    }

    private var records: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                if rowIndex > 0 {
                    Divider().overlay(Theme.Palette.borderSubtle)
                }
                VStack(alignment: .leading, spacing: 6) {
                    firstColumnHeadline(row)
                    ForEach(1..<header.count, id: \.self) { index in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(MarkdownView.plain(header[index]))
                                .font(Theme.FontStyle.sans(12.5))
                                .foregroundStyle(Theme.Palette.fg3)
                            Spacer(minLength: 8)
                            Text(MarkdownView.inline(cell(row, index), emphasis: Theme.Palette.fg0))
                                .font(Theme.FontStyle.sans(13.5))
                                .monospacedDigit()
                                .foregroundStyle(Theme.Palette.fg1)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
                .padding(14)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func cell(_ row: [String], _ index: Int) -> String {
        index < row.count ? row[index] : ""
    }

    /// A wide table's first column is usually a value ("45%"), not a title —
    /// without the header it reads as an orphaned number. Row labels (a date,
    /// or plain text with no digits, e.g. a metric name) already read fine on
    /// their own and stay plain.
    @ViewBuilder
    private func firstColumnHeadline(_ row: [String]) -> some View {
        let plain = MarkdownView.plain(cell(row, 0))
        if MarkdownRowLabel.isRowLabel(plain) {
            Text(plain)
                .font(Theme.FontStyle.sans(14, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(MarkdownView.plain(header[0]))
                    .font(Theme.FontStyle.sans(12.5))
                    .foregroundStyle(Theme.Palette.fg3)
                Text(plain)
                    .font(Theme.FontStyle.sans(14, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg0)
            }
        }
    }
}

/// Pure classifier for a wide markdown table's first column, factored out so
/// it can be unit tested without instantiating `MarkdownTableView`.
enum MarkdownRowLabel {
    static func isRowLabel(_ text: String) -> Bool {
        guard !text.isEmpty else { return true }
        if ChartDate.parse(text) != nil { return true }
        if text.range(
            of: #"^[A-Za-z]{3,9}\.?\s+\d{1,2}(\s*[–—-]\s*\d{1,2})?$"#,
            options: .regularExpression
        ) != nil {
            return true
        }
        return !text.contains { $0.isNumber }
    }
}

enum MarkdownBlock: Hashable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bulletList([String])
    case orderedList([String])
    case table(header: [String], rows: [[String]])
    case codeBlock(language: String?, code: String)
    case chart(CoachChartSpec)

    var isHeading: Bool {
        if case .heading = self { return true }
        return false
    }

    static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var numbered: [String] = []
        var tableLines: [String] = []
        var inFence = false
        var fenceLang: String?
        var fenceLines: [String] = []

        func flushParagraph() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }
        func flushBullets() {
            if !bullets.isEmpty {
                blocks.append(.bulletList(bullets))
                bullets = []
            }
        }
        func flushNumbered() {
            if !numbered.isEmpty {
                blocks.append(.orderedList(numbered))
                numbered = []
            }
        }
        func flushTable() {
            guard !tableLines.isEmpty else { return }
            if let table = parseTable(tableLines) {
                blocks.append(table)
            } else {
                blocks.append(.paragraph(tableLines.joined(separator: "\n")))
            }
            tableLines = []
        }
        func flushAllInline() {
            flushParagraph()
            flushBullets()
            flushNumbered()
            flushTable()
        }

        for raw in lines {
            if inFence {
                if raw.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    let code = fenceLines.joined(separator: "\n")
                    if fenceLang?.lowercased() == "mermaid",
                       let chart = CoachChartSpec.parseMermaid(code) {
                        blocks.append(.chart(chart))
                    } else {
                        blocks.append(.codeBlock(language: fenceLang, code: code))
                    }
                    inFence = false
                    fenceLang = nil
                    fenceLines = []
                } else {
                    fenceLines.append(raw)
                }
                continue
            }

            let trimmed = raw.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                flushAllInline()
                inFence = true
                let after = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                fenceLang = after.isEmpty ? nil : String(after)
                continue
            }

            if trimmed.isEmpty {
                flushAllInline()
                continue
            }

            if trimmed.hasPrefix("|") {
                flushParagraph()
                flushBullets()
                flushNumbered()
                tableLines.append(trimmed)
                continue
            }
            flushTable()

            if let (level, text) = parseHeading(trimmed) {
                flushAllInline()
                blocks.append(.heading(level: level, text: text))
                continue
            }

            if let item = parseBullet(trimmed) {
                flushParagraph()
                flushNumbered()
                bullets.append(item)
                continue
            }

            if let item = parseOrdered(trimmed) {
                flushParagraph()
                flushBullets()
                numbered.append(item)
                continue
            }

            flushBullets()
            flushNumbered()
            paragraph.append(raw)
        }

        if inFence {
            blocks.append(.codeBlock(language: fenceLang, code: fenceLines.joined(separator: "\n")))
        }
        flushAllInline()
        return blocks
    }

    private static func parseTable(_ lines: [String]) -> MarkdownBlock? {
        guard lines.count >= 2 else { return nil }
        let cells = lines.map(splitRow)
        let separator = cells[1]
        let isSeparator = !separator.isEmpty && separator.allSatisfy { cell in
            !cell.isEmpty && cell.allSatisfy { $0 == "-" || $0 == ":" }
        }
        guard isSeparator, let header = cells.first, header.count >= 2 else { return nil }
        let rows = Array(cells.dropFirst(2))
            .filter { !$0.isEmpty }
            .map { normalizeRow($0, to: header.count) }
        guard !rows.isEmpty else { return nil }
        return .table(header: header, rows: rows)
    }

    /// A row with more cells than the header must not silently drop the
    /// overflow — merge the extra cells into the last column instead.
    private static func normalizeRow(_ row: [String], to columnCount: Int) -> [String] {
        guard row.count > columnCount, columnCount > 0 else { return row }
        let head = Array(row.prefix(columnCount - 1))
        let overflow = row[(columnCount - 1)...].joined(separator: " ")
        return head + [overflow]
    }

    /// Splits a table row on unescaped `|` only, unescaping `\|` to a literal
    /// pipe within cell text. A naive `components(separatedBy: "|")` split
    /// also breaks on an author's intentionally escaped pipe.
    private static func splitRow(_ line: String) -> [String] {
        let trimmedLine = line.trimmingCharacters(in: .whitespaces)
        var cells = splitOnUnescapedPipes(trimmedLine)
        if cells.first == "" { cells.removeFirst() }
        if cells.last == "" { cells.removeLast() }
        return cells.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func splitOnUnescapedPipes(_ line: String) -> [String] {
        var cells: [String] = []
        var current = ""
        let chars = Array(line)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "\\", i + 1 < chars.count, chars[i + 1] == "|" {
                current.append("|")
                i += 2
                continue
            }
            if c == "|" {
                cells.append(current)
                current = ""
                i += 1
                continue
            }
            current.append(c)
            i += 1
        }
        cells.append(current)
        return cells
    }

    private static func parseHeading(_ trimmed: String) -> (Int, String)? {
        var level = 0
        var idx = trimmed.startIndex
        while idx < trimmed.endIndex, trimmed[idx] == "#", level < 6 {
            level += 1
            idx = trimmed.index(after: idx)
        }
        guard level >= 1, level <= 3, idx < trimmed.endIndex, trimmed[idx] == " " else { return nil }
        let text = String(trimmed[trimmed.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
        return (level, text)
    }

    private static func parseBullet(_ trimmed: String) -> String? {
        guard let first = trimmed.first, first == "-" || first == "*" || first == "+" else { return nil }
        let rest = trimmed.dropFirst()
        guard rest.first == " " else { return nil }
        return String(rest.dropFirst())
    }

    private static func parseOrdered(_ trimmed: String) -> String? {
        var idx = trimmed.startIndex
        let start = idx
        while idx < trimmed.endIndex, trimmed[idx].isNumber {
            idx = trimmed.index(after: idx)
        }
        guard idx > start, idx < trimmed.endIndex, trimmed[idx] == "." else { return nil }
        let after = trimmed.index(after: idx)
        guard after < trimmed.endIndex, trimmed[after] == " " else { return nil }
        return String(trimmed[trimmed.index(after: after)...])
    }
}

#Preview("Chat markdown") {
    ScrollView {
        MarkdownView(
            content: """
            Your 14-day baseline is **stable**, but sleep debt is capping recovery.

            ### 1. Cardiovascular baseline
            * **Recovery:** averaging **67%** over 14 days.
            * **Autonomic tone:** HRV **47.8 ms**, RHR `57 bpm`.

            | Metric | Aug 31 | Sep 1–5 | Baseline | Status |
            |---|---|---|---|---|
            | **Recovery** | 39% | **77%** | 71% | Up +38% |
            | **HRV** | 48 ms | **48.9 ms** | 46.4 ms | Stable |

            | Day | Steps |
            |---|---|
            | Sep 24 | 19,006 |
            | Sep 25 | 25,725 |

            1. **Anchor bedtime** within a 45-minute window.
            2. **Repay 45 minutes** of debt tonight.
            """,
            style: .chat
        )
        .padding()
    }
    .background(Color.black)
    .preferredColorScheme(.dark)
}
