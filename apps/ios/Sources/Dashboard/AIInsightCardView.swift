import SwiftUI

struct AIInsightCardView: View {
    let insight: DashboardPayload.AIInsight

    @State private var showFull = false

    private var digest: InsightDigest? {
        insight.text.map(InsightDigest.init(markdown:))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            header

            if let digest, !digest.isEmpty {
                digestBody(digest)
            } else if let text = insight.text, !text.isEmpty {
                MarkdownView(content: text)
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg1)
                    .lineLimit(4)
            } else {
                Text("No insight yet. One is written after your next sync.")
                    .font(Theme.FontStyle.sans(15))
                    .foregroundStyle(Theme.Palette.fg2)
            }

            if let text = insight.text, !text.isEmpty {
                Divider().overlay(Theme.Palette.borderSubtle)
                Button { showFull = true } label: {
                    HStack {
                        Text("Read full analysis")
                            .font(Theme.FontStyle.sans(15, weight: .medium))
                            .foregroundStyle(Theme.Palette.fg0)
                        Spacer()
                        if let count = digest?.sectionCount, count > 0 {
                            Text("\(count) sections")
                                .font(Theme.FontStyle.mono(11))
                                .foregroundStyle(Theme.Palette.fg3)
                        }
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.Palette.fg3)
                    }
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the full coach analysis")
            }
        }
        .glassCard(tint: .ai, padding: Theme.Spacing.md)
        .sheet(isPresented: $showFull) {
            InsightFullSheet(insight: insight)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 6) {
            Image(systemName: "sparkle")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.Palette.ai)
            Text("COACH INSIGHT")
                .font(Theme.FontStyle.sans(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.Palette.fg2)
            Spacer(minLength: 8)
            if let written = InsightDate.short(insight.createdAt) {
                Text(written)
                    .font(Theme.FontStyle.mono(11))
                    .foregroundStyle(Theme.Palette.fg3)
            }
            if insight.isStale {
                StaleBadge()
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
                Text("DO THIS")
                    .font(Theme.FontStyle.sans(11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.Palette.fg3)
                ForEach(Array(digest.actions.enumerated()), id: \.offset) { index, action in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(index + 1)")
                            .font(Theme.FontStyle.mono(11, weight: .medium))
                            .foregroundStyle(Theme.Palette.ai)
                            .frame(width: 18, height: 18)
                            .background(Theme.Palette.ai.opacity(0.14), in: Circle())
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 5 }
                        MarkdownView(content: action)
                            .font(Theme.FontStyle.sans(15))
                            .foregroundStyle(Theme.Palette.fg1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.top, 2)
        }
    }
}

private struct StaleBadge: View {
    var body: some View {
        Text("STALE")
            .font(Theme.FontStyle.sans(11, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.Palette.warning)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Theme.Palette.warning.opacity(0.12), in: Capsule())
            .accessibilityLabel("Stale: newer data has arrived since this was written")
    }
}

enum InsightDate {
    static func parse(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let frac = ISO8601DateFormatter()
        frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = frac.date(from: raw) { return d }
        let plain = ISO8601DateFormatter()
        if let d = plain.date(from: raw) { return d }
        let sql = DateFormatter()
        sql.locale = Locale(identifier: "en_US_POSIX")
        sql.timeZone = TimeZone(identifier: "UTC")
        sql.dateFormat = "yyyy-MM-dd HH:mm:ss"
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
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private var meta: some View {
        let written = InsightDate.parse(insight.createdAt)
        if written != nil || insight.isStale {
            HStack(spacing: 8) {
                if let written {
                    Text("Written \(written.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()))")
                        .font(Theme.FontStyle.mono(11))
                        .foregroundStyle(Theme.Palette.fg3)
                }
                if insight.isStale {
                    StaleBadge()
                }
            }
            if insight.isStale {
                Text("Newer Whoop data has arrived since this was written, so some numbers may be out of date.")
                    .font(Theme.FontStyle.sans(13))
                    .foregroundStyle(Theme.Palette.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
