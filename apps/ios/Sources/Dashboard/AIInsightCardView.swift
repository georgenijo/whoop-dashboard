import SwiftUI

struct AIInsightCardView: View {
    let insight: DashboardPayload.AIInsight
    var historical = false
    private var isCurrent: Bool { insight.isCurrent && !historical }

    @State private var showFull = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var digest: InsightDigest? {
        insight.text.map(InsightDigest.init(markdown:))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                header

                if !isCurrent, insight.text?.isEmpty == false {
                    Text("Historical advice · current readings may differ.")
                        .font(Theme.FontStyle.sans(13))
                        .foregroundStyle(Theme.Palette.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let digest, !digest.isEmpty {
                    digestBody(digest)
                } else if let text = insight.text, !text.isEmpty {
                    Text("Open the full analysis for details.")
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg2)
                } else {
                    Text("No daily analysis is available yet. You can ask Coach to review your latest data.")
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg2)
                }
            }
            .padding(Theme.Spacing.lg)

            if let text = insight.text, !text.isEmpty {
                LedgerRule()
                footer
            }
        }
        .glassCard(tint: .ai, padding: 0)
        .sheet(isPresented: $showFull) {
            InsightFullSheet(insight: insight, historical: historical)
        }
    }

    /// "Full analysis" and "Ask Coach" share one ruled row. Each half is a
    /// 44 pt-minimum target; at accessibility sizes they stack.
    private var footer: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
            : AnyLayout(HStackLayout(spacing: 0))
        return layout {
            Button { showFull = true } label: {
                HStack {
                    Text(isCurrent ? "Full analysis" : "Read previous analysis")
                        .font(Theme.FontStyle.sans(15, weight: .medium))
                        .foregroundStyle(Theme.Palette.fg0)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                .padding(.horizontal, Theme.Spacing.lg)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the full coach analysis")

            if isCurrent {
                if dynamicTypeSize.isAccessibilitySize {
                    LedgerRule()
                } else {
                    Rectangle().fill(Theme.Palette.borderSubtle).frame(width: 1, height: 52)
                }
                Button {
                    NotificationCenter.default.post(name: .coachComposeRequested, object: Self.askCoachPrompt)
                } label: {
                    Label("Ask Coach", systemImage: "bubble.left")
                        .font(Theme.FontStyle.sans(15, weight: .medium))
                        .foregroundStyle(Theme.Palette.accent)
                        .padding(.horizontal, Theme.Spacing.lg)
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Starts a Coach chat about today's brief")
            }
        }
    }

    static let askCoachPrompt = "Walk me through today's brief. What should I change about training and sleep, and why?"

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(isCurrent ? "Daily brief" : "Previous analysis")
                .font(Theme.FontStyle.sans(13, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
            if let written = InsightDate.short(insight.createdAt) {
                Text("Written \(written)")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func digestBody(_ digest: InsightDigest) -> some View {
        if let headline = digest.headline {
            MarkdownView(content: headline)
                .font(Theme.FontStyle.sans(18, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        if !digest.actions.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Suggested today")
                    .font(Theme.FontStyle.sans(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.fg3)
                    .padding(.top, 4)
                ForEach(Array(digest.actions.enumerated()), id: \.offset) { index, action in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text("\(index + 1)")
                            .font(Theme.FontStyle.mono(11, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg1)
                            .frame(width: 22, height: 22)
                            .overlay(Rectangle().strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1))
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 6 }
                            .accessibilityHidden(true)
                        MarkdownView(content: action)
                            .font(Theme.FontStyle.sans(15))
                            .foregroundStyle(Theme.Palette.fg1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.top, 2)
        } else if !digest.preview.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(digest.preview.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle()
                            .fill(Theme.Palette.ai)
                            .frame(width: 4, height: 4)
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] + 4 }
                        MarkdownView(content: line)
                            .font(Theme.FontStyle.sans(15))
                            .foregroundStyle(Theme.Palette.fg1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }
}

private struct StaleBadge: View {
    var body: some View {
        Text("STALE")
            .font(Theme.FontStyle.sans(11, weight: .semibold))
            .tracking(0.4)
            .foregroundStyle(Theme.Palette.warning)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Theme.Palette.warning.opacity(0.12), in: Capsule())
            .accessibilityLabel("Stale: newer data has arrived since this was written")
    }
}

enum InsightDate {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain = ISO8601DateFormatter()
    private static let sql: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()
    static func parse(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        if let d = fractional.date(from: raw) { return d }
        if let d = plain.date(from: raw) { return d }
        return sql.date(from: raw)
    }

    static func short(_ raw: String?) -> String? {
        guard let date = parse(raw) else { return nil }
        if Calendar.current.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

private struct InsightFullSheet: View {
    let insight: DashboardPayload.AIInsight
    var historical = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    meta
                    MarkdownView(content: insight.text ?? "")
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg1)
                        .lineSpacing(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .padding(.horizontal, Theme.Spacing.lg)
                .padding(.bottom, Theme.Spacing.xxl)
            }
            .background(Theme.Palette.bg1)
            .navigationTitle("Coach insight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var meta: some View {
        let written = InsightDate.parse(insight.createdAt)
        if written != nil || !insight.isCurrent || historical {
            HStack(spacing: 8) {
                if let written {
                    Text("Written \(written.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()))")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                if !insight.isCurrent || historical {
                    StaleBadge()
                }
            }
            if !insight.isCurrent || historical {
                Text("This is a previous analysis. Its measurements and suggestions may no longer describe today.")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
