import SwiftUI

/// Warehouse-style text ranges with native-sized touch targets.
struct RangePicker: View {
    @Binding var selection: DateRange
    var options: [DateRange] = DateRange.allCases

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options) { range in
                let selected = range == selection
                Button {
                    selection = range
                } label: {
                    Text(range.label.uppercased())
                        .font(Theme.FontStyle.mono(13, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? Theme.Palette.accent : Theme.Palette.fg3)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .overlay(alignment: .bottom) {
                            if selected {
                                Rectangle()
                                    .fill(Theme.Palette.accent)
                                    .frame(height: 2)
                                    .padding(.horizontal, 8)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(range.days) days")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
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
