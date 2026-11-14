import SwiftUI
import UIKit

enum AppAppearance {
    static func configure() {
        configureNavigationBar()
        configureTabBar()
        configureTable()
    }

    private static func configureNavigationBar() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithTransparentBackground()
        appearance.backgroundColor = UIColor.black.withAlphaComponent(0.0)
        appearance.shadowColor = .clear

        let titleColor = UIColor(Theme.Palette.fg0)
        let largeFont = UIFont(name: Theme.Typeface.sansMedium, size: 32) ?? UIFont.systemFont(ofSize: 32, weight: .medium)
        let inlineFont = UIFont(name: Theme.Typeface.sansMedium, size: 17) ?? UIFont.systemFont(ofSize: 17, weight: .medium)

        appearance.titleTextAttributes = [
            .foregroundColor: titleColor,
            .font: inlineFont,
        ]
        appearance.largeTitleTextAttributes = [
            .foregroundColor: titleColor,
            .font: largeFont,
            .kern: -0.96,
        ]

        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().tintColor = UIColor(Theme.Palette.accent)
    }

    private static func configureTabBar() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(Theme.Palette.bg0)
        appearance.shadowColor = UIColor(Theme.Palette.borderSubtle)

        let labelFont = UIFont(name: Theme.Typeface.sansMedium, size: 10) ?? UIFont.systemFont(ofSize: 10, weight: .medium)
        let inactiveColor = UIColor.secondaryLabel
        let activeColor = UIColor(Theme.Palette.accent)

        for state in [appearance.stackedLayoutAppearance, appearance.inlineLayoutAppearance, appearance.compactInlineLayoutAppearance] {
            state.normal.iconColor = inactiveColor
            state.normal.titleTextAttributes = [
                .foregroundColor: inactiveColor,
                .font: labelFont,
            ]
            state.selected.iconColor = activeColor
            state.selected.titleTextAttributes = [
                .foregroundColor: activeColor,
                .font: labelFont,
            ]
        }

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        UITabBar.appearance().tintColor = UIColor(Theme.Palette.accent)
        UITabBar.appearance().unselectedItemTintColor = inactiveColor
    }

    private static func configureTable() {
        UITableView.appearance().backgroundColor = .clear
        UICollectionView.appearance().backgroundColor = .clear
    }
}
