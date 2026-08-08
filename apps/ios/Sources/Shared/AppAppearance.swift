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
        appearance.backgroundColor = UIColor.clear
        appearance.shadowColor = .clear

        let titleColor = UIColor(red: 244 / 255.0, green: 241 / 255.0, blue: 238 / 255.0, alpha: 1)
        let largeFont = UIFont(name: "Geist-SemiBold", size: 24) ?? UIFont.systemFont(ofSize: 24, weight: .semibold)
        let inlineFont = UIFont(name: "Geist-SemiBold", size: 17) ?? UIFont.systemFont(ofSize: 17, weight: .semibold)

        appearance.titleTextAttributes = [
            .foregroundColor: titleColor,
            .font: inlineFont,
        ]
        appearance.largeTitleTextAttributes = [
            .foregroundColor: titleColor,
            .font: largeFont,
            .kern: -0.48,
        ]

        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().tintColor = UIColor(red: 223 / 255.0, green: 104 / 255.0, blue: 98 / 255.0, alpha: 1)
    }

    private static func configureTabBar() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 18 / 255.0, green: 16 / 255.0, blue: 15 / 255.0, alpha: 1)
        appearance.shadowColor = UIColor(red: 50 / 255.0, green: 48 / 255.0, blue: 46 / 255.0, alpha: 1)

        let labelFont = UIFont(name: "Geist-Medium", size: 10) ?? UIFont.systemFont(ofSize: 10, weight: .medium)
        let inactiveColor = UIColor(red: 139 / 255.0, green: 137 / 255.0, blue: 133 / 255.0, alpha: 1)
        let activeColor = UIColor(red: 244 / 255.0, green: 241 / 255.0, blue: 238 / 255.0, alpha: 1)

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
        UITabBar.appearance().tintColor = activeColor
        UITabBar.appearance().unselectedItemTintColor = inactiveColor
    }

    private static func configureTable() {
        UITableView.appearance().backgroundColor = .clear
        UICollectionView.appearance().backgroundColor = .clear
    }
}
