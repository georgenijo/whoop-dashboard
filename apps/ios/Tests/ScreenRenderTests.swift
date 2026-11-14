import SwiftUI
import UIKit
import XCTest
@testable import Coach

/// Temporary visual check: renders the refined screens against canned
/// payloads (served through a URLProtocol stub) and writes PNGs.
final class ScreenRenderTests: XCTestCase {
    private static let outDir = "/tmp/rtoday-render"

    // MARK: Canned data

    private static func key(_ daysAgo: Int) -> String {
        ChartDate.key(Date().addingTimeInterval(Double(-daysAgo) * 86_400))
    }

    private static func iso(hour: Int, minute: Int) -> String {
        let cal = Calendar.current
        let d = cal.date(bySettingHour: hour, minute: minute, second: 0, of: Date())!
        let f = ISO8601DateFormatter()
        return f.string(from: d)
    }

    private static func wave(_ n: Int, base: Double, amp: Double, last: Double?, phase: Double = 0) -> [[String: Any]] {
        (0..<n).map { i in
            let daysAgo = n - 1 - i
            var v = base + sin(Double(i) * 0.9 + phase) * amp + cos(Double(i) * 0.37) * amp * 0.4
            if daysAgo == 0, let last { v = last }
            let ma = base + sin(Double(i) * 0.25 + phase) * amp * 0.15
            return ["date": key(daysAgo), "raw": v, "ma7": i >= 6 ? ma : NSNull(), "ma30": NSNull()]
        }
    }

    private static func tile(_ key: String, _ label: String, _ value: Double, _ unit: String, _ precision: Int,
                             _ delta: String?, _ dir: String = "flat", href: String? = nil) -> [String: Any] {
        var t: [String: Any] = ["key": key, "label": label, "value": value, "unit": unit, "precision": precision, "color_hex": "#ffffff"]
        if let delta { t["delta"] = ["label": delta, "dir": dir] }
        if let href { t["href"] = href }
        return t
    }

