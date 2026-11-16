import XCTest
@testable import Coach

final class VoiceDictationTests: XCTestCase {
    func testLevelClampsToUnitRange() {
        XCTAssertEqual(DictationMath.level(fromDecibels: -120), 0)
        XCTAssertEqual(DictationMath.level(fromDecibels: -50), 0)
        XCTAssertEqual(DictationMath.level(fromDecibels: -25), 0.5, accuracy: 0.001)
        XCTAssertEqual(DictationMath.level(fromDecibels: 0), 1)
        XCTAssertEqual(DictationMath.level(fromDecibels: 20), 1)
        XCTAssertEqual(DictationMath.level(fromDecibels: -.infinity), 0)
        XCTAssertEqual(DictationMath.level(fromDecibels: .nan), 0)
    }

    func testRMSLevelOfSilenceAndFullScale() {
        XCTAssertEqual(DictationMath.level(fromRMS: 0), 0)
        XCTAssertEqual(DictationMath.level(fromRMS: 1), 1, accuracy: 0.001)
        let samples: [Float] = [0.5, -0.5, 0.5, -0.5]
        let rms = samples.withUnsafeBufferPointer { DictationMath.rms($0) }
        XCTAssertEqual(rms, 0.5, accuracy: 0.0001)
    }

    func testElapsedFormatting() {
        XCTAssertEqual(DictationMath.formatElapsed(0), "0:00")
        XCTAssertEqual(DictationMath.formatElapsed(5.9), "0:05")
        XCTAssertEqual(DictationMath.formatElapsed(65), "1:05")
        XCTAssertEqual(DictationMath.formatElapsed(-3), "0:00")
        XCTAssertEqual(DictationMath.spokenElapsed(65), "1 minute 5 seconds")
        XCTAssertEqual(DictationMath.spokenElapsed(1), "1 second")
    }

    func testTranscriptMerge() {
        XCTAssertEqual(ChatComposerRules.appendingTranscript("hello there", to: ""), "hello there")
        XCTAssertEqual(ChatComposerRules.appendingTranscript("there", to: "hello "), "hello there")
        XCTAssertEqual(ChatComposerRules.appendingTranscript("there", to: "hello\n"), "hello\nthere")
        XCTAssertEqual(ChatComposerRules.appendingTranscript("there", to: "hello"), "hello there")
        XCTAssertEqual(ChatComposerRules.appendingTranscript("", to: "hello"), "hello")
        XCTAssertEqual(ChatComposerRules.appendingTranscript("  \n ", to: "hello"), "hello")
        XCTAssertEqual(ChatComposerRules.appendingTranscript("  ", to: ""), "")
    }

    func testBarCountFitsWidth() {
        XCTAssertEqual(DictationMath.barCount(forWidth: 0, barWidth: 2.5, spacing: 3), 1)
        XCTAssertEqual(DictationMath.barCount(forWidth: 2.5, barWidth: 2.5, spacing: 3), 1)
        XCTAssertEqual(DictationMath.barCount(forWidth: 8, barWidth: 2.5, spacing: 3), 2)
        let count = DictationMath.barCount(forWidth: 100, barWidth: 2.5, spacing: 3)
        XCTAssertLessThanOrEqual(CGFloat(count) * 2.5 + CGFloat(count - 1) * 3, 100)
        XCTAssertEqual(DictationMath.barCount(forWidth: .nan, barWidth: 2.5, spacing: 3), 1)
    }

    @MainActor
    func testFinishWithoutRecordingIsNotOwned() async {
        let dictation = VoiceDictation()
        let result = await dictation.finish()
        XCTAssertNil(result)
        dictation.cancel()
        XCTAssertEqual(dictation.state, .idle)
    }

    func testRingBufferKeepsFixedLength() {
        var ring = LevelRingBuffer(capacity: 4)
        XCTAssertEqual(ring.values, [0, 0, 0, 0])
        for value in 1...10 { ring.append(Float(value) / 10) }
        XCTAssertEqual(ring.values.count, 4)
        XCTAssertEqual(ring.values, [0.7, 0.8, 0.9, 1.0])
        ring.append(5)
        ring.append(.nan)
        XCTAssertEqual(Array(ring.values.suffix(2)), [1, 0])
        ring.reset()
        XCTAssertEqual(ring.values, [0, 0, 0, 0])
    }
}
