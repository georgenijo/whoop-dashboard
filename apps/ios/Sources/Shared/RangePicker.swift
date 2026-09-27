import SwiftUI

/// Full-width range control. Every segment is a 40pt-tall target (the old
/// header `Menu` was an 11pt label), and the selection slides rather than
/// snapping so the change is legible.
struct RangePicker: View {
    @Binding var selection: DateRange
    var options: [DateRange] = DateRange.allCases

    @Namespace private var namespace

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options) { range in
                let selected = range == selection
                Button {
                    withAnimation(.snappy(duration: 0.25)) { selection = range }
                } label: {
                    Text(range.label.uppercased())
                        .font(Theme.FontStyle.mono(13, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? Theme.Palette.fg0 : Theme.Palette.fg3)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background {
                            if selected {
                                Capsule()
                                    .fill(Theme.Palette.bg4)
                                    .overlay(Capsule().strokeBorder(Theme.Palette.borderStrong, lineWidth: 0.5))
                                    .matchedGeometryEffect(id: "selection", in: namespace)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(range.days) days")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Capsule().fill(Theme.Palette.bg2))
        .overlay(Capsule().strokeBorder(Theme.Palette.borderSubtle, lineWidth: 1))
        .sensoryFeedback(.selection, trigger: selection)
    }
}

#Preview {
    @Previewable @State var range: DateRange = .d30
    RangePicker(selection: $range)
        .padding()
        .background(Color.black)
        .preferredColorScheme(.dark)
}
