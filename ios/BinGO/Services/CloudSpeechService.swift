import AVFoundation
import Foundation

/// User-facing switch for cloud-first speech (TTS + ASR) on iPad.
///
/// When enabled, speech requests are brokered by the BinGO server
/// (`/api/generate/tts` and `/api/transcription`), which call the Volcengine
/// Doubao models configured server-side. Any failure falls back to the
/// on-device speech stack.
struct CloudSpeechSettings: Codable, Equatable, Sendable {
    static let storageKey = "bingo.speech.cloudEnabled"

    var cloudEnabled: Bool

    static func load() -> CloudSpeechSettings {
        if UserDefaults.standard.object(forKey: storageKey) == nil {
            return CloudSpeechSettings(cloudEnabled: true)
        }
        return CloudSpeechSettings(cloudEnabled: UserDefaults.standard.bool(forKey: storageKey))
    }

    func save() {
        UserDefaults.standard.set(cloudEnabled, forKey: Self.storageKey)
    }
}

enum CloudSpeechError: LocalizedError {
    case notConfigured
    case invalidAudioPayload
    case emptyTranscript
    case noRecording
    case conversionFailed

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "尚未配置 BinGO API 地址。"
        case .invalidAudioPayload: return "云端语音返回的音频数据无效。"
        case .emptyTranscript: return "云端语音识别没有返回内容。"
        case .noRecording: return "没有录到音频。"
        case .conversionFailed: return "音频格式转换失败。"
        }
    }
}

/// Thin client for the server-brokered Doubao speech endpoints.
///
/// The server injects the Doubao API key from its own environment
/// (`TTS_DOUBAO_API_KEY` / `ASR_DOUBAO_API_KEY`), so the iPad never talks to
/// Volcengine directly.
struct CloudSpeechClient: Sendable {
    private static let ttsProviderId = "doubao-tts"
    /// Matches the web app's default Doubao speaker (lib/audio/constants.ts).
    private static let ttsVoice = "zh_female_vv_uranus_bigtts"
    private static let asrProviderId = "doubao-asr"

    let configuration: APIConfiguration

    init(configuration: APIConfiguration = .load()) {
        self.configuration = configuration.normalized()
    }

    var isConfigured: Bool { configuration.baseURL != nil }

    private struct TTSRequest: Encodable, Sendable {
        let text: String
        let audioId: String
        let ttsProviderId: String
        let ttsVoice: String
        let ttsSpeed: Double
    }

    private struct TTSResponse: Decodable, Sendable {
        let success: Bool
        let base64: String?
        let format: String?
    }

    /// Returns the synthesized audio (mp3) for the given text.
    func synthesize(text: String, speed: Double = 1.0) async throws -> Data {
        guard isConfigured else { throw CloudSpeechError.notConfigured }
        let client = APIClient(configuration: configuration)
        let body = TTSRequest(
            text: text,
            audioId: UUID().uuidString,
            ttsProviderId: Self.ttsProviderId,
            ttsVoice: Self.ttsVoice,
            ttsSpeed: min(max(speed, 0.5), 2.0)
        )
        let response: TTSResponse = try await client.post("/api/generate/tts", body: body)
        guard let base64 = response.base64, let data = Data(base64Encoded: base64), !data.isEmpty else {
            throw CloudSpeechError.invalidAudioPayload
        }
        return data
    }

    private struct TranscriptionResponse: Decodable, Sendable {
        let success: Bool
        let text: String?
    }

    /// Transcribes PCM16 16kHz mono WAV data via the server's ASR pipeline.
    func transcribe(wavData: Data, language: String = "auto") async throws -> String {
        guard isConfigured else { throw CloudSpeechError.notConfigured }
        let client = APIClient(configuration: configuration)
        let response: TranscriptionResponse = try await client.upload(
            "/api/transcription",
            fields: [
                "providerId": Self.asrProviderId,
                "compatibleProviderId": Self.asrProviderId,
                "language": language,
            ],
            file: UploadFile(
                fieldName: "audio",
                fileName: "recording.wav",
                mimeType: "audio/wav",
                data: wavData
            )
        )
        guard let text = response.text, !text.isEmpty else {
            throw CloudSpeechError.emptyTranscript
        }
        return text
    }
}

