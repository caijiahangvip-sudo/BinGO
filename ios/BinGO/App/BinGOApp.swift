import SwiftData
import SwiftUI

@main
struct BinGOApp: App {
    @State private var appState = AppState()

    private let modelContainer: ModelContainer = {
        let schema = Schema([
            ClassroomRecord.self,
            HomeworkRecord.self,
            BookPlanRecord.self,
            ImportedDocument.self,
            WhiteboardRecord.self,
        ])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        return try! ModelContainer(for: schema, configurations: [configuration])
    }()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .task { await appState.bootstrap() }
        }
        .modelContainer(modelContainer)
    }
}
