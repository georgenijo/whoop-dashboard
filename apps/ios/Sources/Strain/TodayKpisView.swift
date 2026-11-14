import SwiftUI

struct TodayKpisView: View {
    let today: StrainPayload.Today

    var body: some View {
        if tiles.isEmpty {
            Label {
                Text("No calorie or heart-rate metrics are available for today. Pull down to refresh, or check the Whoop connection in Settings.")
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "clock.badge.questionmark")
                    .foregroundStyle(Theme.Palette.fg2)
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                TrendsStatGrid(tiles: tiles)
                if tiles.count < 3 {
                    Text("Some of today’s metrics aren’t available yet.")
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg2)
                }
            }
        }
    }

    private var tiles: [TrendsStat] {
        var result: [TrendsStat] = []
        if let kcal = today.totalKcal {
            result.append(TrendsStat(id: "kcal", label: "Calories",
                value: Int(kcal.rounded()).formatted(), unit: "kcal",
                caption: today.totalKilojoule.map { "\(Int($0.rounded()).formatted()) kJ" },
                accent: Theme.Palette.strain))
        }
        if let avg = today.avgHr {
            result.append(TrendsStat(id: "avg", label: "Avg HR", value: hr(avg), unit: "bpm",
                caption: "all day", accent: Theme.Palette.rhr))
        }
        if let maximum = today.maxHr {
            result.append(TrendsStat(id: "max", label: "Max HR", value: hr(maximum), unit: "bpm",
                caption: "peak", accent: Theme.Palette.rhr))
        }
        return result
    }

    private func hr(_ v: Double?) -> String {
        guard let v else { return "—" }
        return "\(Int(v.rounded()))"
    }
}
