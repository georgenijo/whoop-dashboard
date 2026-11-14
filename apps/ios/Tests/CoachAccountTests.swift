import XCTest
@testable import Coach

final class CoachAccountTests: XCTestCase {
    func testInstructionsUseOnlyCustomInstructionField() throws {
        let encoded = try JSONEncoder().encode(InstructionSettings(systemPrompt: "Prefer morning training."))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: String])
        XCTAssertEqual(object, ["system_prompt": "Prefer morning training."])
    }

    func testProviderStatusRequiresOnlyMaskedInformation() throws {
        let state = try JSONDecoder().decode(ProviderKeyState.self, from: Data("""
        {"present":true,"masked":"sk-ant-…1234","fallback_available":false}
        """.utf8))
        XCTAssertTrue(state.present)
        XCTAssertEqual(state.masked, "sk-ant-…1234")
        XCTAssertFalse(state.fallbackAvailable)
    }

    func testThreadDeletionAcceptsNoContentResponse() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ThreadDeleteProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let api = APIClient(baseURL: URL(string: "https://coach-test.invalid")!, session: session)
        let _: APIEmptyResponse = try await api.delete("/api/threads/42")
    }
}

private final class ThreadDeleteProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.httpMethod == "DELETE", request.url?.path == "/api/threads/42" else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
