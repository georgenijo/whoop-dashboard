import AuthenticationServices
import SwiftUI

struct AuthView: View {
    var onSignedIn: () -> Void

    @Environment(\.api) private var api

    @State private var errorMessage: String?
    @State private var isExchanging = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            VStack(spacing: 8) {
                Text("Coach")
                    .font(.largeTitle)
                    .bold()
                Text("Your personal life intelligence")
                    .foregroundStyle(.secondary)
            }
            Spacer()

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = [.email]
            } onCompletion: { result in
                handle(result)
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 50)
            .padding(.horizontal)
            .disabled(isExchanging)

            if isExchanging {
                ProgressView()
            }
        }
        .padding(.bottom, 40)
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
                body: ["identity_token": identityToken]
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
