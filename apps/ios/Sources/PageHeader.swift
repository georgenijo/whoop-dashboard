import SwiftUI

struct PageHeader<Trailing: View>: View {
    let title: String
    let trailing: () -> Trailing

    init(_ title: String, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.title = title
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(Theme.FontStyle.sans(24, weight: .semibold))
                .foregroundStyle(Theme.Palette.fgHi)
            Spacer()
            trailing()
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.top, Theme.Spacing.xs)
        .padding(.bottom, Theme.Spacing.sm)
    }
}

extension PageHeader where Trailing == EmptyView {
    init(_ title: String) {
        self.init(title, trailing: { EmptyView() })
    }
}
