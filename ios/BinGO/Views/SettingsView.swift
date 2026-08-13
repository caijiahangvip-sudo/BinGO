import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var baseURL = ""
    @State private var token = ""
    @State private var isSaving = false
    @State private var showingTutorial = false
    @State private var cloudSpeechEnabled = CloudSpeechSettings.load().cloudEnabled

    var body: some View {
        Form {
            ServerAndSyncView()
            Section("AI 与处理 API") {
                TextField("API 地址", text: $baseURL, prompt: Text(APIConfiguration.defaultBaseURL))
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                SecureField("API Token（通常留空）", text: $token)
                Button(isSaving ? "正在验证" : "保存并验证") {
                    Task { await save() }
                }
                .disabled(isSaving)
                Button("恢复默认地址") {
                    baseURL = APIConfiguration.defaultBaseURL
                    token = ""
                    Task { await save() }
                }
                .disabled(isSaving)
            }
            Section("云端语音") {
                Toggle("优先使用云端语音（豆包 TTS / ASR）", isOn: $cloudSpeechEnabled)
                    .onChange(of: cloudSpeechEnabled) { _, newValue in
                        CloudSpeechSettings(cloudEnabled: newValue).save()
                    }
                Text("开启后，语音合成与识别通过 BinGO 服务器调用豆包大模型；失败或断网时自动回落到 iPad 本地语音。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section("连接状态") {
                switch appState.connectivity {
                case .checking:
                    Label("正在检查", systemImage: "arrow.triangle.2.circlepath")
                case let .online(version):
                    Label("已连接 BinGO \(version)", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                case let .offline(message):
                    Label(message, systemImage: "wifi.slash").foregroundStyle(.secondary)
                }
            }
            Section("本地能力") {
                Label(appState.deviceProfile.summary, systemImage: "ipad.gen2")
                ForEach(ProcessingCapability.allCases) { capability in
                    ProcessingPreferenceRow(capability: capability)
                }
                Button("重新检测设备与连接", systemImage: "arrow.clockwise") {
                    Task { await appState.refreshConnection() }
                }
            }
            Section("帮助") {
                Button("新手教程", systemImage: "book.pages") {
                    showingTutorial = true
                }
            }
            Section {
                Text("此应用不加载 BinGO 网页。同步账号与 AI API 配置彼此独立；AI 密钥只保存在本机 Keychain，不上传到同步服务器。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("设置")
        .fullScreenCover(isPresented: $showingTutorial) {
            OnboardingView { showingTutorial = false }
        }
        .onAppear {
            baseURL = appState.configuration.baseURLString
            token = appState.configuration.token
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        await appState.applyConfiguration(APIConfiguration(baseURLString: baseURL, token: token))
    }
}

private struct ProcessingPreferenceRow: View {
    @Environment(AppState.self) private var appState
    let capability: ProcessingCapability

    var body: some View {
        let decision = appState.processingMode(for: capability)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(capability.title, systemImage: capability.systemImage)
                Spacer()
                Picker("处理方式", selection: Binding(
                    get: { appState.processingPreferences.mode(for: capability) },
                    set: { appState.updateProcessingMode($0, for: capability) }
                )) {
                    ForEach(availableModes) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
            }
            Text("当前：\(decision.mode == .cloud ? "云端" : "本地") · \(decision.reason)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private var availableModes: [ProcessingMode] {
        capability == .languageModel ? [.cloud] : ProcessingMode.allCases
    }
}
