import Foundation
import SwiftUI

struct CoachWorkLogView: View {
    let workLog: CoachWorkLog

    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(workLog.notes.enumerated()), id: \.offset) { _, note in
                    Text(note)
                        .font(Theme.FontStyle.sans(12))
                        .foregroundStyle(Theme.Palette.fg2)
                }
                ForEach(workLog.tools) { tool in
                    CoachToolActivityRow(tool: tool)
                }
                if workLog.tools.isEmpty && workLog.notes.isEmpty {
                    Text("No tool calls")
                        .font(Theme.FontStyle.mono(10.5))
                        .foregroundStyle(Theme.Palette.fg3)
                }
            }
            .padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: workLog.status == .complete ? "checkmark.circle" : "exclamationmark.circle")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(statusColor)
                Text(summary)
                    .font(Theme.FontStyle.sans(11.5, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg2)
            }
        }
        .tint(Theme.Palette.fg3)
        .padding(.bottom, 8)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Theme.Palette.borderSubtle)
                .frame(height: 1)
        }
    }

    private var summary: String {
        let duration = Self.duration(workLog.durationMs)
        switch workLog.status {
        case .complete: return "Worked for \(duration)"
        case .running: return "Working for \(duration)"
        case .error, .aborted: return "Stopped after \(duration)"
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

struct LiveCoachWorkView: View {
    let tools: [LiveToolActivity]

    @State private var expanded = true

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            if tools.isEmpty {
                Text("Thinking…")
                    .font(Theme.FontStyle.sans(11.5))
                    .foregroundStyle(Theme.Palette.fg3)
                    .padding(.top, 6)
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(tools) { tool in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(Theme.Palette.warning)
                                .frame(width: 5, height: 5)
                            Text(tool.stage.map { "\(Self.label(tool.name)) · \($0)" } ?? Self.label(tool.name))
                                .font(Theme.FontStyle.sans(11.5))
                                .foregroundStyle(Theme.Palette.fg2)
                        }
                    }
                }
                .padding(.top, 7)
            }
        } label: {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.mini)
                    .tint(Theme.Palette.ai)
                Text("Working")
                    .font(Theme.FontStyle.sans(11.5, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg2)
            }
        }
        .tint(Theme.Palette.fg3)
        .padding(.vertical, 4)
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

private struct CoachToolActivityRow: View {
    let tool: CoachToolActivity

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: tool.status == "error" ? "xmark.circle" : "checkmark.circle")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(tool.status == "error" ? Theme.Palette.danger : Theme.Palette.success)
            Text(LiveCoachWorkView.label(tool.name).replacingOccurrences(of: "Querying", with: "Queried"))
                .font(Theme.FontStyle.sans(11.5))
                .foregroundStyle(Theme.Palette.fg2)
            Spacer(minLength: 8)
            if let rows = tool.rows {
                Text("\(rows) row\(rows == 1 ? "" : "s")")
            }
            if let durationMs = tool.durationMs {
                Text(CoachWorkLogView.duration(durationMs))
            }
        }
        .font(Theme.FontStyle.mono(9.5))
        .foregroundStyle(Theme.Palette.fg3)
    }
}
