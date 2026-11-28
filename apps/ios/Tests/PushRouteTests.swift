import XCTest
@testable import Coach

final class PushRouteTests: XCTestCase {
    func testReauthPayloadParsesToWhoopReconnect() {
        // Mirrors buildReauthPushPayload() in apps/web/src/lib/whoop/reauth-push.ts.
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Coach", "body": "Whoop disconnected — tap to reconnect."]],
            "route": "settings/connectors",
            "reason": "whoop_needs_reauth",
        ]
        XCTAssertEqual(PushRoute(userInfo: userInfo), .whoopReconnect)
    }

    func testMissingOrUnknownRouteParsesToNil() {
        XCTAssertNil(PushRoute(userInfo: ["aps": ["alert": "hi"]]))
        XCTAssertNil(PushRoute(userInfo: ["route": "somewhere/else"]))
        XCTAssertNil(PushRoute(userInfo: ["route": 42]))
    }

    @MainActor
    func testRouterHoldsRouteUntilConsumedOnce() {
        let router = PushRouter()
        XCTAssertNil(router.consume())
        let posted = expectation(forNotification: .pushRouteRequested, object: nil)
        router.handle(.whoopReconnect)
        wait(for: [posted], timeout: 1)
        XCTAssertEqual(router.consume(), .whoopReconnect)
        XCTAssertNil(router.consume())
    }
}
