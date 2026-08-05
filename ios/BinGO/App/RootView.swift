import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        NavigationSplitView {
            List(AppSection.allCases, selection: $appState.selectedSection) { section in
                Label(section.title, systemImage: section.systemImage)
                    .tag(section)
            }
            .navigationTitle("BinGO")
        } detail: {
            Group {
                switch appState.selectedSection ?? .home {
                case .home: HomeView()
                case .classrooms: ClassroomListView()
                case .whiteboard: WhiteboardView()
                case .documents: DocumentsView()
                case .homework: HomeworkListView()
                case .books: BookLearningView()
                case .settings: SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .alert("BinGO", isPresented: Binding(
            get: { appState.activeError != nil },
            set: { if !$0 { appState.activeError = nil } }
        )) {
            Button("好") { appState.activeError = nil }
        } message: {
            Text(appState.activeError ?? "")
        }
    }
}
