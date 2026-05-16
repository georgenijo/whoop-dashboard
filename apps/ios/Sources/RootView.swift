import SwiftUI

struct RootView: View {
    var onSignOut: () -> Void

    var body: some View {
        ZStack {
            AmbientAurora()

            TabView {
                DashboardView(onSignOut: onSignOut)
                    .tabItem {
                        Label("Dashboard", systemImage: "square.grid.2x2.fill")
                    }

                RecoveryView()
                    .tabItem {
                        Label("Recovery", systemImage: "waveform.path.ecg")
                    }

                SleepView()
                    .tabItem {
                        Label("Sleep", systemImage: "moon.fill")
                    }

                StrainView()
                    .tabItem {
                        Label("Strain", systemImage: "flame.fill")
                    }

                CoachView()
                    .tabItem {
                        Label("Coach", systemImage: "sparkles")
                    }
            }
            .tint(Theme.Palette.brandStrain)
        }
        .preferredColorScheme(.dark)
    }
}

#Preview {
    RootView(onSignOut: {})
}
