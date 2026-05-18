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
                .font(Theme.FontStyle.sans(28, weight: .bold))
                .foregroundStyle(Theme.Palette.fg0)
            Spacer()
            trailing()
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.top, 4)
        .padding(.bottom, 10)
    }
}

extension PageHeader where Trailing == EmptyView {
    init(_ title: String) {
        self.init(title, trailing: { EmptyView() })
    }
}
