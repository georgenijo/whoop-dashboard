import SwiftUI

struct RangeSelectorView: View {
    @Binding var selection: DateRange

    var body: some View {
        Picker("Range", selection: $selection) {
            ForEach(DateRange.allCases) { range in
                Text(range.label).tag(range)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal)
    }
}

#Preview {
    struct Wrapper: View {
        @State var range: DateRange = .d30
        var body: some View {
            VStack {
                RangeSelectorView(selection: $range)
                Text("Selected: \(range.label) (\(range.days) days)")
                    .font(.caption)
            }
            .padding()
        }
    }
    return Wrapper()
}
