import PDFKit
import PhotosUI
import SwiftData
import SwiftUI

struct DocumentsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \ImportedDocument.createdAt, order: .reverse) private var documents: [ImportedDocument]
    @State private var selectedDocumentID: UUID?
    @State private var showingFileImporter = false
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var ocrText = ""
    @State private var isWorking = false

    private let fileStore = LocalFileStore()
    private let pdfService = PDFService()
    private let ocrService = OCRService()

    var body: some View {
        NavigationSplitView {
            List(documents, selection: $selectedDocumentID) { document in
                Label(document.fileName, systemImage: "doc.richtext").tag(document.id)
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
        .overlay { if isWorking { ProgressView("正在本地处理…").padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)) } }
        .fileImporter(isPresented: $showingFileImporter, allowedContentTypes: [.pdf]) { result in
            if case let .success(url) = result { Task { await importPDF(url) } }
        }
        .onChange(of: selectedPhoto) { _, item in
            guard let item else { return }
            Task { await recognize(item) }
        }
    }

    private func importPDF(_ url: URL) async {
        isWorking = true
        defer { isWorking = false }
        do {
            let localURL = try await fileStore.importFile(from: url, folder: "Documents")
            let parsed = try await pdfService.parse(url: localURL)
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
            ocrText = try await ocrService.recognize(image: image).text
            selectedDocumentID = nil
        } catch {
            ocrText = "OCR 失败：\(error.localizedDescription)"
        }
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
