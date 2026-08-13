import PhotosUI
import SwiftData
import SwiftUI
import UIKit

struct HomeworkListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \HomeworkRecord.updatedAt, order: .reverse) private var items: [HomeworkRecord]
    @State private var selectedID: UUID?

    var body: some View {
        NavigationSplitView {
            List(items, selection: $selectedID) { item in
                VStack(alignment: .leading) {
                    Text(item.title).font(.headline)
                    Text(item.status).font(.caption).foregroundStyle(.secondary)
                }.tag(item.id)
            }
            .navigationTitle("作业")
            .toolbar {
                Button("新建", systemImage: "plus") {
                    let item = HomeworkRecord(title: "新作业")
                    modelContext.insert(item)
                    selectedID = item.id
                }
            }
        } detail: {
            if let selected = items.first(where: { $0.id == selectedID }) { HomeworkEditor(item: selected) }
            else { ContentUnavailableView("选择作业", systemImage: "checklist") }
        }
    }
}

private struct HomeworkEditor: View {
    @Environment(AppState.self) private var appState
    @Bindable var item: HomeworkRecord
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var solveTask: Task<Void, Never>?
    @State private var jobID: String?
    @State private var progress: Double = 0
    @State private var progressMessage = ""

    private let ocrService = OCRService()

    var body: some View {
        Form {
            TextField("标题", text: $item.title)
            TextField("题目", text: $item.prompt, axis: .vertical).lineLimit(5...15)
            TextField("答案与批注", text: $item.answer, axis: .vertical).lineLimit(8...20)
            Section("拍照解题") {
                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                    Label("选择或拍摄题目图片", systemImage: "camera.viewfinder")
                }
                if item.status == "solving" {
                    ProgressView(value: progress, total: 100) {
                        Text(progressMessage.isEmpty ? "正在解题…" : progressMessage)
                    }
                    Button("取消解题", role: .destructive) { cancelSolve() }
                }
            }
            Picker("状态", selection: $item.status) {
                Text("草稿").tag("draft")
                Text("解题中").tag("solving")
                Text("进行中").tag("active")
                Text("已完成").tag("completed")
                Text("已取消").tag("cancelled")
            }
        }
        .navigationTitle(item.title)
        .onChange(of: item.answer) { _, _ in item.updatedAt = .now }
        .onChange(of: selectedPhoto) { _, photo in
            guard let photo else { return }
            solveTask?.cancel()
            solveTask = Task { await solve(photo) }
        }
        .onDisappear { solveTask?.cancel() }
    }

    private func solve(_ photo: PhotosPickerItem) async {
        item.status = "solving"
        progress = 2
        progressMessage = "正在读取图片并进行本地 OCR"
        do {
            guard let sourceData = try await photo.loadTransferable(type: Data.self),
                  let image = UIImage(data: sourceData),
                  let uploadData = image.jpegData(compressionQuality: 0.9)
            else { throw CocoaError(.fileReadCorruptFile) }

            let localText = try await ocrService.recognize(image: image).text
            if !localText.isEmpty { item.prompt = localText }

            let api = BinGOAPI(client: appState.apiClient)
            let start = try await api.startHomework(
                file: UploadFile(
                    fieldName: "file",
                    fileName: "homework-\(UUID().uuidString).jpg",
                    mimeType: "image/jpeg",
                    data: uploadData
                )
            )
            jobID = start.jobId
            var job = start
            while !job.done, !Task.isCancelled {
                progress = job.progress
                progressMessage = job.message
                try await Task.sleep(for: .milliseconds(job.pollIntervalMs ?? 3_000))
                job = try await api.homeworkJob(id: start.jobId)
            }
            try Task.checkCancellation()
            if job.status == "failed" {
                throw APIError.server(status: 500, message: job.error ?? job.message)
            }
            if job.status == "cancelled" {
                item.status = "cancelled"
            } else if let result = job.result {
                item.title = result.title
                item.answer = result.formattedAnswer
                item.status = "completed"
                progress = 100
                progressMessage = "解题完成"
            }
            item.updatedAt = .now
        } catch is CancellationError {
            item.status = "cancelled"
        } catch {
            item.status = "draft"
            appState.activeError = error.localizedDescription
        }
        jobID = nil
    }

    private func cancelSolve() {
        let activeJobID = jobID
        solveTask?.cancel()
        item.status = "cancelled"
        guard let activeJobID else { return }
        Task {
            do {
                let _: HomeworkCancelResponse = try await BinGOAPI(client: appState.apiClient)
                    .cancelHomework(jobID: activeJobID)
            } catch {
                appState.activeError = error.localizedDescription
            }
        }
    }
}

