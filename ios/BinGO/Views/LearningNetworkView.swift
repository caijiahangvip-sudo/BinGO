import SwiftUI

struct LearningNetworkView: View {
    @Environment(AppState.self) private var appState
    @State private var classCode = ""
    @State private var groupCode = ""
    @State private var message: String?

    var body: some View {
        List {
            Section("主要班级") {
                if let primaryClass = appState.syncSession.teachingBootstrap?.primaryClass {
                    LabeledContent("当前班级", value: primaryClass.name)
                } else {
                    TextField("班级邀请码", text: $classCode)
                    Button("加入班级") { Task { do { try await appState.syncSession.joinPrimaryClass(classCode); classCode = "" } catch { message = error.localizedDescription } } }
                }
            }
            Section("教师学习目标") {
                if appState.syncSession.learningTasks.isEmpty { Text("暂无学习目标").foregroundStyle(.secondary) }
                ForEach(appState.syncSession.learningTasks) { task in
                    VStack(alignment: .leading, spacing: 7) {
                        HStack { Text(task.title).font(.headline); Spacer(); Text(task.requirement == "required" ? "必做" : "选做").font(.caption).foregroundStyle(.secondary) }
                        Text(task.description).font(.subheadline).foregroundStyle(.secondary)
                        Button("提交成果包") { let summary = "我已完成：\(task.title)"; Task { do { try await appState.syncSession.submitLearningTask(task, summary: summary) } catch { message = error.localizedDescription } } }
                    }
                }
            }
            Section("学习小组") {
                ForEach(appState.syncSession.teachingBootstrap?.groups ?? []) { group in Text(group.name) }
                TextField("小组邀请码", text: $groupCode)
                Button("加入小组") { Task { do { try await appState.syncSession.joinStudyGroup(groupCode); groupCode = "" } catch { message = error.localizedDescription } } }
            }
            Section("教学通知") {
                ForEach(appState.syncSession.teachingNotifications) { notification in
                    Button { Task { try? await appState.syncSession.markTeachingNotification(notification) } } label: {
                        VStack(alignment: .leading) { Text(notification.title).font(.headline); Text(notification.body).font(.caption).foregroundStyle(.secondary) }.opacity(notification.readAt == nil ? 1 : 0.55)
                    }
                }
            }
        }
        .navigationTitle("学习网络")
        .alert("学习网络", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) { Button("好") { message = nil } } message: { Text(message ?? "") }
        .task { try? await appState.syncSession.refreshTeachingNetwork() }
    }
}
