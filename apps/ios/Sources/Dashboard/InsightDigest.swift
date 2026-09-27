import Foundation

/// Condenses the long-form markdown insight ("## Key Findings / ## Trends /
/// ## Action Items / ## Watch Out") into a glanceable digest: one headline
/// finding plus the first few action items, each cut to its leading clause.
struct InsightDigest: Equatable {
    let headline: String?
    let actions: [String]
    let sectionCount: Int

    static let maxActions = 3

    struct Section: Equatable {
        let title: String
        let items: [String]
    }

    init(markdown: String) {
        let sections = Self.sections(in: markdown)
        sectionCount = sections.filter { !$0.title.isEmpty }.count

        let findings = sections.first { $0.title.lowercased().contains("finding") }
        let actionSection = sections.first { $0.title.lowercased().contains("action") }

        let lead = findings?.items.first ?? sections.first(where: { $0 != actionSection })?.items.first
        headline = lead.map { Self.leadingClause($0) }

        let items = actionSection?.items ?? []
        actions = items.prefix(Self.maxActions).map { Self.leadingClause($0) }
    }

    var isEmpty: Bool { headline == nil && actions.isEmpty }

    static func sections(in markdown: String) -> [Section] {
        var result: [Section] = []
        var title = ""
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
                result.append(Section(title: title, items: items))
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