    private static func json(for path: String) -> Any {
        switch path {
        case "/api/ios/dashboard":
            return [
                "data_date": key(0), "is_fallback": false,
                "recovery_hero": ["score": 48, "hrv_ms": 41, "rhr_bpm": 58, "updated_at": iso(hour: 8, minute: 21)],
                "ai_insight": [
                    "text": "## Key Findings\n- A short night after yesterday's 14.6-strain leg session pulled recovery down to 48%.\n\n## Action Items\n1. Keep it aerobic: 30–40 min of Zone 2, heart rate under 140.\n2. Hold heavy lower-body work until HRV is back near 46 ms.\n3. Lights out by 10:45 PM to start paying down 1h 50m of sleep debt.\n",
                    "created_at": iso(hour: 7, minute: 5), "is_stale": false
                ],
                "kpi": [
                    tile("recovery", "Recovery", 48, "%", 0, "↓ 13 vs yesterday", "down", href: "/recovery"),
                    tile("hrv", "HRV", 41, "ms", 0, "↓ 7 ms vs yesterday", "down", href: "/recovery"),
                    tile("rhr", "Resting HR", 58, "bpm", 0, "↑ 4 bpm vs yesterday", "down", href: "/recovery"),
                    tile("sleep", "Sleep", 5.3, "h", 1, "↓ 1h 24m asleep vs yesterday", "down", href: "/sleep"),
                    tile("strain", "Strain", 3.1, "", 1, "↓ 11.5 vs yesterday", "down", href: "/strain"),
                    tile("steps", "Steps", 2140, "", 0, "↓ 7672 vs yesterday", "down", href: "/steps"),
                    tile("spo2", "SpO₂", 95.8, "%", 1, "↓ 0.6% vs yesterday", "down", href: "/recovery")
                ],
                "prs": [
                    "best_hrv": ["value": 78, "date": "2026-08-03"],
                    "lowest_rhr": ["value": 47, "date": "2026-07-28"],
                    "recovery_streak": ["count": 4, "start_date": "2026-11-06", "end_date": "2026-11-09"],
                    "logging_streak": ["count": 212, "start_date": "2026-04-16", "end_date": key(0)]
                ],
                "recovery_trend": wave(30, base: 61, amp: 9, last: 48)
            ]
        case "/api/ios/recovery":
            let hrv = wave(30, base: 47, amp: 7, last: 41, phase: 1)
            return [
                "range_label": "Last 30 days",
                "kpi": [
                    tile("recovery", "Recovery", 48, "%", 0, "↓ 13 vs yesterday", "down"),
                    tile("hrv", "HRV", 41, "ms", 0, "↓ 5 ms vs yesterday", "down"),
                    tile("rhr", "RHR", 58, "bpm", 0, "↑ 4 bpm vs yesterday", "down"),
                    tile("sleep", "Sleep", 5.3, "h", 1, "↓ 1.4h vs yesterday", "down"),
                    tile("spo2", "SpO2", 95.8, "%", 1, "↓ 0.6% vs yesterday", "down")
                ],
                "recovery_trend": wave(30, base: 61, amp: 9, last: 48),
                "hrv_trend": ["points": hrv, "anomalies": [
                    ["date": key(17), "baseline_ms": 47, "pct_below": 24],
                    ["date": key(0), "baseline_ms": 47, "pct_below": 13]
                ]],
                "rhr_trend": wave(30, base: 54, amp: 3, last: 58, phase: 2),
                "spo2_trend": ["points": (0..<30).map { ["date": key(29 - $0), "value": 96.4 + sin(Double($0)) * 0.6] as [String: Any] },
                               "avg": 96.4, "lowest": 95.1, "best": 97.6, "y_min": 94, "y_max": 99]
            ]
        case "/api/ios/sleep":
            return [
                "range_label": "Last 30 days",
                "kpi": [tile("sleep", "Sleep", 5.3, "h", 1, "↓ 1.4h vs yesterday", "down")],
                "latest_sleep": [
                    "date": key(0),
                    "stages": ["light_ms": 9_660_000, "deep_ms": 4_320_000, "rem_ms": 5_100_000, "awake_ms": 1_860_000],
                    "need_breakdown": ["baseline_ms": 27_000_000, "debt_ms": 6_600_000, "strain_ms": 1_500_000, "nap_ms": 0]
                ],
                "duration_trend": (0..<30).map { i -> [String: Any] in
                    ["date": key(29 - i), "raw_hours": i == 29 ? 5.8 : 7.2 + sin(Double(i)) * 0.9, "ma7": i >= 6 ? 7.0 : NSNull()]
                },
                "performance_trend": wave(30, base: 84, amp: 8, last: 63)
            ]
        case "/api/ios/strain":
            return [
                "range_label": "Last 30 days",
                "kpi": [tile("strain", "Strain", 3.1, "", 1, "↓ 11.5 vs yesterday", "down")],
                "today": ["date": key(0), "total_kilojoule": 1727, "total_kcal": 412, "avg_hr": 78, "max_hr": 112, "workout_count": 0, "workouts": []],
                "strain_trend": wave(30, base: 9.8, amp: 3.5, last: 3.1, phase: 3),
                "avg_hr_trend": wave(30, base: 70, amp: 4, last: 70)
            ]
        case "/api/ios/steps":
            return [
                "range_label": "Last 30 days",
                "kpi": [tile("steps", "Steps", 2140, "", 0, "↓ 7672 vs yesterday", "down")],
                "steps_trend": wave(30, base: 8900, amp: 2200, last: 2140, phase: 4),
                "today": ["date": key(0), "steps": 2140, "vs_7d_avg": -6820]
            ]
        case "/api/ios/workouts":
            return [
                "range_label": "Last 30 days", "total_count": 27, "truncated": false,
                "sport_frequency": [
                    ["sport": "weightlifting", "sessions": 13, "kj": 9000, "duration_min": 900, "color_hex": "#7b61ff"],
                    ["sport": "running", "sessions": 6, "kj": 5000, "duration_min": 300, "color_hex": "#ff7a1a"],
                    ["sport": "soccer", "sessions": 4, "kj": 4000, "duration_min": 380, "color_hex": "#00d4aa"]
                ],
                "zone_breakdown_recent": [], "distance_recent": [], "workouts": []
            ]
        case "/api/ios/stats":
            let month = { (i: Int, c: Int, s: Double, p: Bool) -> [String: Any] in
                ["month": String(format: "2026-%02d", i), "count": c, "avg_strain": s, "partial": p]
            }
            return [
                "range_label": "Last 90 days",
                "all_time": ["workouts": 871, "active_seconds": 4_078_800, "distance_m": 1_697_000, "kilojoules": 927_367],
                "yoy": ["year": 2026, "prior_year": 2025, "period_label": "Jan 1 – Nov 14", "metrics": [
                    ["key": "workouts", "label": "Workouts", "current": 221, "prior": 165, "delta": 56, "unit": "", "spark": [14, 18, 22, 20, 25, 21, 19, 24, 26, 22]],
                    ["key": "active_hours", "label": "Active hours", "current": 153, "prior": 126, "delta": 27, "unit": "h", "spark": [10, 14, 16, 15, 18, 15, 14, 17, 18, 16]],
                    ["key": "distance", "label": "Distance", "current": 147, "prior": 199, "delta": -52, "unit": "mi", "spark": [10, 12, 15, 14, 17, 15, 12, 16, 18, 18]],
                    ["key": "calories", "label": "Calories", "current": 55327, "prior": 41000, "delta": 14327, "unit": "cal", "spark": [3, 4, 5, 6, 5, 6, 5, 6, 7, 8]]
                ]],
                "by_sport": [
                    ["sport": "weightlifting", "count": 13, "color_hex": "#7b61ff"],
                    ["sport": "running", "count": 6, "color_hex": "#ff7a1a"],
                    ["sport": "soccer", "count": 4, "color_hex": "#00d4aa"],
                    ["sport": "walking", "count": 3, "color_hex": "#00d4aa"],
                    ["sport": "cycling", "count": 1, "color_hex": "#00d4aa"]
                ],
                "records": [
                    ["key": "longest_session", "label": "Longest session", "value_display": "2:10", "meta": "walking · Aug 19, 2024"],
                    ["key": "most_calories", "label": "Most calories", "value_display": "1,972 cal", "meta": "soccer · Jul 25, 2026"],
                    ["key": "highest_strain", "label": "Highest strain", "value_display": "20.0", "meta": "soccer · Jul 25, 2026"]
                ],
                "trend": [month(8, 24, 8.4, false), month(9, 30, 7.4, false), month(10, 28, 8.9, false), month(11, 11, 9.6, true)],
                "history_floor": "2019-12-10",
                "window_start": key(89), "window_end": key(0)
            ]
        default:
            return [:]
        }
    }

