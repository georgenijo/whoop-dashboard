import SwiftUI
import Charts

struct StatsView: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var range: DateRange = .d30
    @State private var phase: Phase = .loading
    @State private var lastFetched: Date?
    @State private var isLoading = false

    private static let staleInterval: TimeInterval = 300

    enum Phase {
        case loading
        case loaded(StatsPayload)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PageHeader("Stats") {
                    rangeMenu
                }
                content
            }
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load(showSpinner: false) }
        }
        .task { await load(showSpinner: true) }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active, !isLoading else { return }
            if let last = lastFetched, Date().timeIntervalSince(last) < Self.staleInterval { return }
            Task { await load(showSpinner: false) }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let payload):
            if payload.allTime.workouts == 0 {
                emptyState
            } else {
                StatsContent(payload: payload)
            }
        case .error(let message):
            VStack(spacing: 12) {
                Text(message)
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("Retry") { Task { await load(showSpinner: true) } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Palette.recovery)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Theme.Palette.recovery.opacity(0.12))
                    .frame(width: 80, height: 80)
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(Theme.Palette.recovery)
            }
            Text("No stats yet")
                .font(Theme.FontStyle.sans(16, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
            Text("Log some workouts and your all-time totals will show up here.")
                .font(Theme.FontStyle.sans(12))
                .foregroundStyle(Theme.Palette.fg2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var rangeMenu: some View {
        Menu {
            ForEach(DateRange.allCases) { r in
                Button {
                    range = r
                    Task { await load(showSpinner: true) }
                } label: {
                    Label(r.label, systemImage: range == r ? "checkmark" : "")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(range.label)
                    .font(Theme.FontStyle.mono(11, weight: .medium))
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(Theme.Palette.recovery)
        }
    }

    @MainActor
    private func load(showSpinner: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        let hadLoaded: Bool
        if case .loaded = phase { hadLoaded = true } else { hadLoaded = false }
        if showSpinner, !hadLoaded { phase = .loading }

        do {
            let payload = try await StatsService(api: api).load(range: range)
            phase = .loaded(payload)
            lastFetched = Date()
        } catch APIError.unauthorized {
            if !hadLoaded { phase = .error("Session expired. Sign in again.") }
        } catch APIError.network(let err) {
            if !hadLoaded { phase = .error("Network error: \(err.localizedDescription)") }
        } catch APIError.serverError(let code) {
            if !hadLoaded { phase = .error("Server error (\(code))") }
        } catch APIError.decode {
            if !hadLoaded { phase = .error("Bad response from server") }
        } catch APIError.badResponse {
            if !hadLoaded { phase = .error("Bad response from server") }
        } catch {
            if !hadLoaded { phase = .error("Could not load stats") }
        }
    }
}

private struct StatsContent: View {
    let payload: StatsPayload

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                AllTimeStrip(allTime: payload.allTime)
                YoYSection(yoy: payload.yoy, historyFloor: payload.historyFloor)
                if !payload.bySport.isEmpty {
                    BySportCard(items: payload.bySport)
                }
                if !payload.records.isEmpty {
                    RecordsSection(records: payload.records)
                }
                if !payload.trend.isEmpty {
                    TrendCard(trend: payload.trend)
                }
            }
            .padding(Theme.Spacing.md)
        }
        .scrollContentBackground(.hidden)
    }
}

private struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Theme.FontStyle.sans(10, weight: .semibold))
            .tracking(1.4)
            .foregroundStyle(Theme.Palette.fg2)
    }
}

private struct AllTimeStrip: View {
    let allTime: StatsPayload.AllTime

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionLabel(text: "ALL TIME")
            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible())],
                spacing: Theme.Spacing.sm
            ) {
                tile(value: "\(allTime.workouts)", label: "Workouts")
                tile(value: StatsFormat.hours(allTime.activeSeconds), label: "Active time")
                tile(value: StatsFormat.distanceKm(allTime.distanceM), label: "Distance")
                tile(value: StatsFormat.kcal(allTime.kilojoules), label: "Energy")
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private func tile(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(Theme.FontStyle.mono(20, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label.uppercased())
                .font(Theme.FontStyle.sans(9.5, weight: .semibold))
                .tracking(1.0)
                .foregroundStyle(Theme.Palette.fg3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }
}

private struct YoYSection: View {
    let yoy: StatsPayload.YoY
    let historyFloor: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                SectionLabel(text: "\(yoy.year) VS \(yoy.priorYear)")
                Spacer()
                Text(yoy.periodLabel)
                    .font(Theme.FontStyle.mono(10))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            if yoy.metrics.isEmpty {
                Text("No year-over-year data yet.")
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
                    .frame(maxWidth: .infinity, minHeight: 60)
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible())],
                    spacing: Theme.Spacing.sm
                ) {
                    ForEach(yoy.metrics) { metric in
                        YoYCard(metric: metric)
                    }
                }
                HStack(spacing: 6) {
                    Image(systemName: "info.circle")
                        .font(.system(size: 10))
                    Text("Partial history — data starts \(historyFloor).")
                }
                .font(Theme.FontStyle.sans(10))
                .foregroundStyle(Theme.Palette.fg3)
            }
        }
    }
}

