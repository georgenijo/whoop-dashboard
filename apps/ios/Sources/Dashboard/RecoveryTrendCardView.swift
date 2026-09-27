import SwiftUI

struct RecoveryTrendCardView: View {
    let points: [TrendPoint]

    var body: some View {
        MetricChart(
            title: "Recovery · 30 days",
            unit: "%",
            accent: Theme.Palette.recovery,
            points: points,
            yDomain: 0...100,
            height: 150
        )
        .glassCard(padding: Theme.Spacing.md)
    }
}

#Preview {
    let mock: [TrendPoint] = (0..<30).map { i in
        let day = String(format: "2026-04-%02d", i + 1)
        let v = 60.0 + Double(i) * 0.5 + sin(Double(i) * 0.3) * 8
        return TrendPoint(date: day, raw: v, ma7: v - 1, ma30: v - 2)
    }
    return ZStack {
        Color.black
        RecoveryTrendCardView(points: mock).padding()
    }
    .preferredColorScheme(.dark)
}
