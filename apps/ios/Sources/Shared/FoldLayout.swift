import SwiftUI

// MARK: - iPhone Duo / wide-layout support
//
// The app has one information hierarchy at every size. On a compact width
// (any iPhone, and iPhone Duo's outer display) each screen is a single
// column. On a regular width (iPhone Duo's inner display) the same content
// splits into two columns, and the split is placed on the hinge: the inner
// display reports the fold as a `.division` reserved region, and the gutter
// between columns is sized to exactly that region so no card, chart, or line
// of text runs across the crease.
//
// Inactive regions are included on purpose. The fold region is only *active*
// while the device is partly folded; laying out around it in every pose keeps
// the layout identical as people open and fold the device, instead of
// re-flowing content mid-gesture (HIG: "Avoid extreme layout changes as
// people fold the device").

/// Where the hinge sits within the measured scroll container, in that
/// container's own coordinate space.
struct FoldGeometry: Equatable, Sendable {
    var width: CGFloat = 0
    /// Horizontal extent of the fold (including the system's interactive
    /// margins), or nil when the display has no fold.
    var hinge: ClosedRange<CGFloat>?

    static let none = FoldGeometry()
}

private struct FoldGeometryKey: EnvironmentKey {
    static let defaultValue = FoldGeometry.none
}

extension EnvironmentValues {
    var foldGeometry: FoldGeometry {
        get { self[FoldGeometryKey.self] }
        set { self[FoldGeometryKey.self] = newValue }
    }
}

extension View {
    /// Measures this view (normally a screen's ScrollView, which spans the
    /// full content width) and publishes where the hinge falls inside it, so
    /// `FoldColumns` further down can align its gutter to the fold.
    func measuresFold() -> some View {
        modifier(MeasuresFold())
    }
}

private struct MeasuresFold: ViewModifier {
    @State private var geometry = FoldGeometry.none

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: FoldGeometry.self) { proxy in
                FoldGeometry(width: proxy.size.width, hinge: Self.hinge(in: proxy))
            } action: { newValue in
                geometry = newValue
            }
            .environment(\.foldGeometry, geometry)
    }

    private static func hinge(in proxy: GeometryProxy) -> ClosedRange<CGFloat>? {
        guard #available(iOS 27.1, *) else { return nil }
        let width = proxy.size.width
        // A vertical division band that actually crosses this container.
        let band = proxy
            .reservedRegions(kind: .division, options: .includeInactive)
            .map(\.frame)
            .filter { $0.height > $0.width && $0.maxX > 0 && $0.minX < width }
            .min { abs($0.midX - width / 2) < abs($1.midX - width / 2) }
        guard let band else { return nil }
        return band.minX ... band.maxX
    }
}

/// Two columns on a regular width, split at the fold; one column otherwise.
///
/// Place it inside a ScrollView that carries `.measuresFold()` and is padded
/// horizontally by `inset` (the screen's standard margin), so the column
/// widths can be computed in the scroll view's coordinate space.
struct FoldColumns<Leading: View, Trailing: View>: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.foldGeometry) private var fold

    var inset: CGFloat = Theme.Spacing.md
    var spacing: CGFloat = Theme.Spacing.sm
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        if let split = split {
            HStack(alignment: .top, spacing: split.gutter) {
                VStack(alignment: .leading, spacing: spacing, content: leading)
                    .frame(width: split.leading, alignment: .topLeading)
                VStack(alignment: .leading, spacing: spacing, content: trailing)
                    .frame(width: split.trailing, alignment: .topLeading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: spacing) {
                leading()
                trailing()
            }
        }
    }

    private var split: FoldSplit? {
        guard sizeClass == .regular else { return nil }
        return FoldSplit.compute(fold: fold, inset: inset)
    }
}

/// Column widths for a two-column layout, in points.
struct FoldSplit: Equatable {
    var leading: CGFloat
    var gutter: CGFloat
    var trailing: CGFloat

    /// Columns narrower than this read as cramped phone cards; below it the
    /// layout stays single-column even on a regular width.
    static let minimumColumn: CGFloat = 300
    /// Gutter used when the display has no fold.
    static let defaultGutter: CGFloat = Theme.Spacing.xl

    /// Splits `fold.width` (less `inset` on each side) into two columns. With
    /// a hinge, the gutter is exactly the hinge band so the crease falls
    /// between columns; the columns may differ in width because the side
    /// rail makes the content area asymmetric. Without one, two equal
    /// columns. Nil when either column would be under `minimumColumn`.
    static func compute(fold: FoldGeometry, inset: CGFloat) -> FoldSplit? {
        guard fold.width > 0 else { return nil }
        if let hinge = fold.hinge {
            let leading = hinge.lowerBound - inset
            let trailing = fold.width - inset - hinge.upperBound
            if leading >= minimumColumn, trailing >= minimumColumn {
                return FoldSplit(leading: leading, gutter: hinge.upperBound - hinge.lowerBound, trailing: trailing)
            }
        }
        let column = (fold.width - inset * 2 - defaultGutter) / 2
        guard column >= minimumColumn else { return nil }
        return FoldSplit(leading: column, gutter: defaultGutter, trailing: column)
    }
}

extension View {
    /// Keeps a lone card (an empty or error state) on the leading side of the
    /// fold instead of spanning the crease. Single-column on compact widths.
    /// Needs the same setup as `FoldColumns`: an enclosing `.measuresFold()`
    /// scroll view padded by `inset`.
    func inLeadingFoldColumn(inset: CGFloat = Theme.Spacing.md) -> some View {
        FoldColumns(inset: inset) { self } trailing: { EmptyView() }
    }
}
