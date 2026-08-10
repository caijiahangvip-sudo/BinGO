import SwiftData
import SwiftUI

struct ServerAndSyncView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var modelContext
    @State private var newInviteCode = ""
    @State private var message: String?

    var body: some View {
        @Bindable var syncSession = appState.syncSession
        Section("服务器与同步") {
            TextField("同步服务器", text: $syncSession.baseURLString)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
            Label(appState.syncSession.isOnline ? "服务器在线" : "服务器离线", systemImage: appState.syncSession.isOnline ? "checkmark.icloud.fill" : "icloud.slash")
                .foregroundStyle(appState.syncSession.isOnline ? .green : .secondary)
            if let account = appState.syncSession.account {
                LabeledContent("当前账号", value: "\(account.displayName) (@\(account.username ?? "-"))")
                Button(appState.syncSession.isBusy ? "正在同步" : "立即同步", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await synchronize() }
                }
                .disabled(appState.syncSession.isBusy)
                Text(appState.syncSession.lastSyncMessage).font(.footnote).foregroundStyle(.secondary)
                if account.role == "student" {
                    NavigationLink { LearningNetworkView() } label: { Label("学习网络", systemImage: "person.3.sequence.fill") }
                }
                DisclosureGroup("已登录设备（\(appState.syncSession.devices.count)）") {
                    ForEach(appState.syncSession.devices) { device in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(device.deviceName)
                                Text(device.platform).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("撤销", role: .destructive) { Task { try? await appState.syncSession.revokeDevice(device.id) } }
                        }
                    }
                }
                DisclosureGroup("管理员访问申请（\(appState.syncSession.supportRequests.filter { $0.status == "pending" }.count) 待处理）") {
                    if appState.syncSession.supportRequests.isEmpty {
                        Text("暂无访问申请").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(appState.syncSession.supportRequests) { request in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(request.administratorName).font(.headline)
                                Spacer()
                                Text(request.status).font(.caption).foregroundStyle(.secondary)
                            }
                            Text("\(request.entityType) · \(request.entityId)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                            if request.status == "pending" {
                                HStack {
                                    Button("同意一次") {
                                        Task {
                                            do { try await appState.syncSession.decideSupportRequest(request.id, approve: true) }
                                            catch { message = error.localizedDescription }
                                        }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    Button("拒绝", role: .destructive) {
                                        Task {
                                            do { try await appState.syncSession.decideSupportRequest(request.id, approve: false) }
                                            catch { message = error.localizedDescription }
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                if account.role == "admin" {
                    TextField("新的组织邀请码", text: $newInviteCode)
                    Button("更换组织邀请码") {
                        Task {
                            do { try await appState.syncSession.rotateInviteCode(newInviteCode); newInviteCode = ""; message = "邀请码已更新" }
                            catch { message = error.localizedDescription }
                        }
                    }
                    .disabled(newInviteCode.count < 4)
                }
                Button("退出同步账号", role: .destructive) { Task { await appState.syncSession.logout() } }
            } else {
                AuthenticationView()
            }
            if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        }
    }

    private func synchronize() async {
        do {
            try await appState.syncSession.synchronize(modelContext: modelContext)
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }
}
