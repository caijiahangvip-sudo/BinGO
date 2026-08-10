import SwiftUI
import Observation

@main
struct BinGOTeacherApp: App {
    @State private var session = TeacherSessionStore()
    var body: some Scene { WindowGroup { TeacherRootView().environment(session) } }
}

@MainActor @Observable
final class TeacherSessionStore {
    var session: TeacherAuthSession?
    var bootstrap: TeacherBootstrap?
    var tasks: [LearningTaskDTO] = []
    var notifications: [TeacherNotification] = []
    var errorMessage: String?
    let api = TeacherAPIClient()

    init() {
        if let data = UserDefaults.standard.data(forKey: "bingo.teacher.session") { session = try? JSONDecoder().decode(TeacherAuthSession.self, from: data) }
    }
    func save(_ value: TeacherAuthSession) { session = value; UserDefaults.standard.set(try? JSONEncoder().encode(value), forKey: "bingo.teacher.session") }
    func logout() { session = nil; bootstrap = nil; UserDefaults.standard.removeObject(forKey: "bingo.teacher.session") }
    func refresh() async {
        guard let token = session?.accessToken else { return }
        do { async let nextBootstrap = api.bootstrap(token: token); async let nextTasks = api.tasks(token: token); async let nextNotifications = api.notifications(token: token); bootstrap = try await nextBootstrap; tasks = try await nextTasks; notifications = try await nextNotifications }
        catch { errorMessage = error.localizedDescription }
    }
}

enum TeacherSection: String, CaseIterable, Identifiable { case dashboard, tasks, students, groups, messages, notifications; var id: String { rawValue }; var title: String { switch self { case .dashboard: "总览"; case .tasks: "学习目标"; case .students: "学生"; case .groups: "学习小组"; case .messages: "消息"; case .notifications: "通知" } }; var icon: String { switch self { case .dashboard: "rectangle.grid.2x2"; case .tasks: "target"; case .students: "person.3"; case .groups: "person.2.wave.2"; case .messages: "message"; case .notifications: "bell" } } }

struct TeacherRootView: View {
    @Environment(TeacherSessionStore.self) private var store
    @State private var selection: TeacherSection? = .dashboard
    var body: some View {
        if store.session == nil { TeacherAuthenticationView() }
        else { NavigationSplitView { List(TeacherSection.allCases, selection: $selection) { Label($0.title, systemImage: $0.icon).tag($0) }.navigationTitle("BinGO 教师端").safeAreaInset(edge: .bottom) { Button("退出登录") { store.logout() }.padding() } } detail: { Group { switch selection ?? .dashboard { case .dashboard: TeacherDashboardView(); case .tasks: TeacherTasksView(); case .students: TeacherStudentsView(); case .groups: TeacherGroupsView(); case .messages: TeacherStudentsView(); case .notifications: TeacherNotificationsView() } }.frame(maxWidth: .infinity, maxHeight: .infinity) } .task { await store.refresh() } }
    }
}

struct TeacherAuthenticationView: View {
    @Environment(TeacherSessionStore.self) private var store
    @State private var mode = "login"; @State private var inviteCode = ""; @State private var username = ""; @State private var password = ""
    var body: some View { VStack(alignment: .leading, spacing: 16) { Text("BinGO 教师端").font(.largeTitle.bold()); Picker("账号操作", selection: $mode) { Text("登录").tag("login"); Text("教师邀请码注册").tag("register") }.pickerStyle(.segmented); if mode == "register" { TextField("教师邀请码", text: $inviteCode) }; TextField("用户名", text: $username); SecureField("密码（至少10位）", text: $password); if let error = store.errorMessage { Text(error).foregroundStyle(.red) }; Button("进入教师端") { Task { do { let value = mode == "login" ? try await store.api.login(username: username, password: password) : try await store.api.register(inviteCode: inviteCode, username: username, password: password); guard value.account.role == "teacher" else { throw TeacherAPIError(message: "该账号不是教师账号") }; store.save(value); await store.refresh() } catch { store.errorMessage = error.localizedDescription } } }.buttonStyle(.borderedProminent).disabled(username.isEmpty || password.count < 10) }.padding(32).frame(maxWidth: 520) }
}
