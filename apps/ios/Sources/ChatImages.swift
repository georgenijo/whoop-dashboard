import Foundation
import ImageIO
import UIKit

struct PendingChatImage: Identifiable, Hashable {
    let id: UUID
    let jpegData: Data
    let width: Int
    let height: Int

    var image: UIImage? {
        UIImage(data: jpegData)
    }
}

struct ChatDraft: Equatable {
    var text: String
    var images: [PendingChatImage]
}

enum ChatComposerRules {
    static func canSend(
        text: String,
        imageCount: Int,
        isSending: Bool,
        isRecovering: Bool,
        isPreparingImages: Bool
    ) -> Bool {
        !isSending
            && !isRecovering
            && !isPreparingImages
            && (
                !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || imageCount > 0
            )
    }

    static func restoring(_ sent: ChatDraft, over current: ChatDraft) -> ChatDraft {
        ChatDraft(
            text: current.text.isEmpty ? sent.text : current.text,
            images: current.images.isEmpty ? sent.images : current.images
        )
    }
}

enum ChatImageProcessingError: LocalizedError, Equatable {
    case sourceTooLarge
    case invalidImage
    case animatedImage
    case decodedImageTooLarge
    case encodingFailed
    case outputTooLarge

    var errorDescription: String? {
        switch self {
        case .sourceTooLarge:
            return "That photo is too large to prepare."
        case .invalidImage:
            return "That photo could not be read."
        case .animatedImage:
            return "Animated images aren’t supported."
        case .decodedImageTooLarge:
            return "That photo has too many pixels to prepare safely."
        case .encodingFailed:
            return "That photo could not be converted to JPEG."
        case .outputTooLarge:
            return "The prepared photo is larger than 8 MB."
        }
    }
}

enum ChatImageNormalizer {
    static let maximumSourceBytes = 50 * 1024 * 1024
    static let maximumDecodedPixels = 25_000_000
    static let maximumLongestEdge = 1_600
    static let maximumOutputBytes = 8 * 1024 * 1024
    static let jpegQuality: CGFloat = 0.85

    static func normalize(_ data: Data, id: UUID = UUID()) throws -> PendingChatImage {
        guard data.count <= maximumSourceBytes else {
            throw ChatImageProcessingError.sourceTooLarge
        }
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            CGImageSourceGetCount(source) > 0
        else {
            throw ChatImageProcessingError.invalidImage
        }
        guard CGImageSourceGetCount(source) == 1 else {
            throw ChatImageProcessingError.animatedImage
        }

        if
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
                as? [CFString: Any],
            let pixelWidth = properties[kCGImagePropertyPixelWidth] as? NSNumber,
            let pixelHeight = properties[kCGImagePropertyPixelHeight] as? NSNumber,
            pixelWidth.intValue * pixelHeight.intValue > maximumDecodedPixels
        {
            throw ChatImageProcessingError.decodedImageTooLarge
        }

        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumLongestEdge,
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            options as CFDictionary
        ) else {
            throw ChatImageProcessingError.invalidImage
        }

        let size = CGSize(width: thumbnail.width, height: thumbnail.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIImage(cgImage: thumbnail).draw(in: CGRect(origin: .zero, size: size))
        }
        guard let jpegData = rendered.jpegData(compressionQuality: jpegQuality) else {
            throw ChatImageProcessingError.encodingFailed
        }
        guard jpegData.count <= maximumOutputBytes else {
            throw ChatImageProcessingError.outputTooLarge
        }
        return PendingChatImage(
            id: id,
            jpegData: jpegData,
            width: thumbnail.width,
            height: thumbnail.height
        )
    }
}

final class ChatAttachmentCache: @unchecked Sendable {
    private let cache = NSCache<NSString, NSData>()

    init() {
        cache.countLimit = 24
        cache.totalCostLimit = 32 * 1024 * 1024
    }

    func data(for attachment: ChatAttachment, api: APIClient) async throws -> Data {
        if let cached = cache.object(forKey: attachment.id as NSString) {
            return cached as Data
        }
        let data = try await api.getData(attachment.url)
        cache.setObject(
            data as NSData,
            forKey: attachment.id as NSString,
            cost: data.count
        )
        return data
    }

    func removeAll() {
        cache.removeAllObjects()
    }
}
