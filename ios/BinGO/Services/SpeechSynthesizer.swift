import AVFoundation
import Observation

@MainActor
@Observable
final class SpeechSynthesizer: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var audioPlayer: AVAudioPlayer?
    /// True while a cloud (Doubao via BinGO server) playback is active.
    private var isCloudPlayback = false
    var isSpeaking = false
    var isPaused = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, language: String = "zh-CN", rate: Float = AVSpeechUtteranceDefaultSpeechRate) {
        stop()
        guard CloudSpeechSettings.load().cloudEnabled, CloudSpeechClient().isConfigured else {
            speakLocally(text, language: language, rate: rate)
            return
        }
        // AVSpeechUtterance rate 0.5 ≈ normal speed → map to a 0.5...2.0 factor.
        let speed = min(max(Double(rate) * 2.0, 0.5), 2.0)
        Task { [weak self] in
            guard let self else { return }
            do {
                let data = try await CloudSpeechClient().synthesize(text: text, speed: speed)
                try self.playCloudAudio(data)
            } catch {
                // Cloud TTS unavailable (offline, server error, ...) — use the
                // on-device voice instead.
                self.speakLocally(text, language: language, rate: rate)
            }
        }
    }

    private func speakLocally(_ text: String, language: String, rate: Float) {
        isCloudPlayback = false
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: language)
        utterance.rate = rate
        synthesizer.speak(utterance)
    }

    private func playCloudAudio(_ data: Data) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default)
        try session.setActive(true)
        let player = try AVAudioPlayer(data: data)
        player.delegate = self
        audioPlayer = player
        isCloudPlayback = true
        player.play()
        isSpeaking = true
        isPaused = false
    }

    func pause() {
        if isCloudPlayback {
            guard let audioPlayer, audioPlayer.isPlaying else { return }
            audioPlayer.pause()
            isPaused = true
            return
        }
        guard synthesizer.pauseSpeaking(at: .word) else { return }
        isPaused = true
    }

    func resume() {
        if isCloudPlayback {
            guard let audioPlayer, !audioPlayer.isPlaying else { return }
            audioPlayer.play()
            isPaused = false
            return
        }
        guard synthesizer.continueSpeaking() else { return }
        isPaused = false
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        audioPlayer?.stop()
        audioPlayer = nil
        isCloudPlayback = false
        isSpeaking = false
        isPaused = false
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.isSpeaking = true }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.isSpeaking = false
            self?.isPaused = false
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.isSpeaking = false
            self?.isPaused = false
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let playerID = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.audioPlayer, ObjectIdentifier(current) == playerID else { return }
            self.audioPlayer = nil
            self.isCloudPlayback = false
            self.isSpeaking = false
            self.isPaused = false
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let playerID = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.audioPlayer, ObjectIdentifier(current) == playerID else { return }
            self.audioPlayer = nil
            self.isCloudPlayback = false
            self.isSpeaking = false
            self.isPaused = false
        }
    }
}
