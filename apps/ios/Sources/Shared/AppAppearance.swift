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

        let titleColor = UIColor.white
        let largeFont = UIFont(name: "Geist-SemiBold", size: 32) ?? UIFont.systemFont(ofSize: 32, weight: .semibold)
        let inlineFont = UIFont(name: "Geist-SemiBold", size: 17) ?? UIFont.systemFont(ofSize: 17, weight: .semibold)

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
        UINavigationBar.appearance().tintColor = UIColor(red: 1.0, green: 0.0, blue: 0.27, alpha: 1.0)
    }

    private static func configureTabBar() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor.black
        appearance.shadowColor = UIColor.white.withAlphaComponent(0.06)

        let labelFont = UIFont(name: "Geist-Medium", size: 10) ?? UIFont.systemFont(ofSize: 10, weight: .medium)
        let inactiveColor = UIColor(red: 107 / 255.0, green: 107 / 255.0, blue: 116 / 255.0, alpha: 1.0)
        let activeColor = UIColor.white

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
        UITabBar.appearance().tintColor = UIColor(red: 1.0, green: 0.0, blue: 0.27, alpha: 1.0)
        UITabBar.appearance().unselectedItemTintColor = inactiveColor
    }

    private static func configureTable() {
        UITableView.appearance().backgroundColor = .clear
        UICollectionView.appearance().backgroundColor = .clear
    }
}
