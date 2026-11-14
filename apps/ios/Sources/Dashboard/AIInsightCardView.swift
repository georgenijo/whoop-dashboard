import SwiftUI

struct AIInsightCardView: View {
    let insight: DashboardPayload.AIInsight
    var historical = false
    private var isCurrent: Bool { insight.isCurrent && !historical }

    @State private var showFull = false

    private var digest: InsightDigest? {
        insight.text.map(InsightDigest.init(markdown:))
    }

    var body: some View {
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

            if let text = insight.text, !text.isEmpty {
                Divider().overlay(Theme.Palette.borderSubtle)
                Button { showFull = true } label: {
                    HStack {
                        Text(isCurrent ? "Read full analysis" : "Read previous analysis")
                            .font(Theme.FontStyle.sans(15, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the full coach analysis")
            }
        }
        .glassCard(tint: .ai, padding: Theme.Spacing.md)
        .sheet(isPresented: $showFull) {
            InsightFullSheet(insight: insight, historical: historical)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 6) {
            Text(isCurrent ? "Daily brief" : "Previous analysis")
                .font(Theme.FontStyle.sans(11, weight: .semibold))
                .tracking(0)
                .foregroundStyle(Theme.Palette.fg2)
            Spacer(minLength: 8)
            if let written = InsightDate.short(insight.createdAt) {
                Text(written)
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }

        }
    }

    @ViewBuilder
    private func digestBody(_ digest: InsightDigest) -> some View {
        if let headline = digest.headline {
            MarkdownView(content: headline)
                .font(Theme.FontStyle.sans(17, weight: .medium))
                .foregroundStyle(Theme.Palette.fg0)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        if !digest.actions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Suggested today")
                    .font(Theme.FontStyle.sans(11, weight: .semibold))
                    .tracking(0)
                    .foregroundStyle(Theme.Palette.fg3)
                ForEach(Array(digest.actions.enumerated()), id: \.offset) { index, action in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(index + 1)")
                            .font(Theme.FontStyle.mono(11, weight: .medium))
                            .foregroundStyle(Theme.Palette.accent)
                            .frame(width: 18, height: 18)
                            .background(Theme.Palette.bg2, in: Rectangle())
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 5 }
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