    final class Stub: URLProtocol {
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            let path = request.url?.path ?? ""
            let body = (try? JSONSerialization.data(withJSONObject: ScreenRenderTests.json(for: path))) ?? Data()
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

    private var api: APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Stub.self]
        return APIClient(baseURL: URL(string: "https://stub.invalid")!, session: URLSession(configuration: config))
    }

    // MARK: Rendering

    @MainActor
    private func snapshot<V: View>(_ view: V, name: String, size: CGSize, regular: Bool, fold: FoldGeometry,
                                   scrollToBottom: Bool = false, wait: TimeInterval = 2.5) throws {
        try FileManager.default.createDirectory(atPath: Self.outDir, withIntermediateDirectories: true)
        let root = view
            .environment(\.api, api)
            .environment(\.horizontalSizeClass, regular ? .regular : .compact)
            .environment(\.foldGeometry, fold)
            .preferredColorScheme(.dark)
            .background(Color.black)
        let host = UIHostingController(rootView: root)
        host.view.backgroundColor = .black
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
        window.frame = CGRect(origin: .zero, size: size)
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        RunLoop.main.run(until: Date().addingTimeInterval(wait))
        host.view.layoutIfNeeded()
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 3; return f }())
        let image = renderer.image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        try image.pngData()!.write(to: URL(fileURLWithPath: "\(Self.outDir)/\(name).png"))
        window.isHidden = true
    }

    private let inner = CGSize(width: 867, height: 669)
    private let cover = CGSize(width: 382, height: 678)
    private let innerFold = FoldGeometry(width: 867, hinge: 455 ... 495)

    @MainActor
    func testRenderAll() throws {
        let tall = CGSize(width: 867, height: 1500)
        let coverTall = CGSize(width: 382, height: 1900)
        try snapshot(DashboardView(), name: "01-today-inner", size: inner, regular: true, fold: innerFold)
        try snapshot(DashboardView(), name: "01-today-inner-scroll", size: tall, regular: true, fold: innerFold)
        try snapshot(DashboardView(), name: "01-today-cover", size: cover, regular: false, fold: .none)
        try snapshot(ActivityView(), name: "02-trends-inner", size: inner, regular: true, fold: innerFold)
        try snapshot(ActivityView(), name: "02-trends-inner-scroll", size: CGSize(width: 867, height: 1700), regular: true, fold: innerFold)
        try snapshot(ActivityView(), name: "02-trends-cover", size: cover, regular: false, fold: .none)
        try snapshot(NavigationStack { StatsView(range: .constant(.d90)) }, name: "03-progress-inner", size: inner, regular: true, fold: innerFold)
        try snapshot(NavigationStack { StatsView(range: .constant(.d90)) }, name: "03-progress-inner-scroll", size: tall, regular: true, fold: innerFold)
        try snapshot(NavigationStack { StatsView(range: .constant(.d90)) }, name: "03-progress-cover", size: coverTall, regular: false, fold: .none)
        try snapshot(NavigationStack { RecoveryView() }, name: "09-recovery-inner", size: inner, regular: true, fold: innerFold)
        try snapshot(NavigationStack { RecoveryView() }, name: "09-recovery-inner-scroll", size: tall, regular: true, fold: innerFold)
        try snapshot(NavigationStack { RecoveryView() }, name: "09-recovery-cover", size: coverTall, regular: false, fold: .none)
        try snapshot(NavigationStack { SleepView() }, name: "10-sleep-inner", size: inner, regular: true, fold: innerFold)
        try snapshot(NavigationStack { SleepView() }, name: "10-sleep-inner-scroll", size: tall, regular: true, fold: innerFold)
        try snapshot(NavigationStack { SleepView() }, name: "10-sleep-cover", size: coverTall, regular: false, fold: .none)
    }
}
