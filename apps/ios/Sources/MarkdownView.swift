import SwiftUI

struct MarkdownView: View {
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(MarkdownBlock.parse(content).enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(inline(text))
                .font(headingFont(level: level))
                .fontWeight(.semibold)
                .fixedSize(horizontal: false, vertical: true)

        case .paragraph(let text):
            Text(inline(text))
                .fixedSize(horizontal: false, vertical: true)

        case .bulletList(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("•")
                        Text(inline(item))
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
                        Text(inline(item))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

        case .codeBlock(_, let code):
            Text(code)
                .font(.system(.footnote, design: .monospaced))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.black.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private func headingFont(level: Int) -> Font {
        switch level {
        case 1: return .title2
        case 2: return .title3
        default: return .headline
        }
    }

    private func inline(_ text: String) -> AttributedString {
        if let attr = try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            return attr
        }
        return AttributedString(text)
    }
}

enum MarkdownBlock: Hashable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bulletList([String])
    case orderedList([String])
    case codeBlock(language: String?, code: String)

    static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var numbered: [String] = []
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
        func flushAllInline() {
            flushParagraph()
            flushBullets()
            flushNumbered()
        }

        for raw in lines {
            if inFence {
                if raw.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    blocks.append(.codeBlock(language: fenceLang, code: fenceLines.joined(separator: "\n")))
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
        var digits = ""
        var idx = trimmed.startIndex
        while idx < trimmed.endIndex, trimmed[idx].isNumber {
            digits.append(trimmed[idx])
            idx = trimmed.index(after: idx)
        }
        guard !digits.isEmpty, idx < trimmed.endIndex, trimmed[idx] == "." else { return nil }
        let after = trimmed.index(after: idx)
        guard after < trimmed.endIndex, trimmed[after] == " " else { return nil }
        return String(trimmed[trimmed.index(after: after)...])
    }
}
