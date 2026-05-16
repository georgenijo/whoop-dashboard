import SwiftUI

struct AmbientAurora: View {
    var intensity: Intensity = .signature

    enum Intensity {
        case stealth, signature, hot
    }

    var body: some View {
        ZStack {
            Theme.Palette.bg0
                .ignoresSafeArea()

            if intensity != .stealth {
                aurora
                    .ignoresSafeArea()
            }
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var aurora: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            ZStack {
                Circle()
                    .fill(Color(hex: "#ff0043"))
                    .frame(width: redSize(w), height: redSize(w))
                    .position(x: w * 0.05, y: -h * 0.05)
                    .blur(radius: 70)
                    .opacity(redOpacity)

                Circle()
                    .fill(Color(hex: "#7b61ff"))
                    .frame(width: violetSize(w), height: violetSize(w))
                    .position(x: w * 0.95, y: h * 1.05)
                    .blur(radius: 70)
                    .opacity(violetOpacity)
            }
        }
    }

    private func redSize(_ w: CGFloat) -> CGFloat {
        switch intensity {
        case .stealth: return 0
        case .signature: return max(w * 0.7, 280)
        case .hot: return max(w * 1.0, 380)
        }
    }

    private func violetSize(_ w: CGFloat) -> CGFloat {
        switch intensity {
        case .stealth: return 0
        case .signature: return max(w * 0.82, 320)
        case .hot: return max(w * 1.07, 420)
        }
    }

    private var redOpacity: Double {
        switch intensity {
        case .stealth: return 0
        case .signature: return 0.32
        case .hot: return 0.55
        }
    }

    private var violetOpacity: Double {
        switch intensity {
        case .stealth: return 0
        case .signature: return 0.28
        case .hot: return 0.5
        }
    }
}
