import SwiftUI
import Charts

private enum WD {
    // Whoop HR zone palette (Z0..Z5) — shared by the curve and the zone bar.
    static let zoneColors: [Color] = [
        Color(hex: "#1e3a8a"),
        Color(hex: "#2563eb"),
        Color(hex: "#06b6d4"),
        Color(hex: "#facc15"),
        Color(hex: "#f97316"),
        Color(hex: "#b91c1c"),
    ]

    static func zoneIndex(bpm: Double, maxHr: Double) -> Int {
        guard maxHr > 0 else { return 0 }
        let pct = bpm / maxHr
        if pct >= 0.9 { return 5 }
        if pct >= 0.8 { return 4 }
        if pct >= 0.7 { return 3 }
        if pct >= 0.6 { return 2 }
        if pct >= 0.5 { return 1 }
        return 0
    }

    static func duration(_ secs: Double?) -> String {
        guard let s = secs else { return "—" }
        let total = Int(s.rounded())
        let h = total / 3600
        let m = (total % 3600) / 60
        if h > 0 { return "\(h)h \(m)m" }
        return "\(m)m"
    }

    static func clock(_ secs: Double) -> String {
        let total = max(0, Int(secs.rounded()))
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }

    static func elapsed(_ secs: Double) -> String {
        let m = Int((secs / 60).rounded())
        let h = m / 60
        let mm = m % 60
        return String(format: "%d:%02d", h, mm)
    }

    static func longDate(_ date: String) -> String {
        guard let d = ChartDate.parse(date) else { return date }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM d, yyyy"
        return f.string(from: d)
    }

    // Wall-clock time from an ISO-ish local string (no timezone math — the
    // backend already emits local wall time, so we read the HH:mm components).
    static func localTime(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        let timePart: Substring
        if let t = raw.firstIndex(of: "T") {
            timePart = raw[raw.index(after: t)...]
        } else if let space = raw.firstIndex(of: " ") {
            timePart = raw[raw.index(after: space)...]
        } else {
            timePart = raw[...]
        }
        let comps = timePart.split(separator: ":")
        guard comps.count >= 2, let h = Int(comps[0]), let m = Int(comps[1]) else { return nil }
        let period = h < 12 ? "AM" : "PM"
        var h12 = h % 12
        if h12 == 0 { h12 = 12 }
        return String(format: "%d:%02d %@", h12, m, period)
    }

    static func timeRange(_ start: String?, _ end: String?) -> String? {
        guard let s = localTime(start) else { return nil }
        if let e = localTime(end) { return "\(s) – \(e)" }
        return s
    }
}

struct WorkoutDetailView: View {
    @Environment(\.api) private var api
    let id: String

    @State private var phase: Phase = .loading

    enum Phase {
        case loading
        case loaded(WorkoutDetail)
        case error(String)
    }

    private var navTitle: String {
        if case .loaded(let w) = phase { return w.sport ?? "Workout" }
        return "Workout"
    }

