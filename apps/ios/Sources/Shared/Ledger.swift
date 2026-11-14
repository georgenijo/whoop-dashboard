import SwiftUI

/// Header row inside a ruled group: a 15 pt medium title and a quiet note.
/// Every label in the ledger language uses the same size and weight.
struct LedgerHeader: View {
    let title: String
    var subtitle: String? = nil
    var trailing: String? = nil
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        layout {
            Text(title)
                .font(Theme.FontStyle.sans(15, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle)
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
            if let trailing {
                Text(trailing)
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A one-pixel in-group rule.
struct LedgerRule: View {
    var body: some View {
        Rectangle().fill(Theme.Palette.borderSubtle).frame(height: 1)
    }
}

/// Cells laid out in ruled rows of `columns` (one column at accessibility
/// sizes). The last row may hold fewer cells.
struct LedgerGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    var columns = 2
    @ViewBuilder var cell: (Item) -> Cell
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var effectiveColumns: Int { dynamicTypeSize.isAccessibilitySize ? 1 : columns }

    private var rows: [[Item]] {
        stride(from: 0, to: items.count, by: effectiveColumns).map {
            Array(items[$0..<min($0 + effectiveColumns, items.count)])
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(spacing: 0) {
                    ForEach(0..<effectiveColumns, id: \.self) { column in
                        Group {
                            if column < row.count { cell(row[column]) } else { Color.clear }
                        }
                        .padding(Theme.Spacing.md)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .overlay(alignment: .trailing) {
                            if column < effectiveColumns - 1 {
                                Rectangle().fill(Theme.Palette.borderSubtle).frame(width: 1)
                            }
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .overlay(alignment: .bottom) {
                    if index < rows.count - 1 { LedgerRule() }
                }
            }
        }
    }
}

extension View {
    /// A standalone card, or the padded content of a card embedded in a
    /// `LedgerGroup` that supplies the outline.
    @ViewBuilder
    func cardChrome(embedded: Bool, padding: CGFloat = Theme.Spacing.md) -> some View {
        if embedded { self.padding(padding) } else { self.glassCard(padding: padding) }
    }
}