private struct YoYCard: View {
    let metric: StatsPayload.YoY.Metric

    private var hasBoth: Bool { metric.current != nil && metric.prior != nil }
    private var deltaColor: Color {
        guard let d = metric.delta else { return Theme.Palette.fg3 }
        return d >= 0 ? Theme.Palette.success : Theme.Palette.danger
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(metric.label)
                .font(Theme.FontStyle.sans(11, weight: .medium))
                .foregroundStyle(Theme.Palette.fg2)
                .lineLimit(1)

            Text(StatsFormat.value(metric.current, unit: metric.unit))
                .font(Theme.FontStyle.mono(19, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .lineLimit(1)
                .minimumScaleFactor(0.6)

            HStack(spacing: 6) {
                if hasBoth, let deltaText = StatsFormat.delta(metric.delta) {
                    Text(deltaText)
                        .font(Theme.FontStyle.mono(11, weight: .semibold))
                        .foregroundStyle(deltaColor)
                }
                Text("vs \(StatsFormat.value(metric.prior, unit: metric.unit))")
                    .font(Theme.FontStyle.mono(10))
                    .foregroundStyle(Theme.Palette.fg3)
                    .lineLimit(1)
            }

            if metric.spark.count >= 2 {
                Sparkline(values: metric.spark, color: deltaColor)
                    .frame(height: 30)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(padding: Theme.Spacing.sm)
    }
}

private struct Sparkline: View {
    let values: [Double]
    let color: Color

    var body: some View {
        Chart {
            ForEach(Array(values.enumerated()), id: \.offset) { idx, v in
                LineMark(
                    x: .value("i", idx),
                    y: .value("v", v)
                )
                .interpolationMethod(.catmullRom)
                .foregroundStyle(color.opacity(0.85))
                .lineStyle(StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
    }
}

private struct BySportCard: View {
    let items: [StatsPayload.SportCount]

    private var maxCount: Int { max(items.map(\.count).max() ?? 1, 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionLabel(text: "BY SPORT")
            VStack(spacing: 10) {
                ForEach(items) { item in
                    row(for: item)
                }
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private func row(for item: StatsPayload.SportCount) -> some View {
        let color = Color(hex: item.colorHex)
        let fraction = CGFloat(item.count) / CGFloat(maxCount)
        return HStack(spacing: Theme.Spacing.sm) {
            Text(item.sport)
                .font(Theme.FontStyle.sans(11.5))
                .foregroundStyle(Theme.Palette.fg1)
                .lineLimit(1)
                .frame(width: 90, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.05))
                    Capsule()
                        .fill(color)
                        .frame(width: max(geo.size.width * fraction, 3))
                        .shadow(color: color.opacity(0.5), radius: 4)
                }
            }
            .frame(height: 10)
            Text("\(item.count)")
                .font(Theme.FontStyle.mono(11, weight: .medium))
                .foregroundStyle(Theme.Palette.fg2)
                .frame(width: 36, alignment: .trailing)
        }
    }
}

private struct RecordsSection: View {
    let records: [StatsPayload.Record]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionLabel(text: "PERSONAL RECORDS")
            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible())],
                spacing: Theme.Spacing.sm
            ) {
                ForEach(records) { record in
                    card(for: record)
                }
            }
        }
    }

    private func card(for record: StatsPayload.Record) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(record.valueDisplay)
                .font(Theme.FontStyle.mono(18, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg0)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(record.label)
                .font(Theme.FontStyle.sans(11, weight: .medium))
                .foregroundStyle(Theme.Palette.fg2)
                .lineLimit(2)
            if let meta = record.meta {
                Text(meta)
                    .font(Theme.FontStyle.mono(9.5))
                    .foregroundStyle(Theme.Palette.fg3)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(padding: Theme.Spacing.sm)
    }
}

private struct TrendCard: View {
    let trend: [StatsPayload.TrendMonth]

    private static let strainMax: Double = 21

    private var maxCount: Double { max(Double(trend.map(\.count).max() ?? 1), 1) }
    private var hasStrain: Bool { trend.contains { $0.avgStrain != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                SectionLabel(text: "MONTHLY TREND")
                Spacer()
                legend
            }
            chart
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private var legend: some View {
        HStack(spacing: 10) {
            legendItem(color: Theme.Palette.info, label: "Workouts")
            if hasStrain {
                legendItem(color: Theme.Palette.strain, label: "Strain")
            }
        }
    }

    private func legendItem(color: Color, label: String) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            Text(label)
                .font(Theme.FontStyle.sans(10))
                .foregroundStyle(Theme.Palette.fg3)
        }
    }

    @ViewBuilder
    private var chart: some View {
        Chart {
            ForEach(trend) { month in
                BarMark(
                    x: .value("Month", month.month),
                    y: .value("Workouts", Double(month.count))
                )
                .cornerRadius(2)
                .foregroundStyle(Theme.Palette.info.opacity(month.partial ? 0.3 : 0.85))
            }
            ForEach(trend) { month in
                if let strain = month.avgStrain {
                    let scaled = strain / Self.strainMax * maxCount
                    LineMark(
                        x: .value("Month", month.month),
                        y: .value("StrainScaled", scaled),
                        series: .value("Series", "strain")
                    )
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(Theme.Palette.strain.opacity(0.9))
                    .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                    PointMark(
                        x: .value("Month", month.month),
                        y: .value("StrainScaled", scaled)
                    )
                    .foregroundStyle(Theme.Palette.strain.opacity(month.partial ? 0.3 : 1))
                    .symbolSize(month.partial ? 20 : 36)
                }
            }
        }
        .frame(height: 200)
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { _ in
                AxisValueLabel()
                    .foregroundStyle(Theme.Palette.fg3)
                    .font(Theme.FontStyle.mono(9.5))
                AxisGridLine()
                    .foregroundStyle(Theme.Palette.borderSubtle)
            }
            if hasStrain {
                AxisMarks(position: .trailing, values: strainTickPositions) { value in
                    if let pos = value.as(Double.self) {
                        AxisValueLabel {
                            Text(strainLabel(forScaled: pos))
                                .foregroundStyle(Theme.Palette.strain.opacity(0.7))
                                .font(Theme.FontStyle.mono(9.5))
                        }
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let raw = value.as(String.self) {
                        Text(StatsFormat.monthLabel(raw))
                            .foregroundStyle(Theme.Palette.fg3)
                            .font(Theme.FontStyle.mono(9))
                    }
                }
            }
        }
    }

    private var strainTickPositions: [Double] {
        [0, 7, 14, 21].map { $0 / Self.strainMax * maxCount }
    }

    private func strainLabel(forScaled scaled: Double) -> String {
        let strain = scaled / maxCount * Self.strainMax
        return "\(Int(strain.rounded()))"
    }
}

enum StatsFormat {
    static func grouped(_ n: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: n)) ?? "\(Int(n.rounded()))"
    }

    static func hours(_ seconds: Double?) -> String {
        guard let seconds else { return "—" }
        let h = seconds / 3600
        if h >= 10 { return "\(grouped(h))h" }
        return String(format: "%.1fh", h)
    }

    static func distanceKm(_ meters: Double?) -> String {
        guard let meters else { return "—" }
        let km = meters / 1000
        if km >= 100 { return "\(grouped(km)) km" }
        return String(format: "%.1f km", km)
    }

    static func kcal(_ kilojoules: Double?) -> String {
        guard let kilojoules else { return "—" }
        let kcal = kilojoules / 4.184
        return "\(grouped(kcal)) kcal"
    }

    static func value(_ v: Double?, unit: String) -> String {
        guard let v else { return "—" }
        let num: String
        if abs(v) >= 100 || v.rounded() == v {
            num = grouped(v)
        } else {
            num = String(format: "%.1f", v)
        }
        return unit.isEmpty ? num : "\(num) \(unit)"
    }

    static func delta(_ d: Double?) -> String? {
        guard let d else { return nil }
        let arrow = d >= 0 ? "▲" : "▼"
        return "\(arrow) \(String(format: "%.0f", abs(d)))%"
    }

    static func monthLabel(_ raw: String) -> String {
        let parts = raw.split(separator: "-")
        guard parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) else { return raw }
        let names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return names[m - 1]
    }
}
