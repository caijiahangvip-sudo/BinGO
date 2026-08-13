import PDFKit
import PhotosUI
import SwiftData
import SwiftUI

struct DocumentsView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppState.self) private var appState
    @Query(sort: \ImportedDocument.createdAt, order: .reverse) private var documents: [ImportedDocument]
    @State private var selectedDocumentID: UUID?
    @State private var showingFileImporter = false
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var ocrText = ""
    @State private var isWorking = false
    @State private var processingMessage = ""

    private let fileStore = LocalFileStore()
    private let pdfService = PDFService()
    private let ocrService = OCRService()

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedDocumentID) {
                ForEach(documents) { document in
                    Label(document.fileName, systemImage: "doc.richtext").tag(document.id)
                        .contextMenu {
                            Button("删除", role: .destructive) { deleteDocument(document) }
                        }
                }
                .onDelete { indexSet in
                    for index in indexSet { deleteDocument(documents[index]) }
                }
            }
            .navigationTitle("PDF 与 OCR")
            .toolbar {
                Button("导入 PDF", systemImage: "plus") { showingFileImporter = true }
                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                    Label("OCR", systemImage: "viewfinder")
                }
            }
        } detail: {
            if let selectedDocument = documents.first(where: { $0.id == selectedDocumentID }) {
                PDFDocumentView(url: URL(fileURLWithPath: selectedDocument.localPath))
            } else if !ocrText.isEmpty {
                ScrollView { Text(ocrText).textSelection(.enabled).padding(24).frame(maxWidth: .infinity, alignment: .leading) }
            } else {
                ContentUnavailableView("导入 PDF 或选择图片 OCR", systemImage: "doc.viewfinder")
            }
        }
        .overlay {
            if isWorking {
                ProgressView(processingMessage.isEmpty ? "正在处理…" : processingMessage)
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
        }
        .fileImporter(isPresented: $showingFileImporter, allowedContentTypes: [.pdf]) { result in
            if case let .success(url) = result { Task { await importPDF(url) } }
        }
        .onChange(of: selectedPhoto) { _, item in
            guard let item else { return }
            Task { await recognize(item) }
        }
    }

    private func deleteDocument(_ document: ImportedDocument) {
        if selectedDocumentID == document.id { selectedDocumentID = nil }
        try? fileStore.deleteFile(atPath: document.localPath)
        modelContext.delete(document)
    }

    private func importPDF(_ url: URL) async {
        isWorking = true
        defer { isWorking = false }
        do {
            let localURL = try await fileStore.importFile(from: url, folder: "Documents")
            let decision = appState.processingMode(for: .documentParsing)
            processingMessage = decision.mode == .cloud ? "正在使用云端解析 PDF" : "正在使用 PDFKit 本地解析"
            let parsed = try await parsedDocument(url: localURL, decision: decision)
            let record = ImportedDocument(
                fileName: localURL.lastPathComponent,
                localPath: localURL.path(),
                extractedText: parsed.text,
                pageCount: parsed.pageCount
            )
            modelContext.insert(record)
            selectedDocumentID = record.id
        } catch {
            ocrText = "PDF 导入失败：\(error.localizedDescription)"
        }
    }

    private func recognize(_ item: PhotosPickerItem) async {
        isWorking = true
        defer { isWorking = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                throw CocoaError(.fileReadCorruptFile)
            }
            let decision = appState.processingMode(for: .ocr)
            processingMessage = decision.mode == .cloud ? "正在使用云端 OCR" : "正在使用 Vision 本地 OCR"
            ocrText = try await recognizedText(data: data, image: image, decision: decision)
            selectedDocumentID = nil
        } catch {
            ocrText = "OCR 失败：\(error.localizedDescription)"
        }
    }

    private func parsedDocument(url: URL, decision: ProcessingDecision) async throws -> ParsedPDF {
        if decision.mode == .cloud {
            do {
                let data = try Data(contentsOf: url)
                let text = try await BinGOAPI(client: appState.apiClient).cloudDocumentParsing(
                    file: UploadFile(fieldName: "file", fileName: url.lastPathComponent, mimeType: "application/pdf", data: data)
                )
                return ParsedPDF(pageCount: PDFDocument(url: url)?.pageCount ?? 0, text: text, coverJPEG: nil)
            } catch where appState.processingPreferences.mode(for: .documentParsing) == .automatic {
                processingMessage = "云端解析不可用，已回退 PDFKit"
            }
        }
        return try await pdfService.parse(url: url)
    }

    private func recognizedText(data: Data, image: UIImage, decision: ProcessingDecision) async throws -> String {
        if decision.mode == .cloud {
            do {
                return try await BinGOAPI(client: appState.apiClient).cloudOCR(
                    file: UploadFile(fieldName: "file", fileName: "ocr.jpg", mimeType: "image/jpeg", data: data)
                )
            } catch where appState.processingPreferences.mode(for: .ocr) == .automatic {
                processingMessage = "云端 OCR 不可用，已回退 Vision"
            }
        }
        return try await ocrService.recognize(image: image).text
    }
}

private struct PDFDocumentView: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.document = PDFDocument(url: url)
        return view
    }
    func updateUIView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url { view.document = PDFDocument(url: url) }
    }
}
