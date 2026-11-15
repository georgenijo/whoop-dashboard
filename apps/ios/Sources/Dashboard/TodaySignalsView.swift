import SwiftUI

/// Supporting evidence is a compact list. The daily brief owns the visual
/// emphasis; detailed charts remain in each metric's destination.
struct TodaySignalsView: View {
    let payload: DashboardPayload
    let inProgress: Set<KPITile.Key>
    var onOpen: (KPITile.Href) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Button { onOpen(.recovery) } label: {
                VStack(alignment: .leading, spacing: 8) {
                    Text(payload.isFallback ? "Latest recovery" : "Recovery")
                        .font(Theme.FontStyle.sans(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg2)
                    let layout = dynamicTypeSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                        : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
                    layout {
                        Text(payload.recoveryHero.score.map { "\(Int($0.rounded()))%" } ?? "—")
                            .font(Theme.FontStyle.mono(38, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        Text(payload.recoveryHero.score.map { RecoveryZone(score: $0).bandName } ?? "Awaiting a reading")
                            .font(Theme.FontStyle.sans(15, weight: .medium))
                            .foregroundStyle(payload.recoveryHero.score.map { RecoveryZone(score: $0).color } ?? Theme.Palette.fg2)
                            .fixedSize(horizontal: false, vertical: true)
                        if !dynamicTypeSize.isAccessibilitySize {
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.Palette.fg3)
                        }
                    }
                    if let score = payload.recoveryHero.score,
                       let baseline = RecoveryHeroView.thirtyDayAverage(payload.recoveryTrend) {
                        let comparison = RecoveryHeroView.baselineText(score: score, baseline: baseline)
                        Text(comparison.delta + " " + comparison.rest)
                            .font(Theme.FontStyle.sans(11))
                            .foregroundStyle(Theme.Palette.fg3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if payload.isFallback {
                        Text("Last recorded day · not today's readiness")
                            .font(Theme.FontStyle.sans(11))
                            .foregroundStyle(Theme.Palette.fg2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Opens recovery details and history")
            .accessibilityIdentifier("today-recovery")

            group("Recovery signals", keys: [.sleep, .hrv, .rhr, .spo2])
            group("Daily activity", keys: [.strain, .steps])
        }
    }

    @ViewBuilder
    private func group(_ title: String, keys: [KPITile.Key]) -> some View {
        let tiles = keys.compactMap { key in payload.kpi.first { $0.key == key } }
        if !tiles.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(Theme.FontStyle.sans(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg2)
                    .padding(.bottom, 8)
                    .accessibilityAddTraits(.isHeader)
                ForEach(tiles) { tile in
                    LedgerRule()
                    if let href = tile.href {
                        Button { onOpen(href) } label: { row(tile, tappable: true) }
                            .buttonStyle(.plain)
                            .accessibilityHint("Opens \(tile.label) details")
                    } else {
                        row(tile, tappable: false)
                    }
                }
            }
        }
    }

    private func row(_ tile: KPITile, tappable: Bool) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        return layout {
            Text(tile.label)
                .font(Theme.FontStyle.sans(15))
                .foregroundStyle(Theme.Palette.fg1)
                .fixedSize(horizontal: false, vertical: true)
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
            VStack(alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing, spacing: 3) {
                Text(value(tile))
                    .font(Theme.FontStyle.mono(19, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg0)
                    .fixedSize(horizontal: false, vertical: true)
                Text(comparison(tile))
                    .font(Theme.FontStyle.sans(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if tappable && !dynamicTypeSize.isAccessibilitySize {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.Palette.fg3)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func value(_ tile: KPITile) -> String {
        guard let value = tile.value else { return "—" }
        return value.formatted(.number.precision(.fractionLength(tile.precision)))
            + (tile.unit.isEmpty ? "" : " " + tile.unit)
    }

    private func comparison(_ tile: KPITile) -> String {
        guard tile.value != nil else { return "No reading" }
        if inProgress.contains(tile.key),
           let soFar = TodayFormat.soFar(value: tile.value, deltaLabel: tile.delta?.label, precision: tile.precision) {
            return soFar
        }
        return tile.delta?.label ?? "No comparison"
    }
}
