import AVFoundation
import Observation
import Speech

@MainActor
@Observable
final class SpeechRecognizer {
    enum State: Equatable {
        case idle
        case listening
        case unavailable(String)
    }

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))

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
        let microphoneAuthorized = await AVAudioApplication.requestRecordPermission()
        guard microphoneAuthorized else {
            state = .unavailable("请在系统设置中允许 BinGO 使用麦克风。")
            return false
        }
        return true
    }

    func start() async {
        guard await requestAuthorization(), let recognizer, recognizer.isAvailable else {
            state = .unavailable("当前设备的语音识别暂不可用。")
            return
        }
        stop()
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
}
