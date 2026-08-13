import SwiftUI

struct TextbookLibraryView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    /// Called after a textbook PDF has been downloaded, imported and parsed.
    let onImport: (ImportedDocument) -> Void

    @State private var roots: [TextbookCatalogNode] = []
    @State private var searchText = ""
    @State private var searchResults: [TextbookSearchResult] = []
    @State private var isLoadingCatalog = false
    @State private var isSearching = false
    @State private var hasSearched = false
    @State private var downloadingID: String?
    @State private var downloadProgress: Double?
    @State private var statusMessage: String?

    private let fileStore = LocalFileStore()
    private let pdfService = PDFService()

    var body: some View {
        NavigationStack {
            List {
                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                if isSearching {
                    Section { ProgressView("正在搜索教材…") }
                } else if hasSearched {
                    if searchResults.isEmpty {
                        Section { Text("没有找到相关教材").foregroundStyle(.secondary) }
                    } else {
                        Section("搜索结果") {
                            ForEach(searchResults) { result in
                                TextbookBookRow(
                                    id: result.id,
                                    title: result.title,
                                    contentType: result.contentType,
                                    downloadingID: downloadingID,
                                    onDownload: download
                                )
                            }
                        }
                    }
                } else {
                    Section("按学段、学科浏览") {
                        ForEach(roots) { node in
                            NavigationLink(node.name) {
                                TextbookNodeList(
                                    node: node,
                                    downloadingID: downloadingID,
                                    onDownload: download
                                )
                            }
                        }
                    }
                }
            }
            .navigationTitle("教材库")
            .searchable(text: $searchText, prompt: "搜索教材名称，如：三年级语文")
            .onSubmit(of: .search) { Task { await search() } }
            .onChange(of: searchText) { _, value in
                if value.trimmingCharacters(in: .whitespaces).isEmpty {
                    hasSearched = false
                    searchResults = []
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .overlay {
                if isLoadingCatalog {
                    ProgressView("正在载入教材目录…")
                }
                if downloadingID != nil {
                    VStack(spacing: 12) {
                        if let downloadProgress {
                            ProgressView(value: downloadProgress)
                                .frame(width: 260)
                            Text("正在下载教材 · \(Int(downloadProgress * 100))%")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            ProgressView()
                            Text("正在下载并导入教材（文件较大，请稍候）…")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(20)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .task { await loadCatalog() }
        }
    }

    private func loadCatalog() async {
        guard roots.isEmpty else { return }
        isLoadingCatalog = true
        defer { isLoadingCatalog = false }
        do {
            roots = try await BinGOAPI(client: appState.apiClient).textbookCatalog()
            statusMessage = nil
        } catch {
            statusMessage = "教材目录加载失败：\(error.localizedDescription)"
        }
    }

    private func search() async {
        let keyword = searchText.trimmingCharacters(in: .whitespaces)
        guard !keyword.isEmpty else { return }
        isSearching = true
        defer { isSearching = false }
        do {
            searchResults = try await BinGOAPI(client: appState.apiClient).textbookSearch(keyword: keyword)
            hasSearched = true
            statusMessage = nil
        } catch {
            statusMessage = "搜索失败：\(error.localizedDescription)"
        }
    }

    private func download(id: String, title: String, contentType: String) async {
        downloadingID = id
        downloadProgress = nil
        defer {
            downloadingID = nil
            downloadProgress = nil
        }
        do {
            let data = try await BinGOAPI(client: appState.apiClient)
                .downloadTextbook(contentId: id, contentType: contentType) { value in
                    Task { @MainActor in downloadProgress = value }
                }
            // 下载完成，进入导入/解析阶段（回到不确定进度）
            downloadProgress = nil
            let safeName = title
                .replacingOccurrences(of: "/", with: "-")
                .replacingOccurrences(of: ":", with: "-")
            let tempURL = FileManager.default.temporaryDirectory
                .appending(path: "\(safeName).pdf")
            try data.write(to: tempURL, options: .atomic)
            let localURL = try await fileStore.importFile(from: tempURL, folder: "Documents")
            try? FileManager.default.removeItem(at: tempURL)
            let parsed = try await pdfService.parse(url: localURL)
            let record = ImportedDocument(
                fileName: localURL.lastPathComponent,
                localPath: localURL.path(),
                extractedText: parsed.text,
                pageCount: parsed.pageCount
            )
            modelContext.insert(record)
            statusMessage = nil
            onImport(record)
        } catch {
            statusMessage = "下载失败：\(error.localizedDescription)"
        }
    }
}

/// One level of the textbook catalog tree. Nodes with children drill down;
/// leaf nodes are downloadable textbooks.
private struct TextbookNodeList: View {
    let node: TextbookCatalogNode
    let downloadingID: String?
    let onDownload: (String, String, String) async -> Void

    var body: some View {
        List(node.children ?? []) { child in
            if child.children?.isEmpty == false {
                NavigationLink(child.name) {
                    TextbookNodeList(node: child, downloadingID: downloadingID, onDownload: onDownload)
                }
            } else {
                TextbookBookRow(
                    id: child.id,
                    title: child.name,
                    contentType: "assets_document",
                    downloadingID: downloadingID,
                    onDownload: onDownload
                )
            }
        }
        .navigationTitle(node.name)
    }
}

private struct TextbookBookRow: View {
    let id: String
    let title: String
    let contentType: String
    let downloadingID: String?
    let onDownload: (String, String, String) async -> Void

    var body: some View {
        HStack {
            Text(title)
                .font(.subheadline)
                .lineLimit(3)
            Spacer()
            if downloadingID == id {
                ProgressView()
            } else {
                Button("下载") {
                    Task { await onDownload(id, title, contentType) }
                }
                .buttonStyle(.bordered)
                .disabled(downloadingID != nil)
            }
        }
        .padding(.vertical, 4)
    }
}
