import AuthenticationServices
import SwiftUI

struct AuthView: View {
    var onSignedIn: () -> Void

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

    private func exchange(identityToken: String) async {
        await MainActor.run {
            isExchanging = true
            errorMessage = nil
        }

        defer {
            Task { @MainActor in isExchanging = false }
        }

        guard let url = URL(string: "https://coach-api.georgenijo.com/api/auth/apple") else {
            await MainActor.run { errorMessage = "Invalid API URL" }
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["identity_token": identityToken])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                await MainActor.run { errorMessage = "Bad response from server" }
                return
            }

            switch http.statusCode {
            case 200:
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .custom { dec in
                    let container = try dec.singleValueContainer()
                    let raw = try container.decode(String.self)
                    let withFractional = ISO8601DateFormatter()
                    withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    if let date = withFractional.date(from: raw) { return date }
                    let plain = ISO8601DateFormatter()
                    plain.formatOptions = [.withInternetDateTime]
                    if let date = plain.date(from: raw) { return date }
                    throw DecodingError.dataCorruptedError(
                        in: container,
                        debugDescription: "Expected ISO 8601 date, got \(raw)"
                    )
                }
                let decoded = try decoder.decode(AuthResponse.self, from: data)
                guard KeychainStore.saveSessionToken(decoded.sessionToken) else {
                    await MainActor.run { errorMessage = "Could not save session" }
                    return
                }
                KeychainStore.saveSessionExpiresAt(decoded.expiresAt)
                await MainActor.run { onSignedIn() }
            case 401:
                await MainActor.run { errorMessage = "Apple token rejected by server" }
            default:
                let code = http.statusCode
                await MainActor.run { errorMessage = "Server error (\(code))" }
            }
        } catch {
            let message = error.localizedDescription
            await MainActor.run { errorMessage = "Network error: \(message)" }
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
