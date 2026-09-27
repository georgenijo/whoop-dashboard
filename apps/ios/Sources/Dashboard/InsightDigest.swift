import Foundation

/// Condenses the long-form markdown insight ("## Key Findings / ## Trends /
/// ## Action Items / ## Watch Out") into a glanceable digest: one headline
/// finding plus the first few action items, each cut to its leading clause.
/// Text without that structure still yields a bounded preview, never the
/// whole document.
struct InsightDigest: Equatable {
    let headline: String?
    let actions: [String]
    /// Extra lines shown only when there are no action items.
    let preview: [String]

    static let maxActions = 3
    static let maxPreview = 2

    struct Section: Equatable {
        let title: String
        let level: Int
        let items: [String]
    }

    init(markdown: String) {
        let sections = Self.sections(in: markdown)

        let findingsIndex = sections.firstIndex { $0.title.lowercased().contains("finding") }
        let actionIndex = sections.firstIndex { $0.title.lowercased().contains("action") }
        let actionRange = actionIndex.map { Self.subtree(of: $0, in: sections) }

        let otherItems = sections.indices
            .filter { actionRange?.contains($0) != true }
            .flatMap { sections[$0].items }
        let findingItems = findingsIndex.map { Self.subtree(of: $0, in: sections).flatMap { sections[$0].items } } ?? []

        let lead = findingItems.first ?? otherItems.first
        headline = lead.map { Self.leadingClause($0) }

        let actionItems = actionRange.map { $0.flatMap { sections[$0].items } } ?? []
        actions = actionItems.prefix(Self.maxActions).map { Self.leadingClause($0) }

        if actions.isEmpty {
            var rest = otherItems
            if let lead, let i = rest.firstIndex(of: lead) { rest.remove(at: i) }
            preview = rest.prefix(Self.maxPreview).map { Self.leadingClause($0) }
        } else {
            preview = []
        }
    }

    var isEmpty: Bool { headline == nil && actions.isEmpty && preview.isEmpty }

    /// A section plus every following section nested deeper than it, so
    /// "## Action Items" keeps the bullets under its "### Sleep" sub-heading.
    static func subtree(of index: Int, in sections: [Section]) -> ClosedRange<Int> {
        let level = sections[index].level
        var end = index
        while end + 1 < sections.count, sections[end + 1].level > level {
            end += 1
        }
        return index...end
    }

    static func sections(in markdown: String) -> [Section] {
        var result: [Section] = []
        var title = ""
        var level = 0
        var items: [String] = []
        var paragraph: [String] = []

        func flushParagraph() {
            if !paragraph.isEmpty {
                items.append(paragraph.joined(separator: " "))
                paragraph = []
            }
        }
        func flushSection() {
            flushParagraph()
            if !title.isEmpty || !items.isEmpty {
                result.append(Section(title: title, level: level, items: items))
            }
            items = []
        }

        for raw in markdown.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                flushParagraph()
                continue
            }
            if line.hasPrefix("#") {
                flushSection()
                level = line.prefix(while: { $0 == "#" }).count
                title = line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
                    .replacingOccurrences(of: "**", with: "")
                continue
            }
            if let item = listItem(line) {
                flushParagraph()
                items.append(item)
                continue
            }
            if let last = items.indices.last, paragraph.isEmpty, raw.hasPrefix("  ") {
                items[last] += " " + line
                continue
            }
            paragraph.append(line)
        }
        flushSection()
        return result
    }

    private static func listItem(_ line: String) -> String? {
        if let first = line.first, "-*+".contains(first), line.dropFirst().first == " " {
            return line.dropFirst(2).trimmingCharacters(in: .whitespaces)
        }
        let digits = line.prefix(while: \.isNumber)
        if !digits.isEmpty {
            let rest = line.dropFirst(digits.count)
            if let marker = rest.first, marker == "." || marker == ")", rest.dropFirst().first == " " {
                return rest.dropFirst(2).trimmingCharacters(in: .whitespaces)
            }
        }
        return nil
    }

    /// Cuts an item at its first clause break (" — ", ": ", "; ", ". ") when
    /// what precedes it is long enough to stand alone.
    static func leadingClause(_ text: String, minLength: Int = 16, maxLength: Int = 110) -> String {
        let breaks = [" — ", " – ", " - ", ": ", "; ", ". "]
        var cut = text
        var best: String.Index?
        for mark in breaks {
            var search = text.startIndex..<text.endIndex
            while let r = text.range(of: mark, range: search) {
                let head = text[..<r.lowerBound]
                if plainLength(head) >= minLength {
                    if best == nil || r.lowerBound < best! { best = r.lowerBound }
                    break
                }
                search = r.upperBound..<text.endIndex
            }
        }
        if let best { cut = String(text[..<best]) }
        cut = cut.trimmingCharacters(in: CharacterSet(charactersIn: " .;:,—–-"))

        if plainLength(Substring(cut)) > maxLength {
            let limit = cut.index(cut.startIndex, offsetBy: maxLength)
            let head = cut[..<limit]
            let wordEnd = head.lastIndex(of: " ") ?? limit
            cut = String(cut[..<wordEnd]).trimmingCharacters(in: CharacterSet(charactersIn: " ,;:—–-")) + "…"
        }
        return balanceEmphasis(cut)
    }

    private static func plainLength(_ s: Substring) -> Int {
        s.replacingOccurrences(of: "**", with: "").count
    }

    private static func balanceEmphasis(_ s: String) -> String {
        let pairs = s.components(separatedBy: "**").count - 1
        guard pairs % 2 == 1 else { return s }
        return s.replacingOccurrences(of: "**", with: "")
    }
}
