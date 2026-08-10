import Foundation

enum ProcessingMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case automatic
    case local
    case cloud

    var id: String { rawValue }

    var title: String {
        switch self {
        case .automatic: "自动推荐"
        case .local: "仅本地"
        case .cloud: "使用云端"
        }
    }
}

enum ProcessingCapability: String, Codable, CaseIterable, Identifiable, Sendable {
    case languageModel
    case documentParsing
    case ocr
    case speechRecognition
    case textToSpeech
    case embeddings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .languageModel: "大语言模型"
        case .documentParsing: "PDF 与文档解析"
        case .ocr: "图片 OCR"
        case .speechRecognition: "语音识别"
        case .textToSpeech: "文字朗读"
        case .embeddings: "教材向量检索"
        }
    }

    var systemImage: String {
        switch self {
        case .languageModel: "sparkles"
        case .documentParsing: "doc.text.magnifyingglass"
        case .ocr: "viewfinder"
        case .speechRecognition: "waveform"
        case .textToSpeech: "speaker.wave.2"
        case .embeddings: "point.3.connected.trianglepath.dotted"
        }
    }

    var defaultMode: ProcessingMode {
        self == .languageModel ? .cloud : .automatic
    }
}

struct ProcessingPreferences: Codable, Equatable, Sendable {
    private var modes: [String: ProcessingMode]

    init(modes: [String: ProcessingMode] = [:]) {
        self.modes = modes
    }

    func mode(for capability: ProcessingCapability) -> ProcessingMode {
        modes[capability.rawValue] ?? capability.defaultMode
    }

    mutating func set(_ mode: ProcessingMode, for capability: ProcessingCapability) {
        modes[capability.rawValue] = mode
    }

    static func load() -> ProcessingPreferences {
        guard let data = UserDefaults.standard.data(forKey: "bingo.processing.preferences"),
              let value = try? JSONDecoder().decode(ProcessingPreferences.self, from: data)
        else { return ProcessingPreferences() }
        return value
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(data, forKey: "bingo.processing.preferences")
    }
}

struct DevicePerformanceProfile: Equatable, Sendable {
    let memoryGB: Double
    let lowPowerMode: Bool
    let thermalState: ProcessInfo.ThermalState

    static var current: DevicePerformanceProfile {
        let process = ProcessInfo.processInfo
        return DevicePerformanceProfile(
            memoryGB: Double(process.physicalMemory) / 1_073_741_824,
            lowPowerMode: process.isLowPowerModeEnabled,
            thermalState: process.thermalState
        )
    }

    var isConstrained: Bool {
        lowPowerMode || thermalState == .serious || thermalState == .critical
    }

    var summary: String {
        let memory = memoryGB.formatted(.number.precision(.fractionLength(1)))
        if thermalState == .critical { return "设备过热，建议使用云端处理 · \(memory) GB 内存" }
        if thermalState == .serious { return "设备温度较高，复杂任务建议云端处理 · \(memory) GB 内存" }
        if lowPowerMode { return "低电量模式已开启，复杂任务建议云端处理 · \(memory) GB 内存" }
        return "本地处理能力正常 · \(memory) GB 内存"
    }
}

struct ProcessingDecision: Equatable, Sendable {
    let mode: ProcessingMode
    let reason: String
}

enum ProcessingRouter {
    static func decision(
        for capability: ProcessingCapability,
        preferences: ProcessingPreferences,
        profile: DevicePerformanceProfile,
        cloudAvailable: Bool
    ) -> ProcessingDecision {
        let preference = preferences.mode(for: capability)
        if capability == .languageModel {
            return ProcessingDecision(
                mode: cloudAvailable ? .cloud : .local,
                reason: cloudAvailable ? "大语言模型默认使用云端" : "云端不可用，等待恢复连接"
            )
        }

        switch preference {
        case .local:
            return ProcessingDecision(mode: .local, reason: "用户指定使用本地能力")
        case .cloud:
            return ProcessingDecision(
                mode: cloudAvailable ? .cloud : .local,
                reason: cloudAvailable ? "用户指定使用云端能力" : "云端不可用，自动回退本地"
            )
        case .automatic:
            if profile.isConstrained, cloudAvailable,
               capability == .ocr || capability == .speechRecognition || capability == .embeddings {
                return ProcessingDecision(mode: .cloud, reason: "设备当前性能受限，自动使用云端")
            }
            return ProcessingDecision(mode: .local, reason: "设备能力正常，优先保护隐私并离线处理")
        }
    }
}
