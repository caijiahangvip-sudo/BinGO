import SwiftUI

struct TeacherDashboardView: View {
    @Environment(TeacherSessionStore.self) private var store
    var body: some View { ScrollView { VStack(alignment: .leading, spacing: 20) { Text("教学总览").font(.largeTitle.bold()); HStack { MetricCard(title: "班级", value: Set(store.bootstrap?.teacherAssignments.map(\.classId) ?? []).count); MetricCard(title: "学习目标", value: store.tasks.count); MetricCard(title: "未读通知", value: store.bootstrap?.unreadNotifications ?? 0) }; GroupBox("教学职责") { VStack { ForEach(store.bootstrap?.teacherAssignments ?? []) { item in HStack { VStack(alignment: .leading) { Text(item.className).bold(); Text(item.subjectName).font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(item.roleName) }.padding(.vertical, 6); Divider() } } } }.padding(24) } }
}

struct MetricCard: View { let title: String; let value: Int; var body: some View { VStack(alignment: .leading) { Text(title).foregroundStyle(.secondary); Text("\(value)").font(.largeTitle.bold()) }.frame(maxWidth: .infinity, alignment: .leading).padding().background(.background).clipShape(RoundedRectangle(cornerRadius: 14)).shadow(color: .black.opacity(0.04), radius: 8) } }

struct TeacherTasksView: View {
    @Environment(TeacherSessionStore.self) private var store
    @State private var showingNew = false
    var body: some View { NavigationStack { List(store.tasks) { task in VStack(alignment: .leading) { HStack { Text(task.title).font(.headline); Spacer(); Text(task.requirement == "required" ? "必做" : "选做").font(.caption).padding(5).background(.blue.opacity(0.1)).clipShape(Capsule()) }; Text(task.className ?? task.groupName ?? "").font(.caption).foregroundStyle(.secondary); Text(task.description).lineLimit(2) } }.navigationTitle("学习目标").toolbar { Button("新建", systemImage: "plus") { showingNew = true } }.sheet(isPresented: $showingNew) { NewTaskView() }.refreshable { await store.refresh() } } }
}

struct NewTaskView: View {
    @Environment(TeacherSessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var assignmentId = ""; @State private var title = ""; @State private var description = ""; @State private var kind = "goal"; @State private var requirement = "optional"
    var body: some View { NavigationStack { Form { Picker("班级", selection: $assignmentId) { ForEach(store.bootstrap?.teacherAssignments ?? []) { Text("\($0.className) · \($0.roleName)").tag($0.id) } }; TextField("标题", text: $title); TextField("说明", text: $description, axis: .vertical); Picker("类型", selection: $kind) { Text("学习目标").tag("goal"); Text("练习").tag("practice"); Text("正式测评").tag("assessment") }; Picker("要求", selection: $requirement) { Text("选做").tag("optional"); Text("必做").tag("required") } }.navigationTitle("新建目标").toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("保存") { Task { guard let assignment = store.bootstrap?.teacherAssignments.first(where: { $0.id == assignmentId }) ?? store.bootstrap?.teacherAssignments.first else { return }; do { try await store.api.createTask(payload: ["classId":.string(assignment.classId),"groupId":.null,"title":.string(title),"description":.string(description),"resources":.array([]),"rubric":.array([]),"taskKind":.string(kind),"requirement":.string(requirement),"subjectName":.string(assignment.subjectName),"dueAt":.null], token: store.session!.accessToken); await store.refresh(); dismiss() } catch { store.errorMessage = error.localizedDescription } } } } } }.onAppear { assignmentId = store.bootstrap?.teacherAssignments.first?.id ?? "" } }
}

struct TeacherStudentsView: View {
    @Environment(TeacherSessionStore.self) private var store
    @State private var students: [TeacherStudent] = []
    var body: some View { List(students) { student in NavigationLink { TeacherConversationView(student: student) } label: { HStack { VStack(alignment: .leading) { Text(student.username).font(.headline); Text("提交 \(student.submittedCount) · 已评价 \(student.gradedCount)").font(.caption).foregroundStyle(.secondary) }; Spacer(); Image(systemName: "message") } } }.navigationTitle("学生").task { var values: [TeacherStudent] = []; for assignment in store.bootstrap?.teacherAssignments ?? [] { values += (try? await store.api.students(classId: assignment.classId, token: store.session!.accessToken)) ?? [] }; students = Array(Dictionary(grouping: values, by: \.id).compactMap { $0.value.first }) } }
}

struct TeacherConversationView: View {
    @Environment(TeacherSessionStore.self) private var store
    let student: TeacherStudent
    @State private var messages: [ChatMessage] = []; @State private var text = ""
    var body: some View { VStack { List(messages) { message in HStack { if message.senderId == store.session?.account.id { Spacer() }; Text(message.text).padding(10).background(message.senderId == store.session?.account.id ? Color.blue.opacity(0.15) : Color.gray.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 12)); if message.senderId != store.session?.account.id { Spacer() } } }; HStack { TextField("输入消息", text: $text); Button("发送") { Task { try? await store.api.sendMessage(accountId: student.id, text: text, token: store.session!.accessToken); text = ""; await load() } } }.padding() }.navigationTitle(student.username).task { await load() } }
    private func load() async { messages = (try? await store.api.messages(accountId: student.id, token: store.session!.accessToken)) ?? [] }
}

struct TeacherGroupsView: View {
    @Environment(TeacherSessionStore.self) private var store
    @State private var name = ""; @State private var code = ""; @State private var createdCode: String?
    var body: some View { Form { Section("我的学习小组") { ForEach(store.bootstrap?.groups ?? []) { Text($0.name) } }; Section("创建跨组织小组") { TextField("小组名称", text: $name); Button("创建") { Task { if let result = try? await store.api.createGroup(name: name, description: "", token: store.session!.accessToken) { createdCode = result.code; await store.refresh() } } }; if let createdCode { Text(createdCode).font(.system(.body, design: .monospaced)).textSelection(.enabled) } }; Section("加入小组") { TextField("邀请码", text: $code); Button("加入") { Task { try? await store.api.joinGroup(code: code, token: store.session!.accessToken); code = ""; await store.refresh() } } } }.navigationTitle("学习小组") }
}

struct TeacherNotificationsView: View {
    @Environment(TeacherSessionStore.self) private var store
    var body: some View { List(store.notifications) { item in Button { Task { try? await store.api.markRead(id: item.id, token: store.session!.accessToken); await store.refresh() } } label: { VStack(alignment: .leading) { Text(item.title).font(.headline); Text(item.body).foregroundStyle(.secondary); Text(item.createdAt).font(.caption).foregroundStyle(.tertiary) }.opacity(item.readAt == nil ? 1 : 0.6) } }.navigationTitle("通知").refreshable { await store.refresh() } }
}
