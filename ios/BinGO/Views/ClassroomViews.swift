import SwiftData
import SwiftUI

struct ClassroomListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \ClassroomRecord.updatedAt, order: .reverse) private var classrooms: [ClassroomRecord]
    @State private var selectedID: UUID?
    @State private var showingCreate = false

    var body: some View {
        NavigationSplitView {
            List(classrooms, selection: $selectedID) { classroom in
                VStack(alignment: .leading, spacing: 4) {
                    Text(classroom.title).font(.headline)
                    Text(classroom.updatedAt, style: .date).font(.caption).foregroundStyle(.secondary)
                }
                .tag(classroom.id)
                .contextMenu {
                    Button("删除", role: .destructive) { modelContext.delete(classroom) }
                }
            }
            .overlay {
                if classrooms.isEmpty {
                    ContentUnavailableView("没有课堂", systemImage: "rectangle.on.rectangle.angled")
                }
            }
            .navigationTitle("课堂")
            .toolbar {
                Button("新建", systemImage: "plus") { showingCreate = true }
            }
        } detail: {
            if let selected = classrooms.first(where: { $0.id == selectedID }) {
                ClassroomDetailView(classroom: selected)
            } else {
                ContentUnavailableView("选择课堂", systemImage: "cursorarrow.click")
            }
        }
        .sheet(isPresented: $showingCreate) {
            CreateClassroomView { title, requirement in
                let classroom = ClassroomRecord(title: title, summary: requirement)
                modelContext.insert(classroom)
                selectedID = classroom.id
                return classroom
            }
        }
    }
}

private struct CreateClassroomView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @State private var title = ""
    @State private var requirement = ""
    @State private var isGenerating = false
    @State private var generationMessage = ""
    let onCreate: (String, String) -> ClassroomRecord

    var body: some View {
        NavigationStack {
            Form {
                TextField("课堂名称", text: $title)
                TextField("课堂主题与要求", text: $requirement, axis: .vertical)
                    .lineLimit(5...10)
                Section {
                    Text("课堂会先保存在 iPad。本地资料不需要上传；AI 内容生成需要已配置的 API。")
                    if isGenerating {
                        ProgressView(generationMessage.isEmpty ? "正在生成课堂…" : generationMessage)
                    }
                }
            }
            .navigationTitle("新建课堂")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isGenerating ? "生成中" : "创建") {
                        Task { await create() }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isGenerating)
                }
            }
        }
    }

    private func create() async {
        isGenerating = true
        defer { isGenerating = false }
        let classroom = onCreate(title, requirement)
        guard appState.configuration.baseURL != nil, !requirement.isEmpty else {
            dismiss()
            return
        }
        do {
            generationMessage = "服务器正在生成课件和课堂动作"
            let remote = try await BinGOAPI(client: appState.apiClient).generateClassroom(
                request: GenerationRequestDTO(requirement: requirement, language: "zh-CN")
            )
            classroom.remoteID = remote.id
            classroom.title = title.isEmpty ? remote.stage.displayName : title
            classroom.summary = remote.stage.description ?? requirement
            classroom.stage = remote.stage
            classroom.scenes = remote.scenes
            classroom.updatedAt = .now
        } catch {
            appState.activeError = error.localizedDescription
        }
        dismiss()
    }
}

struct ClassroomDetailView: View {
    @Bindable var classroom: ClassroomRecord
    @State private var selectedSceneIndex = 0
    @State private var speech = SpeechSynthesizer()
    @State private var showingChat = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading) {
                    TextField("课堂名称", text: $classroom.title).font(.title2.bold())
                    Text(classroom.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer()
                Button(speech.isSpeaking ? "停止朗读" : "朗读") {
                    if speech.isSpeaking { speech.stop() }
                    else { speech.speak(currentScene?.actions?.compactMap(\.displayText).joined(separator: "。") ?? classroom.summary) }
                }
                Button("AI 对话", systemImage: "bubble.left.and.bubble.right") { showingChat = true }
            }
            .padding()
            Divider()
            HStack(spacing: 0) {
                List(selection: $selectedSceneIndex) {
                    ForEach(Array(classroom.scenes.enumerated()), id: \.offset) { index, scene in
                        Text(scene.title ?? "场景 \(index + 1)").tag(index)
                    }
                }
                .frame(width: 240)
                NativeSlideCanvas(scene: currentScene)
            }
        }
        .onChange(of: classroom.title) { _, _ in classroom.updatedAt = .now }
        .sheet(isPresented: $showingChat) {
            ChatPanelView(
                stage: classroom.stage,
                scenes: classroom.scenes,
                currentSceneID: currentScene?.id
            )
        }
    }

    private var currentScene: SceneDTO? {
        classroom.scenes.indices.contains(selectedSceneIndex) ? classroom.scenes[selectedSceneIndex] : nil
    }
}

struct NativeSlideCanvas: View {
    let scene: SceneDTO?

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color(uiColor: .systemGroupedBackground)
                RoundedRectangle(cornerRadius: 20)
                    .fill(.white)
                    .shadow(radius: 12, y: 4)
                    .overlay(alignment: .topLeading) {
                        VStack(alignment: .leading, spacing: 18) {
                            Text(scene?.title ?? "课堂画布")
                                .font(.system(size: 34, weight: .bold))
                            ForEach(scene?.actions ?? []) { action in
                                if let text = action.displayText {
                                    HStack(alignment: .top) {
                                        Image(systemName: action.type == "speech" ? "quote.bubble" : "circle.fill")
                                            .foregroundStyle(.blue)
                                        Text(text).font(.title3)
                                    }
                                }
                            }
                            if scene == nil {
                                ContentUnavailableView("还没有场景", systemImage: "rectangle.on.rectangle")
                            }
                        }
                        .padding(36)
                    }
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .frame(maxWidth: proxy.size.width - 48, maxHeight: proxy.size.height - 48)
            }
        }
    }
}
