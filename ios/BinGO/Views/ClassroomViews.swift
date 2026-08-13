import SwiftData
import SwiftUI
import WebKit

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
    @State private var selectedSceneIndex: Int? = 0
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
                SceneContentView(scene: currentScene)
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
        guard let selectedSceneIndex, classroom.scenes.indices.contains(selectedSceneIndex) else { return nil }
        return classroom.scenes[selectedSceneIndex]
    }
}

/// 按场景 content.type 分发到对应的原生渲染视图；解码失败或无 content 时回退到标题页。
struct SceneContentView: View {
    let scene: SceneDTO?

    private var payload: SceneContentPayload? { scene?.decodedContentPayload() }

    var body: some View {
        VStack(spacing: 0) {
            Group {
                switch payload?.type {
                case "slide":
                    if let canvas = payload?.canvas {
                        SlideCanvasView(canvas: canvas)
                    } else {
                        LegacySceneView(scene: scene)
                    }
                case "quiz":
                    QuizSceneView(questions: payload?.questions ?? [])
                case "interactive":
                    InteractiveSceneView(html: payload?.html ?? "")
                case "pbl":
                    PBLSceneView(projectConfig: payload?.projectConfig, title: scene?.title)
                default:
                    LegacySceneView(scene: scene)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            SpeechTranscriptSection(actions: scene?.actions ?? [])
        }
    }
}

/// 画布下方可折叠的讲稿区（speech actions）。
private struct SpeechTranscriptSection: View {
    let actions: [SceneActionDTO]

    private var speechTexts: [String] {
        actions.filter { $0.type == "speech" }.compactMap(\.displayText)
    }

    var body: some View {
        if !speechTexts.isEmpty {
            DisclosureGroup("讲稿") {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(speechTexts.enumerated()), id: \.offset) { _, text in
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "quote.bubble").foregroundStyle(.blue)
                                Text(text).font(.callout)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
                }
                .frame(maxHeight: 180)
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
            .background(Color(uiColor: .systemGroupedBackground))
        }
    }
}

/// 旧数据回退：标题 + 讲稿文字的简单卡片（原 NativeSlideCanvas 的展示形式）。
private struct LegacySceneView: View {
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

/// 测验场景：题干 + 选项按钮，点选后显示对错与解析。
private struct QuizSceneView: View {
    let questions: [QuizQuestionPayload]
    @State private var selections: [String: Int] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if questions.isEmpty {
                    ContentUnavailableView("没有题目", systemImage: "questionmark.circle")
                }
                ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
                    questionCard(index: index, question: question)
                }
            }
            .padding(24)
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private func questionCard(index: Int, question: QuizQuestionPayload) -> some View {
        let options = question.optionTexts
        let selected = selections[question.displayID]
        return VStack(alignment: .leading, spacing: 12) {
            Text("\(index + 1). \(question.stemText)")
                .font(.headline)
            ForEach(Array(options.enumerated()), id: \.offset) { optionIndex, option in
                Button {
                    selections[question.displayID] = optionIndex
                } label: {
                    HStack {
                        Text(option)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if selected == optionIndex {
                            Image(systemName: isCorrect(option, question: question) ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundStyle(isCorrect(option, question: question) ? .green : .red)
                        }
                    }
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(optionBackground(optionIndex: optionIndex, option: option, question: question, selected: selected))
                    )
                }
                .buttonStyle(.plain)
            }
            if selected != nil, let explanation = question.explanationText {
                Text("解析：\(explanation)")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 14).fill(.white))
    }

    private func isCorrect(_ option: String, question: QuizQuestionPayload) -> Bool {
        guard let answer = question.answer else { return false }
        let answerText = answer.displayString.trimmingCharacters(in: .whitespacesAndNewlines)
        let optionText = option.trimmingCharacters(in: .whitespacesAndNewlines)
        // 答案可能是选项文本、字母序号（A/B/C）或数字下标
        if answerText == optionText { return true }
        if answerText.count == 1, let letter = answerText.first, letter.isLetter {
            let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
            if let optionIndex = question.optionTexts.firstIndex(of: option),
               let answerIndex = letters.firstIndex(of: Character(answerText.uppercased())) {
                return optionIndex == answerIndex
            }
        }
        if let answerIndex = Int(answerText), let optionIndex = question.optionTexts.firstIndex(of: option) {
            return optionIndex == answerIndex || optionIndex == answerIndex - 1
        }
        return false
    }

    private func optionBackground(optionIndex: Int, option: String, question: QuizQuestionPayload, selected: Int?) -> Color {
        guard selected == optionIndex else {
            return Color(uiColor: .secondarySystemGroupedBackground)
        }
        return isCorrect(option, question: question) ? Color.green.opacity(0.15) : Color.red.opacity(0.15)
    }
}

/// 互动场景：自包含 HTML 用 WKWebView 渲染。
private struct InteractiveSceneView: View {
    let html: String

    var body: some View {
        InteractiveWebView(html: html)
            .background(Color(uiColor: .systemGroupedBackground))
    }
}

private struct InteractiveWebView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        WKWebView()
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        webView.loadHTMLString(html, baseURL: URL(string: "https://api.bingo.mido.site"))
    }
}

/// PBL 场景：把 projectConfig 要点列成文本卡片。
private struct PBLSceneView: View {
    let projectConfig: JSONValue?
    let title: String?

    private var entries: [(String, String)] {
        guard case let .object(object) = projectConfig else { return [] }
        return object.sorted(by: { $0.key < $1.key }).map { ($0.key, $0.value.displayString) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(title ?? "项目式学习")
                    .font(.title2.bold())
                if entries.isEmpty {
                    ContentUnavailableView("没有项目配置", systemImage: "folder")
                }
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.0).font(.headline)
                        Text(entry.1).font(.callout).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 12).fill(.white))
                }
            }
            .padding(24)
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }
}
