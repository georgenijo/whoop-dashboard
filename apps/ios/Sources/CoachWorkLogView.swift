import Foundation
import SwiftUI

struct CoachWorkLogView: View {
    let workLog: CoachWorkLog

    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: statusSymbol)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(statusColor)
                        .frame(width: 16)
                    Text(summary)
                        .font(Theme.FontStyle.sans(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg2)
                    if let detail {
                        Text(detail)
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg3)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.selection, trigger: expanded)
            .accessibilityLabel(summary)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .accessibilityHint("Shows the steps the coach took")

            if expanded {
                WorkTimeline(notes: workLog.notes, tools: workLog.tools)
                    .padding(.top, 4)
                    .padding(.bottom, 6)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
    }

    private var summary: String {
        let duration = Self.duration(workLog.durationMs)
        switch workLog.status {
        case .complete: return "Worked for \(duration)"
        case .running: return "Working for \(duration)"
        case .error, .aborted: return "Stopped after \(duration)"
        }
    }

    private var detail: String? {
        let count = workLog.tools.count
        guard count > 0 else { return nil }
        return "· \(count) step\(count == 1 ? "" : "s")"
    }

    private var statusSymbol: String {
        switch workLog.status {
        case .complete: return "checkmark"
        case .running: return "ellipsis"
        case .error, .aborted: return "exclamationmark"
        }
    }

    private var statusColor: Color {
        switch workLog.status {
        case .complete: return Theme.Palette.success
        case .running: return Theme.Palette.warning
        case .error, .aborted: return Theme.Palette.danger
        }
    }

    static func duration(_ milliseconds: Int?) -> String {
        guard let milliseconds else { return "0s" }
        if milliseconds < 1_000 { return "\(milliseconds)ms" }
        if milliseconds < 60_000 {
            let seconds = Double(milliseconds) / 1_000
            return seconds < 10
                ? String(format: "%.1fs", seconds)
                : "\(Int(seconds.rounded()))s"
        }
        return "\(milliseconds / 60_000)m \((milliseconds % 60_000) / 1_000)s"
    }
}

/// A thin rail joins the steps so the log reads as one sequence.
private struct WorkTimeline: View {
    let notes: [String]
    let tools: [CoachToolActivity]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                step(dot: Theme.Palette.fg4) {
                    Text(note)
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg2)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            ForEach(tools) { tool in
                step(dot: tool.status == "error" ? Theme.Palette.danger : Theme.Palette.success) {
                    VStack(alignment: .leading, spacing: 6) {
                      HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(LiveCoachWorkView.label(tool.name).replacingOccurrences(of: "Querying", with: "Queried"))
                            .font(Theme.FontStyle.sans(13))
                            .foregroundStyle(Theme.Palette.fg1)
                        Spacer(minLength: 8)
                        Text(meta(tool))
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                      }
                      if let message = tool.stageMessage, !message.isEmpty {
                          Text(message).font(Theme.FontStyle.sans(12)).foregroundStyle(Theme.Palette.fg2)
                      }
                      if let error = tool.error, !error.isEmpty {
                          Text(error).font(Theme.FontStyle.sans(12)).foregroundStyle(Theme.Palette.danger)
                      }
                    }
                }
            }
            if tools.isEmpty && notes.isEmpty {
                step(dot: Theme.Palette.fg4) {
                    Text("Answered without looking anything up")
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
        }
        .background(alignment: .leading) {
            Rectangle()
                .fill(Theme.Palette.borderDefault)
                .frame(width: 1)
                .padding(.vertical, 8)
                .padding(.leading, 7.5)
        }
    }

    private func step<Content: View>(dot: Color, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle()
                .fill(dot)
                .frame(width: 6, height: 6)
                .background(Circle().fill(Theme.Palette.bg0).frame(width: 10, height: 10))
                .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 2.5 }
                .frame(width: 16)
            content()
        }
    }

    private func meta(_ tool: CoachToolActivity) -> String {
        var parts: [String] = []
        if tool.status == "error" { parts.append("failed") }
        if let rows = tool.rows { parts.append("\(rows) row\(rows == 1 ? "" : "s")") }
        if let durationMs = tool.durationMs { parts.append(CoachWorkLogView.duration(durationMs)) }
        return parts.joined(separator: " · ")
    }
}

struct LiveCoachWorkView: View {
    let tools: [LiveToolActivity]

    @State private var expanded = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startedAt = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(Theme.Palette.ai)
                        .frame(width: 16)
                    Text(headline)
                        .font(Theme.FontStyle.sans(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg2)
                    TimelineView(.periodic(from: startedAt, by: 1)) { context in
                        Text("· \(Self.elapsed(since: startedAt, now: context.date))")
                            .font(Theme.FontStyle.mono(11))
                            .foregroundStyle(Theme.Palette.fg3)
                            .contentTransition(.numericText())
                    }
                    if !tools.isEmpty {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.Palette.fg3)
                            .rotationEffect(.degrees(expanded ? 90 : 0))
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Coach is working")
            .accessibilityValue(headline)

            if expanded && !tools.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(tools) { tool in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: tool.isComplete ? (tool.error == nil ? "checkmark" : "exclamationmark") : "circle.fill")
                                .font(.system(size: tool.isComplete ? 11 : 6))
                                .foregroundStyle(tool.error == nil ? Theme.Palette.recovery : Theme.Palette.danger)
                                .frame(width: 16)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(tool.stage.map { "\(Self.label(tool.name)) · \($0)" } ?? Self.label(tool.name))
                                    .font(Theme.FontStyle.sans(13))
                                    .foregroundStyle(Theme.Palette.fg2)
                                if let message = tool.error ?? tool.message {
                                    Text(message)
                                        .font(Theme.FontStyle.sans(12))
                                        .foregroundStyle(Theme.Palette.fg3)
                                }
                            }
                        }
                        .transition(.opacity)
                    }
                }
                .padding(.top, 4)
                .animation(reduceMotion ? nil : .snappy, value: tools)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headline: String {
        tools.isEmpty ? "Thinking" : "Working"
    }

    static func elapsed(since start: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        return seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s"
    }

    fileprivate static func label(_ name: String) -> String {
        let labels = [
            "query_recovery": "Querying recovery",
            "query_sleep": "Querying sleep",
            "query_strain": "Querying strain",
            "query_workouts": "Querying workouts",
            "query_naps": "Querying naps",
            "query_journal": "Querying journal",
            "query_daily_snapshot": "Querying daily snapshot",
            "query_workout_plans": "Querying workout plans",
            "save_workout_plan": "Saving workout plan",
            "trigger_whoop_sync": "Syncing Whoop"
        ]
        return labels[name] ?? name.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

#Preview("Work log states") {
    VStack(alignment: .leading, spacing: 24) {
        LiveCoachWorkView(tools: [])
        LiveCoachWorkView(tools: [
            LiveToolActivity(name: "query_sleep", stage: nil),
            LiveToolActivity(name: "query_recovery", stage: "reading 30 days")
        ])
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(Color.black)
    .preferredColorScheme(.dark)
}
