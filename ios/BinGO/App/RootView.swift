import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("bingo.hasSeenOnboarding") private var hasSeenOnboarding = false

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
                case .learningTools: LearningToolsView()
                case .settings: SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .id(appState.selectedSection)
        }
        .alert("BinGO", isPresented: Binding(
            get: { appState.activeError != nil },
            set: { if !$0 { appState.activeError = nil } }
        )) {
            Button("好") { appState.activeError = nil }
        } message: {
            Text(appState.activeError ?? "")
        }
        .fullScreenCover(isPresented: Binding(
            get: { !hasSeenOnboarding },
            set: { if !$0 { hasSeenOnboarding = true } }
        )) {
            OnboardingView { hasSeenOnboarding = true }
        }
        .task(id: appState.syncSession.account?.id) {
            guard appState.syncSession.account != nil else { return }
            while !Task.isCancelled {
                try? await appState.syncSession.synchronize(modelContext: modelContext)
                try? await Task.sleep(for: .seconds(300))
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, appState.syncSession.account != nil else { return }
            Task {
                try? await appState.syncSession.refreshSupportRequests()
                try? await appState.syncSession.synchronize(modelContext: modelContext)
            }
        }
    }
}
