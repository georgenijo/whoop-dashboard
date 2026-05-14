import AuthenticationServices
import Foundation
import UIKit

enum OAuthSessionError: Error {
    case canceled
    case failed(String)
}

/// Wraps `ASWebAuthenticationSession` so callers can `await` a single OAuth
/// round-trip. Uses ephemeral browser data so the in-app sheet doesn't
/// reuse a stale Whoop session — every reconnect starts cold.
final class OAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func start(authorizeURL: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(
                url: authorizeURL,
                callbackURLScheme: callbackScheme
            ) { url, error in
                if let error {
                    if let authError = error as? ASWebAuthenticationSessionError,
                       authError.code == .canceledLogin {
                        cont.resume(throwing: OAuthSessionError.canceled)
                    } else {
                        cont.resume(throwing: OAuthSessionError.failed(error.localizedDescription))
                    }
                    return
                }
                guard let url else {
                    cont.resume(throwing: OAuthSessionError.failed("Empty callback URL"))
                    return
                }
                cont.resume(returning: url)
            }
            session.prefersEphemeralWebBrowserSession = true
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                cont.resume(throwing: OAuthSessionError.failed("Couldn't start auth session"))
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
