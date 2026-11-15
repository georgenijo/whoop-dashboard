import SwiftUI

/// Only a current, nonempty analysis of current readings can lead Today.
/// Older advice stays available separately, never as today's next action.
struct TodayBriefContent {
    /// What Today shows for the brief. Everything but `.current` is one compact row.
    enum Mode: Equatable {
        case current
        case fallback
        case writing
        case unavailable
    }

    let current: DashboardPayload.AIInsight?
    let previous: DashboardPayload.AIInsight?
    let isFallback: Bool
    let isRefreshing: Bool

    init(insight: DashboardPayload.AIInsight?, isFallback: Bool, isRefreshing: Bool = false) {
        let available = insight.flatMap { value in
            value.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? value : nil
        }
        self.isFallback = isFallback
        self.isRefreshing = isRefreshing
        current = !isFallback && available?.isCurrent == true ? available : nil
        previous = current == nil ? available : nil
    }

    var mode: Mode {
        if current != nil { return .current }
        if isFallback { return .fallback }
        return isRefreshing ? .writing : .unavailable
    }

    /// A current brief leads Today; otherwise the readings do.
    var leadsToday: Bool { mode == .current }

    /// Only a brief that is genuinely being written is worth re-fetching for.
    var shouldPoll: Bool { mode == .writing }

    var message: String {
        switch mode {
        case .current: return "Your brief is ready."
        case .fallback: return "Today's readings haven't arrived."
        case .writing: return "Writing today's brief…"
        case .unavailable: return "Today's brief isn't available"
        }
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

/// The brief when it is not current: one compact row under the readings.
struct TodayBriefRow: View {
    let content: TodayBriefContent

    var body: some View {
        HStack(spacing: 12) {
            if content.mode == .writing {
                ProgressView()
                    .controlSize(.small)
                Text(content.message)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg1)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        message
                        Spacer(minLength: 8)
                        action
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        message
                        action
                    }
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .overlay(alignment: .top) { LedgerRule() }
        .accessibilityElement(children: content.mode == .writing ? .combine : .contain)
        .accessibilityAddTraits(content.mode == .writing ? .updatesFrequently : [])
        .accessibilityIdentifier("today-brief-row")
    }

    private var message: some View {
        Text(content.message)
            .font(Theme.FontStyle.sans(15))
            .foregroundStyle(Theme.Palette.fg1)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: 44, alignment: .leading)
    }

    private var action: some View {
        Button {
            NotificationCenter.default.post(name: .coachComposeRequested, object: content.prompt)
        } label: {
            HStack(spacing: 6) {
                Text("Review with Coach")
                Image(systemName: "arrow.up.right")
            }
            .font(Theme.FontStyle.sans(15, weight: .medium))
            .foregroundStyle(Theme.Palette.accent)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens a draft in Coach. Nothing is sent until you tap Send.")
        .accessibilityIdentifier("today-review-coach")
    }
}

/// Earlier advice, kept reachable as a ruled row and always labelled historical.
struct TodayPreviousRow: View {
    let previous: DashboardPayload.AIInsight
    @State private var showPrevious = false

    var body: some View {
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
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .overlay(alignment: .top) { LedgerRule() }
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showPrevious) {
            InsightFullSheet(insight: previous, historical: true)
        }
    }
}

struct TodayBriefView: View {
    let content: TodayBriefContent
    @State private var showFull = false

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
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Button {
                    NotificationCenter.default.post(name: .coachComposeRequested, object: content.prompt)
                } label: {
                    HStack(spacing: 12) {
                        Text("Discuss with Coach")
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
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $showFull) {
            if let insight = content.current { InsightFullSheet(insight: insight) }
        }
    }
}
