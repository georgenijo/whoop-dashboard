import AVFoundation
import Foundation
import Observation
import Speech

enum DictationMath {
    static let floorDecibels: Float = -50

    /// Maps a decibel reading onto 0...1 so silence is 0 and normal speech fills the bar.
    static func level(fromDecibels decibels: Float) -> Float {
        guard decibels.isFinite else { return decibels == .infinity ? 1 : 0 }
        return min(max((decibels - floorDecibels) / -floorDecibels, 0), 1)
    }

    static func decibels(fromRMS rms: Float) -> Float {
        guard rms.isFinite else { return floorDecibels }
        return 20 * log10(max(rms, 1e-7))
    }

    static func level(fromRMS rms: Float) -> Float {
        level(fromDecibels: decibels(fromRMS: rms))
    }

    static func rms(_ samples: UnsafeBufferPointer<Float>) -> Float {
        guard !samples.isEmpty else { return 0 }
        var sum: Float = 0
        for sample in samples { sum += sample * sample }
        return (sum / Float(samples.count)).squareRoot()
    }

    static func formatElapsed(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.isFinite ? seconds : 0))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    static func spokenElapsed(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.isFinite ? seconds : 0))
        let minutes = total / 60
        let secs = total % 60
        let minuteText = minutes == 1 ? "1 minute" : "\(minutes) minutes"
        let secondText = secs == 1 ? "1 second" : "\(secs) seconds"
        return minutes == 0 ? secondText : "\(minuteText) \(secondText)"
    }
}

/// Fixed-length window of recent levels; the newest value is last.
struct LevelRingBuffer: Equatable {
    let capacity: Int
    private(set) var values: [Float]

    init(capacity: Int) {
        self.capacity = max(1, capacity)
        self.values = Array(repeating: 0, count: max(1, capacity))
    }

    mutating func append(_ level: Float) {
        values.removeFirst()
        values.append(min(max(level.isFinite ? level : 0, 0), 1))
    }

    mutating func reset() {
        values = Array(repeating: 0, count: capacity)
    }
}

@MainActor
@Observable
final class VoiceDictation {
    enum State: Equatable {
        case idle
        case starting
        case recording
        case failed(String)
    }

    static let barCount = 32
    /// Apple's server recognizer stops at about a minute; finish just before it.
    static let serverTimeLimit: TimeInterval = 55
    static let finalResultWait: TimeInterval = 1.5

    private(set) var state: State = .idle
    private(set) var levels = LevelRingBuffer(capacity: VoiceDictation.barCount)
    private(set) var elapsed: TimeInterval = 0
    private(set) var transcript = ""
    private(set) var isFinishing = false
    private(set) var reachedLimit = false

    var isActive: Bool {
        switch state {
        case .starting, .recording: return true
        case .idle, .failed: return false
        }
    }

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var recognizer: SFSpeechRecognizer?
    @ObservationIgnored private var clockTask: Task<Void, Never>?
    @ObservationIgnored private var startTask: Task<Void, Never>?
    @ObservationIgnored private var startedAt: Date?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var receivedFinal = false
    @ObservationIgnored private var timeLimit: TimeInterval?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    nonisolated init() {}

    func start() {
        guard state == .idle || isFailed else { return }
        resetOutputs()
        state = .starting
        generation += 1
        let token = generation
        startTask = Task { [weak self] in
            await self?.beginRecording(token: token)
        }
    }

