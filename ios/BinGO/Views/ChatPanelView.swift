import SwiftUI

struct ChatPanelView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @State private var messages: [ChatMessageDTO] = []
    @State private var input = ""
    @State private var isStreaming = false
    let stage: StageDTO?
    let scenes: [SceneDTO]
    let currentSceneID: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(messages) { message in
                                HStack {
                                    if message.role == "user" { Spacer(minLength: 80) }
                                    Text(message.content)
                                        .textSelection(.enabled)
                                        .padding(12)
                                        .background(
                                            message.role == "user" ? Color.blue : Color(uiColor: .secondarySystemBackground),
                                            in: RoundedRectangle(cornerRadius: 14)
                                        )
                                        .foregroundStyle(message.role == "user" ? .white : .primary)
                                    if message.role != "user" { Spacer(minLength: 80) }
                                }
                                .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { _, _ in
                        if let id = messages.last?.id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
                    }
                }
                Divider()
                HStack(alignment: .bottom) {
                    TextField("输入消息", text: $input, axis: .vertical).lineLimit(1...6)
                    Button("发送", systemImage: "arrow.up.circle.fill") { Task { await send() } }
                        .labelStyle(.iconOnly)
                        .font(.title2)
                        .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isStreaming)
                }
                .padding()
            }
            .navigationTitle("AI 对话")
            .toolbar { Button("完成") { dismiss() } }
        }
    }

    private func send() async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input = ""
        let userMessage = ChatMessageDTO(id: UUID().uuidString, role: "user", content: text, createdAt: .now)
        let assistantID = UUID().uuidString
        messages.append(userMessage)
        messages.append(ChatMessageDTO(id: assistantID, role: "assistant", content: "", createdAt: .now))
        isStreaming = true
        defer { isStreaming = false }
        do {
            let request = ChatRequestDTO(
                messages: messages.dropLast().map {
                    StatelessChatMessageDTO(
                        id: $0.id,
                        role: $0.role,
                        parts: [ChatMessagePartDTO(type: "text", text: $0.content)]
                    )
                },
                storeState: ChatStoreStateDTO(
                    stage: stage,
                    scenes: scenes,
                    currentSceneId: currentSceneID,
                    mode: "autonomous",
                    whiteboardOpen: false
                ),
                config: ChatConfigDTO(
                    agentIds: stage?.agentIds?.isEmpty == false ? stage?.agentIds ?? ["default-1"] : ["default-1"],
                    sessionType: "qa",
                    studentQuestion: text
                ),
                apiKey: "",
                requiresApiKey: false
            )
            let stream = try await appState.apiClient.stream("/api/chat", body: request)
            for try await event in stream {
                guard event.data != "[DONE]", let index = messages.firstIndex(where: { $0.id == assistantID }) else { continue }
                if let data = event.data.data(using: .utf8),
                   let payload = try? JSONDecoder().decode(ChatStreamPayload.self, from: data) {
                    if payload.type == "error" {
                        throw APIError.server(status: 500, message: payload.data.message ?? "AI 对话失败")
                    }
                    messages[index].content += payload.data.content ?? payload.data.delta ?? ""
                } else {
                    messages[index].content += event.data
                }
            }
        } catch {
            appState.activeError = error.localizedDescription
        }
    }
}

private struct ChatStreamPayload: Decodable {
    let type: String
    let data: ChatStreamData
}

private struct ChatStreamData: Decodable {
    let content: String?
    let delta: String?
    let message: String?
}