    var body: some View {
        content
            .background(Theme.Palette.bg)
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let workout):
            ScrollView {
                VStack(spacing: Theme.Spacing.sm) {
                    HeaderCard(workout: workout)
                    StatStripCard(workout: workout)
                    HRCurveSection(workout: workout)
                    ZonesSection(workout: workout)
                    EffortSection(workout: workout)
                }
                .padding(Theme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
        case .error(let message):
            VStack(spacing: 12) {
                Text(message)
                    .font(Theme.FontStyle.sans(12))
                    .foregroundStyle(Theme.Palette.fg2)
                Button("Retry") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Palette.brandStrain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @MainActor
    private func load() async {
        if case .loaded = phase { return }
        phase = .loading
        do {
            let detail = try await WorkoutDetailService(api: api).load(id: id)
            phase = .loaded(detail)
        } catch APIError.unauthorized {
            phase = .error("Session expired. Sign in again.")
        } catch APIError.serverError(let code) {
            phase = .error(code == 404 ? "Workout not found." : "Server error (\(code))")
        } catch APIError.network(let err) {
            phase = .error("Network error: \(err.localizedDescription)")
        } catch {
            phase = .error("Could not load")
        }
    }
}

private func effectiveMaxHr(_ workout: WorkoutDetail) -> Double? {
    if let p = workout.profile?.maxHr { return Double(p) }
    if let m = workout.maxHr { return Double(m) }
    return nil
}

// MARK: - Header

private struct HeaderCard: View {
    let workout: WorkoutDetail

    private var isHealthKit: Bool { workout.source?.lowercased() == "healthkit" }
    private var hasHRSeries: Bool {
        guard let s = workout.hrSeries else { return false }
        return s.bpm.contains { $0 != nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                HStack(spacing: 8) {
                    Image(systemName: "figure.run")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.Palette.strain)
                    Text(workout.sport ?? "Workout")
                        .font(Theme.FontStyle.sans(19, weight: .bold))
                        .foregroundStyle(Theme.Palette.fg0)
                }
                Spacer()
            }

            HStack(spacing: 6) {
                Text(WD.longDate(workout.date))
                if let range = WD.timeRange(workout.startLocal, workout.endLocal) {
                    Text("·").foregroundStyle(Theme.Palette.fg4)
                    Text(range)
                }
                Text("·").foregroundStyle(Theme.Palette.fg4)
                Text(WD.duration(workout.durationSec))
            }
            .font(Theme.FontStyle.mono(11))
            .foregroundStyle(Theme.Palette.fg3)

            HStack(spacing: 6) {
                SourceBadge(label: isHealthKit ? "HealthKit" : "Whoop",
                            color: isHealthKit ? Theme.Palette.info : Theme.Palette.brandStrain)
                if hasHRSeries && !isHealthKit {
                    SourceBadge(label: "HealthKit HR", color: Theme.Palette.info)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(tint: .strain, padding: Theme.Spacing.md)
    }
}

private struct SourceBadge: View {
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 5, height: 5)
            Text(label)
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Hero stat strip

private struct StatStripCard: View {
    let workout: WorkoutDetail

    private var pctOfMax: (Int?) -> String? {
        { hr in
            guard let hr, let max = effectiveMaxHr(workout), max > 0 else { return nil }
            return "\(Int((Double(hr) / max * 100).rounded()))% of max"
        }
    }

    private var energy: (value: String, sub: String?) {
        guard let kj = workout.kilojoule else { return ("—", nil) }
        let cal = Int((kj * 0.239).rounded())
        return ("\(cal)", "\(Int(kj.rounded())) kJ")
    }

    private var distance: (value: String, sub: String?) {
        guard let m = workout.distanceM, m > 0 else { return ("—", "not recorded") }
        return (String(format: "%.2f", m / 1000), "km")
    }

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.md) {
            StatCell(label: "STRAIN",
                     value: workout.strain.map { String(format: "%.1f", $0) } ?? "—",
                     unit: nil, sub: nil, accent: Theme.Palette.strain)
            StatCell(label: "AVG HR",
                     value: workout.avgHr.map { "\($0)" } ?? "—",
                     unit: workout.avgHr != nil ? "bpm" : nil,
                     sub: pctOfMax(workout.avgHr), accent: nil)
            StatCell(label: "MAX HR",
                     value: workout.maxHr.map { "\($0)" } ?? "—",
                     unit: workout.maxHr != nil ? "bpm" : nil,
                     sub: pctOfMax(workout.maxHr), accent: nil)
            StatCell(label: "ENERGY", value: energy.value,
                     unit: workout.kilojoule != nil ? "cal" : nil,
                     sub: energy.sub, accent: nil)
            StatCell(label: "DISTANCE", value: distance.value,
                     unit: (workout.distanceM ?? 0) > 0 ? distance.sub : nil,
                     sub: (workout.distanceM ?? 0) > 0 ? nil : distance.sub, accent: nil)
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

private struct StatCell: View {
    let label: String
    let value: String
    let unit: String?
    let sub: String?
    let accent: Color?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(Theme.FontStyle.sans(9, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg3)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(Theme.FontStyle.display(20, weight: .medium))
                    .foregroundStyle(accent ?? Theme.Palette.fg0)
                    .monospacedDigit()
                if let unit {
                    Text(unit)
                        .font(Theme.FontStyle.mono(10))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            Text(sub ?? " ")
                .font(Theme.FontStyle.mono(9.5))
                .foregroundStyle(Theme.Palette.fg3)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - HR curve

private struct HRSegment: Identifiable {
    let id: Int
    let t0: Double
    let v0: Double
    let t1: Double
    let v1: Double
    let color: Color
}

private struct HRAreaPoint: Identifiable {
    let id: Int
    let t: Double
    let v: Double
}

private struct HRPlot {
    var segments: [HRSegment] = []
    var areaPoints: [HRAreaPoint] = []
    var peakT: Double = 0
    var peakV: Double = 0
    var yBot: Double = 0
    var yTop: Double = 0
    var boundaries: [Double] = []
    var sampleCount: Int = 0
}

private func buildHRPlot(series: WorkoutDetail.HRSeries, maxHr: Double?) -> HRPlot? {
    let bpm = series.bpm
    guard !bpm.isEmpty else { return nil }

    // Full samples with elapsed seconds relative to the first non-null sample.
    var firstT: Double?
    var full: [(t: Double, v: Double?)] = []
    full.reserveCapacity(bpm.count)
    for (i, raw) in bpm.enumerated() {
        let t = series.startOffsetSec + Double(i) * series.intervalSec
        if let raw, firstT == nil { firstT = t }
        full.append((t: t, v: raw.map(Double.init)))
    }
    guard let base = firstT else { return nil }

    // Downsample into fixed buckets to keep the chart light. A bucket with no
    // non-null samples stays nil and breaks the line (sensor dropout gap).
    let maxPoints = 300
    let stride = max(1, Int((Double(full.count) / Double(maxPoints)).rounded(.up)))
    var reduced: [(t: Double, v: Double?)] = []
    var idx = 0
    while idx < full.count {
        let end = min(idx + stride, full.count)
        let slice = full[idx..<end]
        let vals = slice.compactMap { $0.v }
        let midT = (slice.first!.t + slice.last!.t) / 2 - base
        if vals.isEmpty {
            reduced.append((t: midT, v: nil))
        } else {
            reduced.append((t: midT, v: vals.reduce(0, +) / Double(vals.count)))
        }
        idx = end
    }

    let nonNull = reduced.compactMap { $0.v }
    guard !nonNull.isEmpty else { return nil }

    var plot = HRPlot()
    plot.sampleCount = nonNull.count

    let seriesMax = nonNull.max() ?? 0
    let seriesMin = nonNull.min() ?? 0
    let topRef = max(seriesMax, maxHr ?? seriesMax)
    plot.yTop = (topRef / 10).rounded(.up) * 10
    plot.yBot = max(0, (seriesMin / 10).rounded(.down) * 10 - 10)
    if plot.yTop <= plot.yBot { plot.yTop = plot.yBot + 10 }

    // Peak
    for p in reduced where p.v != nil {
        if p.v! >= plot.peakV { plot.peakV = p.v!; plot.peakT = p.t }
    }

    // Segments (per adjacent non-null pair); a nil bucket breaks the line.
    var segId = 0
    for i in 0..<reduced.count {
        let cur = reduced[i]
        guard let cv = cur.v else { continue }
        plot.areaPoints.append(HRAreaPoint(id: i, t: cur.t, v: cv))
        if i > 0, let pv = reduced[i - 1].v {
            let mid = (pv + cv) / 2
            let color: Color
            if let mh = maxHr {
                color = WD.zoneColors[WD.zoneIndex(bpm: mid, maxHr: mh)]
            } else {
                color = Theme.Palette.strain
            }
            plot.segments.append(HRSegment(id: segId, t0: reduced[i - 1].t, v0: pv,
                                           t1: cur.t, v1: cv, color: color))
            segId += 1
        }
    }

    if let mh = maxHr {
        plot.boundaries = [0.6, 0.7, 0.8, 0.9].map { mh * $0 }
            .filter { $0 > plot.yBot && $0 < plot.yTop }
    }

    return plot
}

private struct HRCurveSection: View {
    let workout: WorkoutDetail

    var body: some View {
        if let series = workout.hrSeries,
           let plot = buildHRPlot(series: series, maxHr: effectiveMaxHr(workout)) {
            loaded(plot)
        } else {
            fallback
        }
    }

    private func loaded(_ plot: HRPlot) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("HEART RATE")
                        .font(Theme.FontStyle.sans(10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg2)
                    Text("\(plot.sampleCount) points")
                        .font(Theme.FontStyle.mono(10))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                Spacer()
                HStack(spacing: 12) {
                    if let peak = workout.maxHr {
                        labelled("peak", "\(peak)")
                    }
                    if let avg = workout.avgHr {
                        labelled("avg", "\(avg)")
                    }
                }
            }

            chart(plot)
                .frame(height: 200)

            HRZoneLegend(maxHr: effectiveMaxHr(workout))
        }
        .glassCard(padding: Theme.Spacing.md)
    }

    private func chart(_ plot: HRPlot) -> some View {
        Chart {
            ForEach(plot.areaPoints) { p in
                AreaMark(
                    x: .value("t", p.t),
                    yStart: .value("base", plot.yBot),
                    yEnd: .value("bpm", p.v)
                )
                .interpolationMethod(.catmullRom)
                .foregroundStyle(.linearGradient(
                    colors: [Theme.Palette.strain.opacity(0.22), Theme.Palette.strain.opacity(0.0)],
                    startPoint: .top, endPoint: .bottom))
            }

            ForEach(plot.boundaries, id: \.self) { b in
                RuleMark(y: .value("boundary", b))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .foregroundStyle(Theme.Palette.borderSubtle)
            }

            ForEach(plot.segments) { seg in
                LineMark(x: .value("t", seg.t0), y: .value("bpm", seg.v0),
                         series: .value("seg", seg.id))
                    .foregroundStyle(seg.color)
                    .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                LineMark(x: .value("t", seg.t1), y: .value("bpm", seg.v1),
                         series: .value("seg", seg.id))
                    .foregroundStyle(seg.color)
                    .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
            }

            PointMark(x: .value("t", plot.peakT), y: .value("bpm", plot.peakV))
                .symbolSize(70)
                .foregroundStyle(Theme.Palette.fg0)
                .annotation(position: .top) {
                    Text("\(Int(plot.peakV.rounded()))")
                        .font(Theme.FontStyle.mono(10, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg0)
                }
        }
        .chartYScale(domain: plot.yBot...plot.yTop)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 5)) { value in
                if let secs = value.as(Double.self) {
                    AxisValueLabel { Text(WD.elapsed(secs)) }
                        .foregroundStyle(Theme.Palette.fg3)
                        .font(Theme.FontStyle.mono(9.5))
                }
                AxisGridLine().foregroundStyle(Theme.Palette.borderSubtle)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { _ in
                AxisValueLabel()
                    .foregroundStyle(Theme.Palette.fg3)
                    .font(Theme.FontStyle.mono(9.5))
                AxisGridLine().foregroundStyle(Theme.Palette.borderSubtle)
            }
        }
    }

    private func labelled(_ label: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(label)
                .font(Theme.FontStyle.mono(9.5))
                .foregroundStyle(Theme.Palette.fg3)
            Text(value)
                .font(Theme.FontStyle.mono(11, weight: .semibold))
                .foregroundStyle(Theme.Palette.fg1)
        }
    }

    private var fallback: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("HEART RATE")
                .font(Theme.FontStyle.sans(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Theme.Palette.fg2)
            VStack(spacing: 8) {
                Image(systemName: "waveform.path.ecg")
                    .font(.title2)
                    .foregroundStyle(Theme.Palette.fg3)
                Text("HR detail not captured")
                    .font(Theme.FontStyle.sans(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg1)
                Text("Per-second curves appear on sessions captured through Apple Health.")
                    .font(Theme.FontStyle.sans(11))
                    .foregroundStyle(Theme.Palette.fg3)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 120)
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

private struct HRZoneLegend: View {
    let maxHr: Double?

    private func range(_ i: Int) -> String? {
        guard let mh = maxHr else { return nil }
        let lo = [0.5, 0.6, 0.7, 0.8, 0.9]
        let b = { (f: Double) in Int((mh * f).rounded()) }
        switch i {
        case 1: return "\(b(lo[0]))–\(b(lo[1]))"
        case 2: return "\(b(lo[1]))–\(b(lo[2]))"
        case 3: return "\(b(lo[2]))–\(b(lo[3]))"
        case 4: return "\(b(lo[3]))–\(b(lo[4]))"
        case 5: return "≥\(b(lo[4]))"
        default: return nil
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            ForEach(1..<6, id: \.self) { i in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(WD.zoneColors[i])
                        .frame(width: 8, height: 8)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Z\(i)")
                            .font(Theme.FontStyle.mono(9.5, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg2)
                        if let r = range(i) {
                            Text(r)
                                .font(Theme.FontStyle.mono(8))
                                .foregroundStyle(Theme.Palette.fg3)
                        }
                    }
                }
                if i < 5 { Spacer(minLength: 0) }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - HR Zones (Whoop zone_*_ms)

private struct ZonesSection: View {
    let workout: WorkoutDetail

    var body: some View {
        if let zones = workout.zones, zones.totalMs > 0 {
            loaded(zones)
        } else {
            EmptyView()
        }
    }

    private func loaded(_ zones: WorkoutDetail.Zones) -> some View {
        let total = zones.totalMs
        let arr = zones.asArray
        return VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("HR ZONES")
                    .font(Theme.FontStyle.sans(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.Palette.fg2)
                Spacer()
                if let mh = effectiveMaxHr(workout) {
                    Text("max HR \(Int(mh)) bpm")
                        .font(Theme.FontStyle.mono(10))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }

            GeometryReader { geo in
                HStack(spacing: 0) {
                    ForEach(0..<6, id: \.self) { i in
                        Rectangle()
                            .fill(WD.zoneColors[i])
                            .frame(width: geo.size.width * arr[i] / total)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1))
            }
            .frame(height: 14)

            VStack(spacing: 6) {
                ForEach(0..<6, id: \.self) { i in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(WD.zoneColors[i])
                            .frame(width: 8, height: 8)
                        Text("Z\(i)")
                            .font(Theme.FontStyle.mono(10.5, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg1)
                        Spacer()
                        Text(WD.clock(arr[i] / 1000))
                            .font(Theme.FontStyle.mono(10.5))
                            .foregroundStyle(Theme.Palette.fg2)
                        Text("\(Int((arr[i] / total * 100).rounded()))%")
                            .font(Theme.FontStyle.mono(10.5, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg3)
                            .frame(width: 38, alignment: .trailing)
                    }
                }
            }
        }
        .glassCard(padding: Theme.Spacing.md)
    }
}

// MARK: - Effort & Recovery

private struct EffortSection: View {
    let workout: WorkoutDetail

    private struct Cell: Identifiable {
        let id = UUID()
        let label: String
        let value: String
        let hint: String
        let color: Color
    }

    private var cells: [Cell] {
        guard let d = workout.derived else { return [] }
        var out: [Cell] = []
        if let drift = d.cardiacDriftPct {
            let up = drift > 0
            out.append(Cell(
                label: "Cardiac drift",
                value: String(format: "%@%.1f%%", up ? "+" : "", drift),
                hint: "HR vs effort, 1st vs 2nd half",
                color: up ? Theme.Palette.warning : Theme.Palette.recovery))
        }
        if let rr = d.recoveryRateBpm {
            let good = rr <= 0
            let sign = rr > 0 ? "+" : (rr < 0 ? "−" : "")
            out.append(Cell(
                label: "Recovery rate",
                value: "\(sign)\(abs(Int(rr.rounded()))) bpm/min",
                hint: "drop in first minute post-peak",
                color: good ? Theme.Palette.recovery : Theme.Palette.warning))
        }
        if let t90 = d.timeAbove90Sec {
            out.append(Cell(
                label: "Time > 90% max",
                value: WD.clock(t90),
                hint: "near maximal effort",
                color: Theme.Palette.fg0))
        }
        if let tr = d.trimp {
            out.append(Cell(
                label: "TRIMP",
                value: "\(Int(tr.rounded()))",
                hint: "Banister training impulse",
                color: Theme.Palette.fg0))
        }
        return out
    }

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
        GridItem(.flexible(), spacing: Theme.Spacing.sm),
    ]

    var body: some View {
        let items = cells
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack {
                    Text("EFFORT & RECOVERY")
                        .font(Theme.FontStyle.sans(10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.Palette.fg2)
                    Spacer()
                    HStack(spacing: 4) {
                        Circle().fill(Theme.Palette.recovery).frame(width: 5, height: 5)
                        Text("Estimated")
                            .font(Theme.FontStyle.mono(9.5))
                            .foregroundStyle(Theme.Palette.recovery)
                    }
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.md) {
                    ForEach(items) { cell in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(cell.label)
                                .font(Theme.FontStyle.sans(9, weight: .semibold))
                                .tracking(0.8)
                                .foregroundStyle(Theme.Palette.fg3)
                            Text(cell.value)
                                .font(Theme.FontStyle.display(18, weight: .medium))
                                .foregroundStyle(cell.color)
                                .monospacedDigit()
                            Text(cell.hint)
                                .font(Theme.FontStyle.mono(8.5))
                                .foregroundStyle(Theme.Palette.fg3)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Text("Derived server-side from the HealthKit HR stream against your 30-day profile.")
                    .font(Theme.FontStyle.mono(9.5))
                    .foregroundStyle(Theme.Palette.fg3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .glassCard(padding: Theme.Spacing.md)
        }
    }
}