    /// Stops capture, gives the recognizer a moment to settle, and returns the best transcript.
    func finish() async -> String {
        guard isActive, !isFinishing else { return transcript }
        startTask?.cancel()
        isFinishing = true
        let token = generation
        stopCapture()
        request?.endAudio()

        let deadline = Date().addingTimeInterval(Self.finalResultWait)
        while !receivedFinal, task != nil, Date() < deadline, token == generation {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        let result = transcript
        teardown()
        isFinishing = false
        state = .idle
        return result
    }

    func cancel() {
        generation += 1
        startTask?.cancel()
        task?.cancel()
        teardown()
        resetOutputs()
        isFinishing = false
        state = .idle
    }

    /// Clears a `.failed` state after the caller has surfaced it.
    func acknowledgeFailure() {
        guard isFailed else { return }
        state = .idle
    }

    func takeLimitReached() {
        reachedLimit = false
    }

    private var isFailed: Bool {
        if case .failed = state { return true }
        return false
    }

    private func resetOutputs() {
        levels.reset()
        elapsed = 0
        transcript = ""
        receivedFinal = false
        reachedLimit = false
    }

    private func fail(_ message: String) {
        generation += 1
        task?.cancel()
        teardown()
        isFinishing = false
        state = .failed(message)
    }

    // MARK: Start

    private func beginRecording(token: Int) async {
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer() else {
            if token == generation { fail("Speech recognition isn’t available for your language.") }
            return
        }
        guard recognizer.isAvailable else {
            if token == generation { fail("Speech recognition isn’t available right now. Try again in a moment.") }
            return
        }

        let permission = await Self.requestPermissions()
        guard token == generation, !Task.isCancelled else { return }
        if let message = permission {
            fail(message)
            return
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: [])
            try session.setActive(true, options: [])
        } catch {
            fail("Couldn’t start the microphone. Check that no other app is recording.")
            return
        }

        let engine = AVAudioEngine()
        let format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            fail("No microphone input is available.")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        let onDevice = recognizer.supportsOnDeviceRecognition
        if onDevice { request.requiresOnDeviceRecognition = true }

        self.recognizer = recognizer
        self.request = request
        self.engine = engine
        timeLimit = onDevice ? nil : Self.serverTimeLimit
        receivedFinal = false

        task = recognizer.recognitionTask(
            with: request,
            resultHandler: Self.resultHandler(for: self, token: token)
        )

        engine.inputNode.installTap(
            onBus: 0,
            bufferSize: 2048,
            format: format,
            block: Self.tapBlock(for: self, request: request, token: token)
        )
        engine.prepare()
        do {
            try engine.start()
        } catch {
            fail("Couldn’t start recording. Please try again.")
            return
        }

        installObservers(token: token)
        startedAt = Date()
        state = .recording
        startClock(token: token)
    }

    private static func requestPermissions() async -> String? {
        let speech = await withCheckedContinuation { (continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speech == .authorized else {
            return "Speech Recognition is off for Coach. Turn it on in Settings > Coach to dictate."
        }
        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard micGranted else {
            return "Microphone access is off for Coach. Turn it on in Settings > Coach to dictate."
        }
        return nil
    }

    // MARK: Audio and recognition callbacks

    /// Built outside the main-actor context so the audio thread never trips an isolation check.
    private nonisolated static func tapBlock(
        for owner: VoiceDictation,
        request: SFSpeechAudioBufferRecognitionRequest,
        token: Int
    ) -> AVAudioNodeTapBlock {
        { [weak owner] buffer, _ in
            request.append(buffer)
            var level: Float = 0
            if let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 {
                let samples = UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength))
                level = DictationMath.level(fromRMS: DictationMath.rms(samples))
            }
            Task { @MainActor in owner?.receive(level: level, token: token) }
        }
    }

    private nonisolated static func resultHandler(
        for owner: VoiceDictation,
        token: Int
    ) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { [weak owner] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            Task { @MainActor in owner?.receive(text: text, isFinal: isFinal, failed: failed, token: token) }
        }
    }

    private func receive(level: Float, token: Int) {
        guard token == generation, state == .recording, !isFinishing else { return }
        levels.append(level)
    }

    private func receive(text: String?, isFinal: Bool, failed: Bool, token: Int) {
        guard token == generation else { return }
        if let text, !text.isEmpty { transcript = text }
        if isFinal || failed { receivedFinal = true }
        if failed, state == .recording, !isFinishing, transcript.isEmpty {
            fail("Couldn’t hear anything. Please try again.")
        }
    }

    // MARK: Clock, interruptions, teardown

    private func startClock(token: Int) {
        clockTask?.cancel()
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
                guard let self, token == self.generation else { return }
                self.tick()
            }
        }
    }

    private func tick() {
        guard state == .recording, !isFinishing, let startedAt else { return }
        elapsed = Date().timeIntervalSince(startedAt)
        if let timeLimit, elapsed >= timeLimit { reachedLimit = true }
    }

    private func installObservers(token: Int) {
        removeObservers()
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                .flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .began
            guard began else { return }
            Task { @MainActor in self?.interrupted(token: token) }
        })
        observers.append(center.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.interrupted(token: token) }
        })
    }

    private func interrupted(token: Int) {
        guard token == generation, state == .recording, !isFinishing else { return }
        fail("Recording was interrupted.")
    }

    private func removeObservers() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
    }

    private func stopCapture() {
        clockTask?.cancel()
        clockTask = nil
        removeObservers()
        if let engine {
            if engine.isRunning { engine.stop() }
            engine.inputNode.removeTap(onBus: 0)
        }
        engine = nil
    }

    private func teardown() {
        stopCapture()
        task?.cancel()
        task = nil
        request = nil
        recognizer = nil
        startedAt = nil
        timeLimit = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
