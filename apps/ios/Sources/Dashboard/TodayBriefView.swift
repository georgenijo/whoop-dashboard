import SwiftUI

/// Only a current, nonempty analysis of current readings can lead Today.
/// Older advice stays available separately, never as today's next action.
struct TodayBriefContent {
    let current: DashboardPayload.AIInsight?
    let previous: DashboardPayload.AIInsight?
    let isFallback: Bool

    init(insight: DashboardPayload.AIInsight?, isFallback: Bool) {
        let available = insight.flatMap { value in
            value.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? value : nil
        }
        self.isFallback = isFallback
        current = !isFallback && available?.isCurrent == true ? available : nil
        previous = current == nil ? available : nil
    }

    var title: String {
        if isFallback { return "Start with your latest readings." }
        return "Make sense of today."
    }

    var explanation: String {
        if isFallback {
            return "Today's readings haven't arrived. Coach can review what's available before discussing your next session."
        }
        return "A current brief isn't available yet. Ask Coach to put your recovery, sleep and training into context."
    }

    var prompt: String {
        if isFallback {
            return "Help me understand my latest data and what is missing before suggesting today's training."
        }
        return current == nil
            ? "Review today's recovery, sleep and training. What should I focus on next, and why?"
            : AIInsightCardView.askCoachPrompt
    }
}

struct TodayBriefView: View {
    let content: TodayBriefContent
    @State private var showFull = false
    @State private var showPrevious = false

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 8) {
                    Image(systemName: "bubble.left.and.bubble.right")
                    Text("Daily brief")
                        .accessibilityAddTraits(.isHeader)
                }
                .font(Theme.FontStyle.sans(13, weight: .medium))
                .foregroundStyle(Theme.Palette.accent)

                if let insight = content.current, let text = insight.text {
                    let digest = InsightDigest(markdown: text)
                    if let headline = digest.headline {
                        Text(.init(headline))
                            .font(Theme.FontStyle.display(28, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("Your brief is ready.")
                            .font(Theme.FontStyle.display(28, weight: .medium))
                    }
                    if let written = InsightDate.short(insight.createdAt) {
                        Text("Written \(written)")
                            .font(Theme.FontStyle.sans(11))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    if !digest.actions.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Suggested next")
                                .font(Theme.FontStyle.sans(13, weight: .medium))
                                .foregroundStyle(Theme.Palette.fg2)
                            ForEach(Array(digest.actions.enumerated()), id: \.offset) { index, action in
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: index == 0 ? "arrow.turn.down.right" : "minus")
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(Theme.Palette.accent)
                                        .frame(width: 18)
                                        .frame(minHeight: 24)
                                        .accessibilityHidden(true)
                                    Text(.init(action))
                                        .font(Theme.FontStyle.sans(15, weight: index == 0 ? .medium : .regular))
                                        .foregroundStyle(index == 0 ? Theme.Palette.fg0 : Theme.Palette.fg1)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        .padding(.top, 8)
                    }
                } else {
                    Text(content.title)
                        .font(Theme.FontStyle.display(32, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(content.explanation)
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Button {
                    NotificationCenter.default.post(name: .coachComposeRequested, object: content.prompt)
                } label: {
                    HStack(spacing: 12) {
                        Text(content.current == nil ? "Review with Coach" : "Discuss with Coach")
                        Spacer(minLength: 8)
                        Image(systemName: "arrow.up.right")
                    }
                    .font(Theme.FontStyle.sans(15, weight: .medium))
                    .foregroundStyle(Theme.Palette.bg0)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .background(Theme.Palette.accent, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens a draft in Coach. Nothing is sent until you tap Send.")
                .accessibilityIdentifier("today-review-coach")
                if content.current != nil {
                    Button("Read full brief") { showFull = true }
                        .font(Theme.FontStyle.sans(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg2)
                        .frame(minHeight: 44)
                }
            }

            if let previous = content.previous {
                Button { showPrevious = true } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text("Previous analysis")
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                        }
                        .font(Theme.FontStyle.sans(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg1)
                        Text(InsightDate.short(previous.createdAt).map { "Written \($0) · historical advice" } ?? "Undated · historical advice")
                            .font(Theme.FontStyle.sans(11))
                            .foregroundStyle(Theme.Palette.fg3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                    .overlay(alignment: .top) { LedgerRule() }
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 12)
        .sheet(isPresented: $showFull) {
            if let insight = content.current { InsightFullSheet(insight: insight) }
        }
        .sheet(isPresented: $showPrevious) {
            if let insight = content.previous { InsightFullSheet(insight: insight, historical: true) }
        }
    }
}
