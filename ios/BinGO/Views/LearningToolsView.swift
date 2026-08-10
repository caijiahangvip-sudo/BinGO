import SwiftUI

struct LearningToolsView: View {
    @Environment(AppState.self) private var appState
    @State private var searchQuery = ""
    @State private var searchResponse: WebSearchResponse?
    @State private var question = ""
    @State private var answer = ""
    @State private var gradingGuidance = ""
    @State private var gradeResponse: QuizGradeResponse?
    @State private var isSearching = false
    @State private var isGrading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                capabilityOverview
                webSearchSection
                gradingSection
            }
            .padding(24)
        }
        .navigationTitle("学习工具")
    }

    private var capabilityOverview: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("处理能力").font(.title2.bold())
            Text("LLM 始终使用云端；文档、OCR、语音和检索默认由 iPad 本地处理。")
                .foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                ForEach(ProcessingCapability.allCases) { capability in
                    let decision = appState.processingMode(for: capability)
                    HStack(spacing: 12) {
                        Image(systemName: capability.systemImage)
                            .frame(width: 34, height: 34)
                            .background(.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(capability.title).font(.headline)
                            Text(decision.mode == .cloud ? "云端" : "本地")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(decision.mode == .cloud ? .blue : .green)
                            Text(decision.reason).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer()
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
            }
        }
    }

    private var webSearchSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("联网搜索", systemImage: "globe.asia.australia.fill").font(.title2.bold())
            TextField("搜索知识点、教材或真实题目", text: $searchQuery, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            Button(isSearching ? "搜索中" : "开始搜索", systemImage: "magnifyingglass") {
                Task { await search() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSearching)

            if let searchResponse {
                if let answer = searchResponse.answer, !answer.isEmpty {
                    Text(answer).textSelection(.enabled)
                }
                ForEach(searchResponse.sources.prefix(8)) { source in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(source.title ?? source.url).font(.headline)
                        if let content = source.content { Text(content).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
                        Text(source.url).font(.caption2).foregroundStyle(.blue).textSelection(.enabled)
                    }
                    .padding()
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                }
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
    }

    private var gradingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("主观题批改", systemImage: "checkmark.seal.fill").font(.title2.bold())
            TextField("题目", text: $question, axis: .vertical).textFieldStyle(.roundedBorder)
            TextField("学生答案", text: $answer, axis: .vertical).textFieldStyle(.roundedBorder)
            TextField("评分要点（可选）", text: $gradingGuidance, axis: .vertical).textFieldStyle(.roundedBorder)
            Button(isGrading ? "批改中" : "AI 批改", systemImage: "wand.and.stars") {
                Task { await grade() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(question.isEmpty || answer.isEmpty || isGrading)

            if let gradeResponse {
                HStack(alignment: .top) {
                    Text("\(gradeResponse.score) / 10").font(.title.bold()).foregroundStyle(.blue)
                    Text(gradeResponse.comment).textSelection(.enabled)
                    Spacer()
                }
                .padding()
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
    }

    private func search() async {
        guard appState.isCloudAvailable else {
            appState.activeError = "联网搜索需要先在设置中连接 BinGO API。"
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            searchResponse = try await BinGOAPI(client: appState.apiClient).webSearch(query: searchQuery)
        } catch {
            appState.activeError = error.localizedDescription
        }
    }

    private func grade() async {
        guard appState.isCloudAvailable else {
            appState.activeError = "AI 批改需要先在设置中连接 BinGO API。"
            return
        }
        isGrading = true
        defer { isGrading = false }
        do {
            gradeResponse = try await BinGOAPI(client: appState.apiClient).gradeQuiz(
                request: QuizGradeRequest(
                    question: question,
                    userAnswer: answer,
                    points: 10,
                    commentPrompt: gradingGuidance.isEmpty ? nil : gradingGuidance,
                    language: "zh-CN"
                )
            )
        } catch {
            appState.activeError = error.localizedDescription
        }
    }
}
