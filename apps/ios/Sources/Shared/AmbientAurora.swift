import SwiftUI

struct AmbientAurora: View {
    var intensity: Intensity = .signature

    enum Intensity {
        case stealth, signature, hot
    }

    var body: some View {
        Theme.Palette.bg
            .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
