import SwiftUI

struct TodayKpisView: View {
    let today: StrainPayload.Today

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Today")
                    .font(.headline)
                Spacer()
                Text("\(today.workoutCount) workout\(today.workoutCount == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                tile(label: "Calories", primary: kcalText, subscriptText: kjText)
                tile(label: "Avg HR",  primary: hrText(today.avgHr), subscriptText: nil)
                tile(label: "Max HR",  primary: hrText(today.maxHr), subscriptText: nil)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var kcalText: String {
        guard let k = today.totalKcal else { return "—" }
        return "\(Int(k.rounded()))"
    }

    private var kjText: String? {
        guard let kj = today.totalKilojoule else { return nil }
        return "\(Int(kj.rounded())) kJ"
    }

    private func hrText(_ v: Double?) -> String {
        guard let v else { return "—" }
        return "\(Int(v.rounded()))"
    }

    private func tile(label: String, primary: String, subscriptText: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(primary)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
            }
            if let sub = subscriptText {
                Text(sub)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text(" ").font(.caption2).accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
    }
}
