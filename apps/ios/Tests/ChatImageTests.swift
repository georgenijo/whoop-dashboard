import Foundation
import ImageIO
import UniformTypeIdentifiers
import UIKit
import XCTest
@testable import Coach

final class ChatImageTests: XCTestCase {
    func testMultipartEncodingUsesCRLFAndPreservesBinaryBytes() {
        let boundary = "Boundary-123"
        let binary = Data([0x00, 0x0A, 0xFF, 0x22])
        let body = MultipartFormData.encode(
            fields: [
                "message": "Look at this",
                "thread_id": "42",
            ],
            files: [
                MultipartFile(
                    filename: "image.jpg",
                    mimeType: "image/jpeg",
                    data: binary
                )
            ],
            boundary: boundary
        )
        let text = String(decoding: body, as: UTF8.self)

        XCTAssertEqual(
            MultipartFormData.contentType(boundary: boundary),
            "multipart/form-data; boundary=Boundary-123"
        )
        XCTAssertTrue(text.contains("--Boundary-123\r\n"))
        XCTAssertTrue(
            text.contains(
                "Content-Disposition: form-data; name=\"images\"; "
                    + "filename=\"image.jpg\"\r\n"
            )
        )
        XCTAssertTrue(text.contains("Content-Type: image/jpeg\r\n\r\n"))
        XCTAssertNotNil(body.range(of: binary))
        XCTAssertTrue(body.suffix("--Boundary-123--\r\n".utf8.count)
            .elementsEqual("--Boundary-123--\r\n".utf8))
    }

    func testMultipartHeaderValuesCannotInjectNewLines() {
        let body = MultipartFormData.encode(
            fields: [:],
            files: [
                MultipartFile(
                    fieldName: "ima\r\nges",
                    filename: "bad\"\r\nInjected: yes.jpg",
                    mimeType: "image/jpeg\r\nInjected: yes",
                    data: Data([1])
                )
            ],
            boundary: "safe"
        )
        let text = String(decoding: body, as: UTF8.self)

        XCTAssertFalse(text.contains("\r\nInjected: yes"))
        XCTAssertTrue(text.contains("filename=\"bad\\\"Injected: yes.jpg\""))
    }

