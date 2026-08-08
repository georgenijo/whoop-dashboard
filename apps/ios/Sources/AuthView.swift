import AuthenticationServices
import SwiftUI

struct AuthView: View {
    var onSignedIn: () -> Void

    @Environment(\.api) private var api

    @State private var errorMessage: String?
    @State private var isExchanging = false

    var body: some View {
        ZStack {
            Theme.Palette.bg
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                Spacer()

                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    Text("COACH")
                        .font(Theme.FontStyle.sans(11, weight: .semibold))
                        .tracking(1.8)
                        .foregroundStyle(Theme.Palette.brand)
                    Text("Your health,\nmade legible.")
                        .font(Theme.FontStyle.sans(40, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fgHi)
                    Text("Recovery, sleep, strain, and a coach that understands the whole picture.")
                        .font(Theme.FontStyle.sans(15))
                        .foregroundStyle(Theme.Palette.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                if let errorMessage {
                    Text(errorMessage)
                        .font(Theme.FontStyle.sans(12))
                        .foregroundStyle(Theme.Palette.bad)
                        .multilineTextAlignment(.leading)
                }

                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.email]
                } onCompletion: { result in
                    handle(result)
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 50)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                .disabled(isExchanging)

                if isExchanging {
                    ProgressView()
                        .tint(Theme.Palette.fg2)
                }
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.bottom, Theme.Spacing.xl)
        }
    }

    private func handle(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let error):
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                return
            }
            errorMessage = "Sign-in failed: \(error.localizedDescription)"
        case .success(let auth):
            guard
                let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let token = String(data: tokenData, encoding: .utf8)
            else {
                errorMessage = "No identity token returned by Apple"
                return
            }
            Task { await exchange(identityToken: token) }
        }
    }

    @MainActor
    private func exchange(identityToken: String) async {
        isExchanging = true
        errorMessage = nil
        defer { isExchanging = false }

        do {
            let response: AuthResponse = try await api.post(
                "/api/auth/apple",
                body: [
                    "identity_token": identityToken,
                    "tz": TimeZone.current.identifier,
                ]
            )
            guard KeychainStore.saveSessionToken(response.sessionToken) else {
                errorMessage = "Could not save session"
                return
            }
            KeychainStore.saveSessionExpiresAt(response.expiresAt)
            onSignedIn()
        } catch APIError.unauthorized {
            errorMessage = "Apple token rejected by server"
        } catch APIError.serverError(let code) {
            errorMessage = "Server error (\(code))"
        } catch APIError.network(let err) {
            errorMessage = "Network error: \(err.localizedDescription)"
        } catch APIError.decode {
            errorMessage = "Bad response from server"
        } catch APIError.badResponse {
            errorMessage = "Bad response from server"
        } catch {
            errorMessage = "Unexpected error"
        }
    }

    private struct AuthResponse: Decodable {
        let sessionToken: String
        let expiresAt: Date

        enum CodingKeys: String, CodingKey {
            case sessionToken = "session_token"
            case expiresAt = "expires_at"
        }
    }
}

#Preview {
    AuthView(onSignedIn: {})
}