/// Records microphone audio and produces PCM16 16kHz mono WAV data — the exact
/// format Doubao Seed-ASR (bigmodel_nostream) expects.
///
/// Thread-safe: the AVAudioEngine tap callback appends buffers off the main
/// thread while start/stop are called from the main actor.
final class CloudAudioRecorder: @unchecked Sendable {
    static let targetSampleRate: Double = 16_000

    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var capturedBuffers: [AVAudioPCMBuffer] = []
    private var inputFormat: AVAudioFormat?

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        inputFormat = format
        lock.lock()
        capturedBuffers.removeAll()
        lock.unlock()

        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.lock.lock()
            self.capturedBuffers.append(buffer)
            self.lock.unlock()
        }
        try engine.start()
    }

    /// Stops recording and returns the captured audio as PCM16 16kHz mono WAV.
    func stopAndEncodeWAV() throws -> Data {
        if engine.isRunning {
            engine.stop()
        }
        engine.inputNode.removeTap(onBus: 0)
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])

        lock.lock()
        let buffers = capturedBuffers
        capturedBuffers.removeAll()
        let format = inputFormat
        lock.unlock()

        guard let format, !buffers.isEmpty else { throw CloudSpeechError.noRecording }
        let pcm = try Self.convertToPCM16(buffers: buffers, inputFormat: format)
        guard !pcm.isEmpty else { throw CloudSpeechError.noRecording }
        return Self.wrapWAVHeader(pcm: pcm, sampleRate: Int(Self.targetSampleRate))
    }

    func cancel() {
        if engine.isRunning {
            engine.stop()
        }
        engine.inputNode.removeTap(onBus: 0)
        lock.lock()
        capturedBuffers.removeAll()
        lock.unlock()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private static func convertToPCM16(
        buffers: [AVAudioPCMBuffer],
        inputFormat: AVAudioFormat
    ) throws -> Data {
        guard let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: targetSampleRate,
            channels: 1,
            interleaved: true
        ), let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            throw CloudSpeechError.conversionFailed
        }

        var result = Data()
        var index = 0
        while true {
            guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: 4096) else {
                throw CloudSpeechError.conversionFailed
            }
            var conversionError: NSError?
            let status = converter.convert(to: outputBuffer, error: &conversionError) { _, outStatus in
                guard index < buffers.count else {
                    outStatus.pointee = .endOfStream
                    return nil
                }
                outStatus.pointee = .haveData
                let buffer = buffers[index]
                index += 1
                return buffer
            }
            if let conversionError { throw conversionError }
            if outputBuffer.frameLength > 0, let channelData = outputBuffer.int16ChannelData {
                let byteCount = Int(outputBuffer.frameLength) * MemoryLayout<Int16>.size
                result.append(Data(bytes: channelData[0], count: byteCount))
            }
            if status == .endOfStream { break }
            if status == .error { throw CloudSpeechError.conversionFailed }
            if status == .inputRanDry, index >= buffers.count { break }
        }
        return result
    }

    private static func wrapWAVHeader(pcm: Data, sampleRate: Int) -> Data {
        var data = Data()
        data.reserveCapacity(44 + pcm.count)
        let dataSize = UInt32(pcm.count)
        data.append(contentsOf: [0x52, 0x49, 0x46, 0x46]) // "RIFF"
        data.appendLittleEndianUInt32(36 + dataSize)
        data.append(contentsOf: [0x57, 0x41, 0x56, 0x45]) // "WAVE"
        data.append(contentsOf: [0x66, 0x6D, 0x74, 0x20]) // "fmt "
        data.appendLittleEndianUInt32(16) // fmt chunk size
        data.appendLittleEndianUInt16(1) // PCM
        data.appendLittleEndianUInt16(1) // mono
        data.appendLittleEndianUInt32(UInt32(sampleRate))
        data.appendLittleEndianUInt32(UInt32(sampleRate * 2)) // byte rate
        data.appendLittleEndianUInt16(2) // block align
        data.appendLittleEndianUInt16(16) // bits per sample
        data.append(contentsOf: [0x64, 0x61, 0x74, 0x61]) // "data"
        data.appendLittleEndianUInt32(dataSize)
        data.append(pcm)
        return data
    }
}

private extension Data {
    mutating func appendLittleEndianUInt16(_ value: UInt16) {
        var value = value.littleEndian
        append(Data(bytes: &value, count: 2))
    }

    mutating func appendLittleEndianUInt32(_ value: UInt32) {
        var value = value.littleEndian
        append(Data(bytes: &value, count: 4))
    }
}
