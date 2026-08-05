import Foundation
import Observation

@MainActor
@Observable
final class AppState {
    enum Connectivity: Equatable {
        case checking
        case online(version: String)
        case offline(message: String)
    }

    var selectedSection: AppSection? = .home
    var connectivity: Connectivity = .checking
    var configuration = APIConfiguration.load()
    var activeError: String?

    private(set) var apiClient: APIClient

    init() {
        apiClient = APIClient(configuration: APIConfiguration.load())
    }

    func bootstrap() async {
        await refreshConnection()
    }

    func applyConfiguration(_ value: APIConfiguration) async {
        configuration = value.normalized()
        configuration.save()
        apiClient = APIClient(configuration: configuration)
        await refreshConnection()
    }

    func refreshConnection() async {
        guard configuration.baseURL != nil else {
            connectivity = .offline(message: "尚未配置 BinGO API；本地功能仍可使用。")
            return
        }
        connectivity = .checking
        do {
            let response: HealthResponse = try await apiClient.get("/api/health")
            connectivity = .online(version: response.version)
        } catch {
            connectivity = .offline(message: error.localizedDescription)
        }
    }
}

enum AppSection: String, CaseIterable, Identifiable {
    case home
    case classrooms
    case whiteboard
    case documents
    case homework
    case books
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "首页"
        case .classrooms: "课堂"
        case .whiteboard: "白板"
        case .documents: "PDF 与 OCR"
        case .homework: "作业"
        case .books: "书本学习"
        case .settings: "设置"
        }
    }

    var systemImage: String {
        switch self {
        case .home: "house"
        case .classrooms: "rectangle.on.rectangle.angled"
        case .whiteboard: "pencil.and.scribble"
        case .documents: "doc.viewfinder"
        case .homework: "checklist"
        case .books: "books.vertical"
        case .settings: "gearshape"
        }
    }
}
