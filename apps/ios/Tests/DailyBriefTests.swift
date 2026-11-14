import Foundation
import SwiftUI
import UIKit
import XCTest
@testable import Coach

final class DailyBriefTests: XCTestCase {
    func testWarehouseTypefaceIsRegisteredInTheAppBundle() {
        for name in [Theme.Typeface.sansRegular, Theme.Typeface.sansMedium,
                     Theme.Typeface.sansSemibold, Theme.Typeface.sansBold] {
            let font = UIFont(name: name, size: 17)
            XCTAssertNotNil(font, "Missing bundled font: \(name)")
            XCTAssertEqual(font?.familyName, "DM Sans")
        }
    }

    func testOnlyTodaysNonStaleAnalysisIsCurrent() {
        let today = ISO8601DateFormatter().string(from: Date())
        let yesterday = ISO8601DateFormatter().string(
            from: Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        )
        XCTAssertTrue(DashboardPayload.AIInsight(text: "Today", createdAt: today, isStale: false).isCurrent)
        XCTAssertFalse(DashboardPayload.AIInsight(text: "Old data", createdAt: today, isStale: true).isCurrent)
        XCTAssertFalse(DashboardPayload.AIInsight(text: "Yesterday", createdAt: yesterday, isStale: false).isCurrent)
        XCTAssertFalse(DashboardPayload.AIInsight(text: "Undated", createdAt: nil, isStale: false).isCurrent)
        XCTAssertFalse(DashboardPayload.AIInsight(text: "Invalid date", createdAt: "unknown", isStale: false).isCurrent)
    }

    func testNecessaryTextMeetsContrastInBothAppearances() {
        for appearance in [UIUserInterfaceStyle.light, .dark] {
            let traits = UITraitCollection(userInterfaceStyle: appearance)
            for foreground in [Theme.Palette.fg0, Theme.Palette.fg1, Theme.Palette.fg2, Theme.Palette.fg3, Theme.Palette.fg4] {
                for background in [Theme.Palette.bg0, Theme.Palette.bg2, Theme.Palette.bg4] {
                    let first = luminance(UIColor(foreground).resolvedColor(with: traits))
                    let second = luminance(UIColor(background).resolvedColor(with: traits))
                    XCTAssertGreaterThanOrEqual((max(first, second) + 0.05) / (min(first, second) + 0.05), 4.5)
                }
            }
        }
    }

    private func luminance(_ color: UIColor) -> Double {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        func linear(_ value: CGFloat) -> Double {
            let channel = Double(value)
            return channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }
}
