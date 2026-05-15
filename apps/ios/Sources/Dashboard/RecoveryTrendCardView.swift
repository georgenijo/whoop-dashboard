import SwiftUI

struct RecoveryTrendCardView: View {
    let points: [TrendPoint]

    var body: some View {
        TrendChartView(
            title: "Recovery — 30d",
            subtitle: nil,
            unit: "%",
            colorHex: "#00d4aa",
            points: points,
            showRollingToggle: false,
            enableMa30: false
        )
    }
}