    @MainActor
    func testNormalizationAppliesOrientationStripsMetadataAndCapsDimensions() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let rendered = UIGraphicsImageRenderer(
            size: CGSize(width: 2_400, height: 1_200),
            format: format
        ).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1_200, height: 1_200))
            UIColor.blue.setFill()
            context.fill(CGRect(x: 1_200, y: 0, width: 1_200, height: 1_200))
        }
        let orientedData = try makeJPEG(
            from: XCTUnwrap(rendered.cgImage),
            orientation: 6,
            gps: [
                kCGImagePropertyGPSLatitude: 40.0,
                kCGImagePropertyGPSLongitude: -74.0,
            ]
        )

        let normalized = try ChatImageNormalizer.normalize(orientedData)

        XCTAssertEqual(normalized.width, 800)
        XCTAssertEqual(normalized.height, 1_600)
        XCTAssertLessThanOrEqual(
            max(normalized.width, normalized.height),
            ChatImageNormalizer.maximumLongestEdge
        )
        XCTAssertLessThanOrEqual(
            normalized.jpegData.count,
            ChatImageNormalizer.maximumOutputBytes
        )
        XCTAssertEqual(Array(normalized.jpegData.prefix(2)), [0xFF, 0xD8])

        let outputSource = try XCTUnwrap(
            CGImageSourceCreateWithData(normalized.jpegData as CFData, nil)
        )
        let properties = try XCTUnwrap(
            CGImageSourceCopyPropertiesAtIndex(outputSource, 0, nil)
                as? [CFString: Any]
        )
        XCTAssertNil(properties[kCGImagePropertyGPSDictionary])
        let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue
        XCTAssertTrue(orientation == nil || orientation == 1)
    }

    func testAttachmentDTODecodesAndOlderMessagesDefaultToNoAttachments() throws {
        let decoder = JSONDecoder()
        let message = try decoder.decode(
            ChatMessage.self,
            from: Data(
                """
                {
                  "id": 9,
                  "role": "user",
                  "content": "",
                  "created_at": 0,
                  "attachments": [{
                    "id": "attachment-1",
                    "url": "/api/chat/attachments/attachment-1",
                    "mime_type": "image/jpeg",
                    "width": 800,
                    "height": 600,
                    "size_bytes": 1234
                  }]
                }
                """.utf8
            )
        )
        let legacy = try decoder.decode(
            ChatMessage.self,
            from: Data(
                """
                {
                  "id": 10,
                  "role": "assistant",
                  "content": "Ready",
                  "created_at": 0
                }
                """.utf8
            )
        )

        XCTAssertEqual(message.attachments.first?.id, "attachment-1")
        XCTAssertEqual(message.attachments.first?.mimeType, "image/jpeg")
        XCTAssertEqual(message.attachments.first?.sizeBytes, 1_234)
        XCTAssertTrue(legacy.attachments.isEmpty)
    }

    func testImageOnlyCanSendAndFailedDraftRestoration() {
        XCTAssertTrue(
            ChatComposerRules.canSend(
                text: "   ",
                imageCount: 1,
                isSending: false,
                isRecovering: false,
                isPreparingImages: false
            )
        )
        XCTAssertFalse(
            ChatComposerRules.canSend(
                text: "",
                imageCount: 0,
                isSending: false,
                isRecovering: false,
                isPreparingImages: false
            )
        )

        let image = PendingChatImage(
            id: UUID(),
            jpegData: Data([0xFF, 0xD8, 0xFF, 0xD9]),
            width: 1,
            height: 1
        )
        let sent = ChatDraft(text: "Keep this", images: [image])
        XCTAssertEqual(
            ChatComposerRules.restoring(
                sent,
                over: ChatDraft(text: "", images: [])
            ),
            sent
        )
    }

    func testAuthenticatedAttachmentLoadingUsesCache() async throws {
        setenv("COACH_DEBUG_TOKEN", "attachment-test-token", 1)
        defer { unsetenv("COACH_DEBUG_TOKEN") }
        AttachmentURLProtocol.reset()

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AttachmentURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let api = APIClient(
            baseURL: URL(string: "https://coach-api.example")!,
            session: session
        )
        let attachment = ChatAttachment(
            id: "cached-image",
            url: "/api/chat/attachments/cached-image",
            mimeType: "image/jpeg",
            width: 10,
            height: 10,
            sizeBytes: 4
        )
        let cache = ChatAttachmentCache()

        let first = try await cache.data(for: attachment, api: api)
        let second = try await cache.data(for: attachment, api: api)

        XCTAssertEqual(first, AttachmentURLProtocol.payload)
        XCTAssertEqual(second, first)
        XCTAssertEqual(AttachmentURLProtocol.requestCount, 1)
        XCTAssertEqual(
            AttachmentURLProtocol.authorization,
            "Bearer attachment-test-token"
        )
    }

    private func makeJPEG(
        from image: CGImage,
        orientation: Int,
        gps: [CFString: Any]
    ) throws -> Data {
        let data = NSMutableData()
        let destination = try XCTUnwrap(
            CGImageDestinationCreateWithData(
                data,
                UTType.jpeg.identifier as CFString,
                1,
                nil
            )
        )
        CGImageDestinationAddImage(
            destination,
            image,
            [
                kCGImagePropertyOrientation: orientation,
                kCGImagePropertyGPSDictionary: gps,
            ] as CFDictionary
        )
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return data as Data
    }
}

private final class AttachmentURLProtocol: URLProtocol {
    static let payload = Data([0xFF, 0xD8, 0xFF, 0xD9])
    private static let lock = NSLock()
    private static var _requestCount = 0
    private static var _authorization: String?

    static var requestCount: Int {
        lock.withLock { _requestCount }
    }

    static var authorization: String? {
        lock.withLock { _authorization }
    }

    static func reset() {
        lock.withLock {
            _requestCount = 0
            _authorization = nil
        }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        Self.lock.withLock {
            Self._requestCount += 1
            Self._authorization = request.value(forHTTPHeaderField: "Authorization")
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "image/jpeg"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.payload)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