struct BookLearningView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppState.self) private var appState
    @Query(sort: \BookPlanRecord.updatedAt, order: .reverse) private var plans: [BookPlanRecord]
    @Query(sort: \ImportedDocument.createdAt, order: .reverse) private var documents: [ImportedDocument]
    @State private var selectedPlanID: UUID?
    @State private var isGenerating = false
    @State private var showingTextbookLibrary = false
    @State private var generationMessage = "正在生成整本书学习计划…"
    @State private var generationStart: Date?
    private let pdfService = PDFService()

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedPlanID) {
                ForEach(plans) { plan in
                VStack(alignment: .leading, spacing: 8) {
                    Text(plan.title).font(.headline)
                    ProgressView(value: plan.progress)
                    Text("\(plan.currentLessonIndex)/\(plan.totalLessons) 课 · \(plan.sourceFileName)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 6)
                .tag(plan.id)
                .contextMenu {
                    Button("删除学习计划", role: .destructive) { deletePlan(plan) }
                }
                }
                .onDelete { indexSet in
                    for index in indexSet { deletePlan(plans[index]) }
                }
            }
            .overlay {
                if plans.isEmpty {
                    ContentUnavailableView("还没有书本学习计划", systemImage: "books.vertical", description: Text("先导入 PDF，再从这里生成学习计划。"))
                }
            }
            .navigationTitle("书本学习")
            .toolbar {
                Button("教材库", systemImage: "books.vertical") {
                    showingTextbookLibrary = true
                }
                .disabled(isGenerating)
                Menu("从 PDF 创建", systemImage: "plus") {
                    if documents.isEmpty {
                        Text("请先在 PDF 与 OCR 页面导入教材")
                    } else {
                        ForEach(documents) { document in
                            Button(document.fileName) { Task { await generatePlan(from: document) } }
                        }
                    }
                }
                .disabled(isGenerating)
            }
        } detail: {
            if let plan = plans.first(where: { $0.id == selectedPlanID }) {
                BookPlanDetailView(plan: plan)
            } else {
                ContentUnavailableView("选择学习计划", systemImage: "book.pages")
            }
        }
        .sheet(isPresented: $showingTextbookLibrary) {
            TextbookLibraryView { document in
                showingTextbookLibrary = false
                Task { await generatePlan(from: document) }
            }
        }
        .overlay {
            if isGenerating {
                // 服务端是一次性请求，没有真实进度：用缓动曲线估算（趋向 95%），
                // 完成后直接消失，不假装精确到 100%。
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let elapsed = generationStart.map { context.date.timeIntervalSince($0) } ?? 0
                    let estimate = min(0.95, 1 - pow(0.5, elapsed / 60))
                    VStack(spacing: 12) {
                        ProgressView(value: estimate)
                            .frame(width: 260)
                        Text(generationMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text("已用 \(Int(elapsed)) 秒")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(20)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private func deletePlan(_ plan: BookPlanRecord) {
        if selectedPlanID == plan.id { selectedPlanID = nil }
        modelContext.delete(plan)
    }

    private func fetchLearnerProfile(excluding fileName: String) -> LearnerProfileDTO? {
        let bookDescriptor = FetchDescriptor<BookPlanRecord>(
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        let books = ((try? modelContext.fetch(bookDescriptor)) ?? [])
            .filter { $0.sourceFileName != fileName }
            .prefix(10)
            .map {
                LearnerBookDTO(
                    title: $0.title,
                    currentLessonIndex: $0.currentLessonIndex,
                    totalLessons: $0.totalLessons,
                    notes: $0.notes.isEmpty ? nil : $0.notes
                )
            }
        let homeworkDescriptor = FetchDescriptor<HomeworkRecord>(
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        let homework = ((try? modelContext.fetch(homeworkDescriptor)) ?? [])
            .prefix(5)
            .map { LearnerHomeworkDTO(title: $0.title, status: $0.status) }
        if books.isEmpty && homework.isEmpty { return nil }
        return LearnerProfileDTO(
            currentBooks: books.isEmpty ? nil : Array(books),
            recentHomework: homework.isEmpty ? nil : Array(homework)
        )
    }

    private func generatePlan(from document: ImportedDocument) async {
        let trimmedText = document.extractedText.trimmingCharacters(in: .whitespacesAndNewlines)
        var pageImages: [String]?
        if trimmedText.count < 500 {
            let rendered = await pdfService.renderPageImages(url: URL(fileURLWithPath: document.localPath))
            guard !rendered.isEmpty else {
                appState.activeError = "这个 PDF 没有可用于生成计划的文本，也无法渲染页面图片。"
                return
            }
            pageImages = rendered
            generationMessage = "文字层不可用，正在用视觉模型识别教材封面和目录…"
        } else {
            generationMessage = "正在生成整本书学习计划…"
        }
        isGenerating = true
        generationStart = .now
        defer {
            isGenerating = false
            generationStart = nil
        }
        do {
            let attributes = try? FileManager.default.attributesOfItem(atPath: document.localPath)
            let fileSize = (attributes?[.size] as? NSNumber)?.intValue ?? 0
            let response = try await BinGOAPI(client: appState.apiClient).generateBookPlan(
                request: BookPlanRequest(
                    fileName: document.fileName,
                    fileSize: fileSize,
                    pdfStorageKey: "ipad-local:\(document.id.uuidString)",
                    pdfText: document.extractedText,
                    pageImages: pageImages,
                    language: "zh-CN",
                    learnerProfile: fetchLearnerProfile(excluding: document.fileName)
                )
            )
            let remote = response.plan
            let record = BookPlanRecord(
                title: remote.title,
                sourceFileName: remote.fileName,
                remoteID: remote.id,
                summary: remote.summary,
                totalLessons: remote.totalLessons,
                currentLessonIndex: remote.currentLessonIndex
            )
            record.plan = remote
            modelContext.insert(record)
            selectedPlanID = record.id
            if let warning = response.warning { appState.activeError = warning }
        } catch {
            appState.activeError = error.localizedDescription
        }
    }
}

private struct BookPlanDetailView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppState.self) private var appState
    @Bindable var plan: BookPlanRecord
    @State private var isGeneratingClassroom = false
    @State private var classroomProgress = ""
    @State private var classroomNotice: String?

    var body: some View {
        List {
            Section {
                Text(plan.summary).foregroundStyle(.secondary)
                ProgressView(value: plan.progress)
                Button {
                    Task { await generateClassroom(lesson: nil) }
                } label: {
                    Label("根据整本书生成课堂", systemImage: "play.rectangle")
                }
                .disabled(isGeneratingClassroom)
                if isGeneratingClassroom {
                    ProgressView(classroomProgress.isEmpty ? "服务器正在生成课堂…" : classroomProgress)
                        .font(.footnote)
                }
                if let classroomNotice {
                    Text(classroomNotice)
                        .font(.footnote)
                        .foregroundStyle(.green)
                }
            }
            Section("课程") {
                ForEach(plan.plan?.lessons ?? []) { lesson in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("第 \(lesson.order) 课 · \(lesson.title)").font(.headline)
                        Text(lesson.objective).foregroundStyle(.secondary)
                        Text(lesson.status).font(.caption).foregroundStyle(.blue)
                        Button("生成本课课堂") { Task { await generateClassroom(lesson: lesson) } }
                            .font(.caption)
                            .disabled(isGeneratingClassroom)
                    }
                    .padding(.vertical, 4)
                }
            }
            Section("学习笔记") {
                TextField("记录重点、疑问和复习内容", text: $plan.notes, axis: .vertical)
                    .lineLimit(8...20)
            }
        }
        .navigationTitle(plan.title)
        .onChange(of: plan.notes) { _, _ in plan.updatedAt = .now }
    }

    private func generateClassroom(lesson: BookLessonDTO?) async {
        isGeneratingClassroom = true
        classroomNotice = nil
        classroomProgress = "正在提交课堂生成任务…"
        defer { isGeneratingClassroom = false }
        do {
            let requirement = buildClassroomRequirement(lesson: lesson)
            let remote = try await BinGOAPI(client: appState.apiClient).generateClassroom(
                request: GenerationRequestDTO(requirement: requirement, language: "zh-CN")
            ) { job in
                await MainActor.run {
                    classroomProgress = job.message.isEmpty ? "服务器正在生成课堂…" : job.message
                }
            }
            let title = lesson.map { "\(plan.title) · 第 \($0.order) 课 \($0.title)" } ?? plan.title
            let classroom = ClassroomRecord(title: title, summary: remote.stage.description ?? plan.summary)
            classroom.remoteID = remote.id
            classroom.stage = remote.stage
            classroom.scenes = remote.scenes
            modelContext.insert(classroom)
            classroomNotice = "课堂已生成，请到「课堂」标签页开始学习"
        } catch {
            appState.activeError = error.localizedDescription
        }
    }

    private func buildClassroomRequirement(lesson: BookLessonDTO?) -> String {
        let structure = "请围绕以上内容生成一节 60 分钟课堂（25 分钟讲授 + 5 分钟休息 + 25 分钟练习 + 5 分钟总结）。"
        if let lesson {
            let points = lesson.knowledgePointIds.isEmpty ? "（以课程目标为准）" : lesson.knowledgePointIds.joined(separator: "、")
            return """
            教材：《\(plan.title)》（\(plan.sourceFileName)）
            本课：第 \(lesson.order) 课 · \(lesson.title)
            学习目标：\(lesson.objective)
            关联知识点：\(points)
            \(structure)
            """
        }
        let lessonList = (plan.plan?.lessons ?? [])
            .map { "第 \($0.order) 课 · \($0.title)：\($0.objective)" }
            .joined(separator: "\n")
        return """
        教材：《\(plan.title)》（\(plan.sourceFileName)）
        全书概要：\(plan.summary)
        课程大纲：
        \(lessonList)
        \(structure)
        """
    }
}
