import SwiftUI

struct TodayKpisView: View {
    let today: StrainPayload.Today

    var body: some View {
        TrendsStatGrid(tiles: [
            TrendsStat(id: "kcal", label: "Calories",
                       value: today.totalKcal.map { Int($0.rounded()).formatted() } ?? "—",
                       unit: "kcal",
                       caption: today.totalKilojoule.map { "\(Int($0.rounded()).formatted()) kJ" },
                       accent: Theme.Palette.strain),
            TrendsStat(id: "avg", label: "Avg HR", value: hr(today.avgHr), unit: "bpm",
                       caption: "all day", accent: Theme.Palette.rhr),
            TrendsStat(id: "max", label: "Max HR", value: hr(today.maxHr), unit: "bpm",
                       caption: "peak", accent: Theme.Palette.danger)
        ])
    }

    private func hr(_ v: Double?) -> String {
        guard let v else { return "—" }
        return "\(Int(v.rounded()))"
    }
}
