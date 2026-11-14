import Foundation

/// Foundation's AsyncBytes.lines omits empty lines. SSE needs those lines as
/// event boundaries, so frame the bytes directly without buffering the stream.
enum SSEFramingError: Error { case lineTooLong }

struct SSELineSequence<Base: AsyncSequence>: AsyncSequence where Base.Element == UInt8 {
    typealias Element = String
    let base: Base

    func makeAsyncIterator() -> AsyncIterator {
        AsyncIterator(base: base.makeAsyncIterator())
    }

    struct AsyncIterator: AsyncIteratorProtocol {
        var base: Base.AsyncIterator
        private var bytes: [UInt8] = []
        private var skipLF = false
        private var isFirstLine = true
        private var ended = false

        init(base: Base.AsyncIterator) { self.base = base }

        mutating func next() async throws -> String? {
            guard !ended else { return nil }
            while let byte = try await base.next() {
                if skipLF {
                    skipLF = false
                    if byte == 10 { continue }
                }
                if byte == 13 || byte == 10 {
                    skipLF = byte == 13
                    return takeLine()
                }
                // A malformed unbounded line must not exhaust app memory.
                guard bytes.count < 4 * 1024 * 1024 else { throw SSEFramingError.lineTooLong }
                bytes.append(byte)
            }
            ended = true
            return bytes.isEmpty ? nil : takeLine()
        }

        private mutating func takeLine() -> String {
            if isFirstLine {
                isFirstLine = false
                if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { bytes.removeFirst(3) }
            }
            let line = String(decoding: bytes, as: UTF8.self)
            bytes.removeAll(keepingCapacity: true)
            return line
        }
    }

}
