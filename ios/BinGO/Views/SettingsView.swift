import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var baseURL = ""
    @State private var token = ""
    @State private var isSaving = false

    var body: some View {
        Form {
            Section("BinGO API") {
                TextField("API 地址", text: $baseURL, prompt: Text("https://api.example.com"))
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                SecureField("API Token", text: $token)
                Button(isSaving ? "正在验证" : "保存并验证") {
                    Task { await save() }
                }
                .disabled(isSaving)
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
                Label("PDFKit 本地 PDF", systemImage: "doc.richtext")
                Label("Vision 本地 OCR", systemImage: "viewfinder")
                Label("Speech 本地语音识别", systemImage: "waveform")
                Label("AVFoundation 本地朗读", systemImage: "speaker.wave.2")
                Label("PencilKit 原生白板", systemImage: "pencil.and.scribble")
            }
            Section {
                Text("此应用不加载 BinGO 网页。API 只用于 LLM、搜索、课堂生成和同步。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("设置")
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
