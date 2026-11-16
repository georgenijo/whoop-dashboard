import AVFoundation
import Foundation
import Observation
import os
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

    /// How many bars of the given size fit in a width, never fewer than one.
    static func barCount(forWidth width: CGFloat, barWidth: CGFloat, spacing: CGFloat) -> Int {
        guard width.isFinite, width > 0 else { return 1 }
        return max(1, Int(((width + spacing) / (barWidth + spacing)).rounded(.down)))
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

enum DictationErrorKind: Equatable {
    case noSpeech
    case cancelled
    case other

    static func classify(domain: String, code: Int) -> DictationErrorKind {
        switch (domain, code) {
        case ("kAFAssistantErrorDomain", 1110), ("kAFAssistantErrorDomain", 203):
            return .noSpeech
        case ("kAFAssistantErrorDomain", 216), ("kAFAssistantErrorDomain", 301),
             ("kAFAssistantErrorDomain", 1107), (NSCocoaErrorDomain, NSUserCancelledError):
            return .cancelled
        default:
            return .other
        }
    }
}

enum DictationFallback {
    /// An on-device recognizer whose model is missing errors at once, before any text.
    /// Retrying against Apple's server recognizer recovers; a late "no speech" does not need it.
    static let startupWindow: TimeInterval = 1

    static func shouldFallBackToServer(
        onDevice: Bool,
        alreadyFellBack: Bool,
        hasTranscript: Bool,
        elapsed: TimeInterval,
        kind: DictationErrorKind
    ) -> Bool {
        guard onDevice, !alreadyFellBack, !hasTranscript else { return false }
        switch kind {
        case .cancelled: return false
        case .noSpeech: return elapsed < startupWindow
        case .other: return true
        }
    }
}

/// Lets the audio tap keep appending while the recognition request is swapped underneath it.
final class RecognitionRequestBox: @unchecked Sendable {
    private let lock = NSLock()
    private var current: SFSpeechAudioBufferRecognitionRequest?

    func set(_ request: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock()
        current = request
        lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        let request = current
        lock.unlock()
        request?.append(buffer)
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
        /// The recognizer ended the session on its own with a usable transcript.
        case finished
    }

    /// Upper bound on bars the waveform can draw; it shows however many fit.
    static let barCount = 80
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
        case .idle, .failed, .finished: return false
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
    @ObservationIgnored private var attempt = 0
    @ObservationIgnored private var fellBackToServer = false
    @ObservationIgnored private let requestBox = RecognitionRequestBox()
    @ObservationIgnored private static let log = Logger(subsystem: "com.georgenijo.coach", category: "dictation")
    @ObservationIgnored private var sessionActive = false
    @ObservationIgnored private var receivedFinal = false
    @ObservationIgnored private var timeLimit: TimeInterval?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    nonisolated init() {}

    func start() {
        guard !isActive, !isFinishing else { return }
        resetOutputs()
        state = .starting
        generation += 1
        let token = generation
        startTask = Task { [weak self] in
            await self?.beginRecording(token: token)
        }
    }

    /// Stops capture, gives the recognizer a moment to settle, and returns the best transcript.
    /// Returns nil when this call did not own the finish: a finish was already under way,
    /// nothing was recording, or the session was cancelled or replaced while waiting.
    func finish() async -> String? {
        guard state == .recording, !isFinishing else { return nil }
        isFinishing = true
        let token = generation
        stopCapture()
        request?.endAudio()

        let deadline = Date().addingTimeInterval(Self.finalResultWait)
        while !receivedFinal, task != nil, Date() < deadline, token == generation {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        guard token == generation else { return nil }
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

    /// Clears a `.failed` or `.finished` state after the caller has consumed it.
    func acknowledgeEnd() {
        guard !isActive, state != .idle else { return }
        state = .idle
    }

    func takeLimitReached() {
        reachedLimit = false
    }

    private func resetOutputs() {
        levels.reset()
        elapsed = 0
        transcript = ""
        receivedFinal = false
        reachedLimit = false
    }

    private func logWarn(_ message: String, details: [String: Any]) {
        Self.log.warning("\(message, privacy: .public) \(String(describing: details), privacy: .public)")
        ClientLogger.shared.warn(message, details: details)
    }

    private func fallBackToServer(after error: NSError, token: Int) {
        guard let recognizer else {
            fail("Couldn’t hear anything. Please try again.", reason: "fallback_no_recognizer", error: error)
            return
        }
        logWarn("dictation_ondevice_fallback", details: ["domain": error.domain, "code": error.code])
        fellBackToServer = true
        attempt += 1
        task?.cancel()
        let next = SFSpeechAudioBufferRecognitionRequest()
        next.shouldReportPartialResults = true
        next.addsPunctuation = true
        next.requiresOnDeviceRecognition = false
        request = next
        requestBox.set(next)
        receivedFinal = false
        timeLimit = Self.serverTimeLimit
        task = recognizer.recognitionTask(
            with: next,
            resultHandler: Self.resultHandler(for: self, token: token, attempt: attempt)
        )
    }

    private func fail(_ message: String, reason: String = "setup", error: NSError? = nil) {
        var details: [String: Any] = ["reason": reason]
        if let error {
            details["domain"] = error.domain
            details["code"] = error.code
        }
        logWarn("dictation_failed", details: details)
        endSession(.failed(message))
    }

    private func endSession(_ newState: State) {
        generation += 1
        task?.cancel()
        teardown()
        isFinishing = false
        state = newState
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

        switch await requestPermissions(token: token) {
        case .stale: return
        case .denied(let message):
            fail(message)
            return
        case .granted: break
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: [.allowBluetooth])
            try session.setActive(true, options: [])
            sessionActive = true
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
        requestBox.set(request)
        fellBackToServer = false
        attempt += 1
        let currentAttempt = attempt
        self.engine = engine
        timeLimit = onDevice ? nil : Self.serverTimeLimit
        receivedFinal = false

        task = recognizer.recognitionTask(
            with: request,
            resultHandler: Self.resultHandler(for: self, token: token, attempt: currentAttempt)
        )

        engine.inputNode.installTap(
            onBus: 0,
            bufferSize: 2048,
            format: format,
            block: Self.tapBlock(for: self, box: requestBox, token: token)
        )
        installObservers(token: token, engine: engine)
        engine.prepare()
        do {
            try engine.start()
        } catch {
            fail("Couldn’t start recording. Please try again.", reason: "engine_start_failed", error: error as NSError)
            return
        }

        startedAt = Date()
        state = .recording
        startClock(token: token)
    }

    private enum PermissionOutcome {
        case granted
        case denied(String)
        case stale
    }

    private func isCurrent(_ token: Int) -> Bool {
        token == generation && !Task.isCancelled
    }

    private func requestPermissions(token: Int) async -> PermissionOutcome {
        guard isCurrent(token) else { return .stale }
        let speech = await withCheckedContinuation { (continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard isCurrent(token) else { return .stale }
        guard speech == .authorized else {
            return .denied("Speech Recognition is off for Coach. Turn it on in Settings > Coach to dictate.")
        }
        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard isCurrent(token) else { return .stale }
        guard micGranted else {
            return .denied("Microphone access is off for Coach. Turn it on in Settings > Coach to dictate.")
        }
        return .granted
    }

    // MARK: Audio and recognition callbacks

    /// Built outside the main-actor context so the audio thread never trips an isolation check.
    private nonisolated static func tapBlock(
        for owner: VoiceDictation,
        box: RecognitionRequestBox,
        token: Int
    ) -> AVAudioNodeTapBlock {
        { [weak owner] buffer, _ in
            box.append(buffer)
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
        token: Int,
        attempt: Int
    ) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { [weak owner] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let nsError = error as NSError?
            Task { @MainActor in owner?.receive(text: text, isFinal: isFinal, error: nsError, token: token, attempt: attempt) }
        }
    }

    private func receive(level: Float, token: Int) {
        guard token == generation, state == .recording, !isFinishing else { return }
        levels.append(level)
    }

    private func receive(text: String?, isFinal: Bool, error: NSError?, token: Int, attempt: Int) {
        guard token == generation, attempt == self.attempt else { return }
        if let text, !text.isEmpty { transcript = text }
        if isFinal || error != nil { receivedFinal = true }
        guard isFinal || error != nil, state == .recording, !isFinishing else { return }

        let kind = error.map { DictationErrorKind.classify(domain: $0.domain, code: $0.code) }
        if let error, let kind,
           DictationFallback.shouldFallBackToServer(
               onDevice: request?.requiresOnDeviceRecognition ?? false,
               alreadyFellBack: fellBackToServer,
               hasTranscript: !transcript.isEmpty,
               elapsed: startedAt.map { Date().timeIntervalSince($0) } ?? 0,
               kind: kind
           ) {
            fallBackToServer(after: error, token: token)
            return
        }
        if let error {
            logWarn("dictation_recognizer_error", details: [
                "domain": error.domain,
                "code": error.code,
                "kind": String(describing: kind ?? .other),
                "has_transcript": !transcript.isEmpty,
                "on_device": request?.requiresOnDeviceRecognition ?? false,
            ])
        }

        if !transcript.isEmpty {
            if kind == nil || kind == .noSpeech || kind == .cancelled {
                endSession(.finished)
            } else {
                fail("Dictation stopped early. Your words so far were kept.", reason: "recognizer_error", error: error)
            }
        } else if kind == .cancelled {
            endSession(.idle)
        } else if kind == .noSpeech || kind == nil {
            fail("Didn’t catch any speech. Try again.", reason: "no_speech", error: error)
        } else {
            fail("Couldn’t hear anything. Please try again.", reason: "recognizer_error", error: error)
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

    private func installObservers(token: Int, engine: AVAudioEngine) {
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
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.configurationChanged(token: token) }
        })
    }

    private func interrupted(token: Int) {
        guard token == generation, state == .recording || state == .starting, !isFinishing else { return }
        fail("Recording was interrupted.", reason: "session_interrupted")
    }

    /// A route or format change stops the engine; rebuild the tap on the new format and carry on.
    private func configurationChanged(token: Int) {
        guard token == generation, state == .recording || state == .starting, !isFinishing,
              let engine else { return }
        engine.inputNode.removeTap(onBus: 0)
        let format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            fail("No microphone input is available.", reason: "config_change_no_input")
            return
        }
        engine.inputNode.installTap(
            onBus: 0,
            bufferSize: 2048,
            format: format,
            block: Self.tapBlock(for: self, box: requestBox, token: token)
        )
        engine.prepare()
        do {
            try engine.start()
        } catch {
            fail("Recording was interrupted.", reason: "config_change_restart_failed", error: error as NSError)
        }
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
        if sessionActive {
            sessionActive = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}
