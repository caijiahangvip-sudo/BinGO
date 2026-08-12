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
    private let pdfService = PDFService()

    var body: some View {
        NavigationSplitView {
            List(plans, selection: $selectedPlanID) { plan in
                VStack(alignment: .leading, spacing: 8) {
                    Text(plan.title).font(.headline)
                    ProgressView(value: plan.progress)
                    Text("\(plan.currentLessonIndex)/\(plan.totalLessons) 课 · \(plan.sourceFileName)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 6)
                .tag(plan.id)
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
                ProgressView(generationMessage)
                    .padding(20)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
        }
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
        defer { isGenerating = false }
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
                    language: "zh-CN"
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
    @Bindable var plan: BookPlanRecord

    var body: some View {
        List {
            Section {
                Text(plan.summary).foregroundStyle(.secondary)
                ProgressView(value: plan.progress)
            }
            Section("课程") {
                ForEach(plan.plan?.lessons ?? []) { lesson in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("第 \(lesson.order) 课 · \(lesson.title)").font(.headline)
                        Text(lesson.objective).foregroundStyle(.secondary)
                        Text(lesson.status).font(.caption).foregroundStyle(.blue)
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
}
