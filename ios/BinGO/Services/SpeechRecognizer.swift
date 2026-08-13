import AVFoundation
import Observation
import Speech

@MainActor
@Observable
final class SpeechRecognizer {
    enum State: Equatable {
        case idle
        case listening
        /// Cloud transcription is in flight after recording stopped.
        case processing
        case unavailable(String)
    }

    private enum Mode {
        case local
        case cloud
    }

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    /// Retains the file-based fallback task; SFSpeechRecognitionTask must be
    /// kept alive or it is cancelled prematurely.
    private var fileTranscriptionTask: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private let cloudRecorder = CloudAudioRecorder()
    private var mode: Mode = .local
    /// Sticky for the session: once the cloud path fails, stay on-device.
    private var cloudUnavailable = false

    var transcript = ""
    var state: State = .idle

    func requestAuthorization() async -> Bool {
        let speechAuthorized = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        guard speechAuthorized else {
            state = .unavailable("请在系统设置中允许 BinGO 使用语音识别。")
            return false
        }
        return await requestMicrophoneAuthorization()
    }

    private func requestMicrophoneAuthorization() async -> Bool {
        let microphoneAuthorized = await AVAudioApplication.requestRecordPermission()
        guard microphoneAuthorized else {
            state = .unavailable("请在系统设置中允许 BinGO 使用麦克风。")
            return false
        }
        return true
    }

    private func requestSpeechAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    func start() async {
        let useCloud =
            CloudSpeechSettings.load().cloudEnabled &&
            !cloudUnavailable &&
            CloudSpeechClient().isConfigured

        if useCloud {
            guard await requestMicrophoneAuthorization() else { return }
            stop()
            transcript = ""
            do {
                try cloudRecorder.start()
                mode = .cloud
                state = .listening
                return
            } catch {
                // Microphone/engine unavailable for the cloud path — fall
                // through to the on-device recognizer.
                mode = .local
            }
        }

        await startLocal()
    }

    private func startLocal() async {
        guard await requestAuthorization(), let recognizer, recognizer.isAvailable else {
            state = .unavailable("当前设备的语音识别暂不可用。")
            return
        }
        stop()
        mode = .local
        transcript = ""
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        recognitionRequest = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        do {
            try audioEngine.start()
            state = .listening
        } catch {
            state = .unavailable(error.localizedDescription)
            return
        }
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                if let result { self?.transcript = result.bestTranscription.formattedString }
                if error != nil || result?.isFinal == true { self?.stop() }
            }
        }
    }

    func stop() {
        if mode == .cloud {
            finishCloudRecording()
            return
        }
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        if case .listening = state { state = .idle }
    }

    private func finishCloudRecording() {
        mode = .local
        let wavData: Data
        do {
            wavData = try cloudRecorder.stopAndEncodeWAV()
        } catch {
            if case .listening = state { state = .idle }
            return
        }
        if case .listening = state { state = .processing }
        Task { [weak self] in
            await self?.transcribeCloudRecording(wavData)
        }
    }

    private func transcribeCloudRecording(_ wavData: Data) async {
        do {
            let text = try await CloudSpeechClient().transcribe(wavData: wavData)
            transcript = text
            if state == .processing { state = .idle }
        } catch {
            // Cloud ASR failed (offline, server error, ...) — transcribe the
            // same recording with the on-device recognizer instead.
            if let text = await transcribeOnDevice(wavData) {
                transcript = text
                if state == .processing { state = .idle }
            } else {
                cloudUnavailable = true
                state = .unavailable("云端语音识别失败，后续将使用本地识别。")
            }
        }
    }

    private func transcribeOnDevice(_ wavData: Data) async -> String? {
        guard let recognizer, await requestSpeechAuthorization() else { return nil }
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("bingo-asr-\(UUID().uuidString).wav")
        do {
            try wavData.write(to: fileURL, options: .atomic)
        } catch {
            return nil
        }
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let request = SFSpeechURLRecognitionRequest(url: fileURL)
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request.shouldReportPartialResults = false

        final class ResumeGuard: @unchecked Sendable {
            var resumed = false
        }
        let resumeGuard = ResumeGuard()
        return await withCheckedContinuation { continuation in
            let task = recognizer.recognitionTask(with: request) { result, error in
                if let result, result.isFinal, !resumeGuard.resumed {
                    resumeGuard.resumed = true
                    continuation.resume(returning: result.bestTranscription.formattedString)
                } else if error != nil, !resumeGuard.resumed {
                    resumeGuard.resumed = true
                    continuation.resume(returning: nil)
                }
            }
            fileTranscriptionTask = task
        }
    }
}
