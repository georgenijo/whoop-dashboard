import SwiftUI

struct StrainView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("Strain", systemImage: "bolt.fill",
                                   description: Text("Coming soon"))
            .navigationTitle("Strain")
        }
    }
}

#Preview {
    StrainView()
}
